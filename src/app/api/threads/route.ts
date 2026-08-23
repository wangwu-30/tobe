import { NextRequest, NextResponse } from 'next/server';
import {
  stringifyCommentAgentMentions,
} from '@/lib/comments/agents';
import { getSettingsFromHeaders } from '@/lib/ai/providers';
import {
  buildCommentSurfaceText,
  classifyInheritedCommentThread,
  collectCommentThreadIdentityCandidates,
  type CommentThreadSurfaceFile,
} from '@/derive/thread-classify';
import { prisma } from '@/lib/db/prisma';
import { buildCommentMessageAgentState } from '@/objects/comment/agent-bindings';
import {
  getCurrentDraftRevisionForDocument,
} from '@/lib/comments/version-binding';
import {
  buildCommentThreadRevisionFilters,
  buildCommentVersionLineageFilter,
  markCommentThreadInherited,
  orderInheritedCommentThreadCandidates,
  resolveCommentVersionLineageIds,
} from '@/lib/comments/thread-query';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { mapCommentThread } from '@/objects/comment/view';
import { parseVersionFiles } from '@/objects/file/schema';
import { defineRoute } from '@/framework/resilience';


export const GET = defineRoute(async function GET(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const { searchParams } = new URL(req.url);
  const workspaceId =
    searchParams.get('workspaceId') ||
    searchParams.get('wikiId') ||
    searchParams.get('documentId');
  const draftOnly = searchParams.get('draftOnly') === '1';
  const fileId = searchParams.get('fileId');
  const versionId = searchParams.get('versionId');
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  }

  const currentDraftRevision =
    draftOnly && !versionId
      ? await getCurrentDraftRevisionForDocument(actor.organizationId, workspaceId)
      : null;
  const inheritedVersionIds = await resolveInheritedVersionIds({
    draftOnly,
    organizationId: actor.organizationId,
    versionId,
    workspaceId,
  });
  const revisionFilters = buildCommentThreadRevisionFilters({
    currentDraftRevision,
    draftOnly,
    inheritedVersionIds,
    versionId,
  });

  const directThreads = await prisma.commentThread.findMany({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      ...(fileId ? { fileId } : {}),
      organizationId: actor.organizationId,
      ...revisionFilters.direct,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: {
        include: {
          labels: {
            where: { deletedAt: null },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const priorDraftThreads =
    revisionFilters.priorDraft
      ? await prisma.commentThread.findMany({
          where: {
            deletedAt: null,
            documentId: workspaceId,
            ...(fileId ? { fileId } : {}),
            organizationId: actor.organizationId,
            ...revisionFilters.priorDraft,
          },
          include: {
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
            version: {
              include: {
                labels: {
                  where: { deletedAt: null },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const inheritedThreads =
    revisionFilters.inheritedVersion
      ? await prisma.commentThread.findMany({
          where: {
            deletedAt: null,
            documentId: workspaceId,
            ...(fileId ? { fileId } : {}),
            organizationId: actor.organizationId,
            ...revisionFilters.inheritedVersion,
          },
          include: {
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
            version: {
              include: {
                labels: {
                  where: { deletedAt: null },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

  const surfaceFiles = await resolveSurfaceFiles({
    organizationId: actor.organizationId,
    versionId,
    workspaceId,
  });

  const mappedDirectThreads = directThreads.map((thread) => mapCommentThread(thread));
  const directFingerprints = new Set(
    mappedDirectThreads
      .filter((thread) => thread.status === 'open' || thread.status === 'applied')
      .map((thread) => thread.anchorFingerprint)
  );
  const directIdentityCandidates = new Set(
    mappedDirectThreads
      .filter((thread) => thread.status === 'open' || thread.status === 'applied')
      .flatMap((thread) => collectCommentThreadIdentityCandidates(thread))
  );
  const seenInheritedFingerprints = new Set<string>();
  const seenInheritedIdentityCandidates = new Set<string>();
  const surfaceFilesById = new Map(
    surfaceFiles
      .filter((file): file is CommentThreadSurfaceFile & { id: string } => Boolean(file.id))
      .map((file) => [file.id, file])
  );
  const combinedSurfaceText = buildCommentSurfaceText(surfaceFiles);

  const mappedInheritedThreads = orderInheritedCommentThreadCandidates({
    inheritedVersionIds,
    priorDraftThreads,
    versionThreads: inheritedThreads,
  })
    .map((thread) => {
      const mapped = mapCommentThread(thread);
      const state = classifyInheritedCommentThread({
        combinedSurfaceText,
        directIdentityCandidates,
        directFingerprints,
        seenInheritedIdentityCandidates,
        seenInheritedFingerprints,
        surfaceFilesById,
        thread: mapped,
      });

      if (state !== 'stale') {
        seenInheritedFingerprints.add(mapped.anchorFingerprint);
        collectCommentThreadIdentityCandidates(mapped).forEach((candidate) => {
          seenInheritedIdentityCandidates.add(candidate);
        });
      }

      return markCommentThreadInherited(mapped, state);
    });

  return NextResponse.json([...mappedDirectThreads, ...mappedInheritedThreads]);
});

export const POST = defineRoute(async function POST(req: NextRequest) {
  const actor = await getPlatformContextFromHeaders(req.headers);
  const settings = getSettingsFromHeaders(req.headers);
  const body = await req.json();
  const workspaceId = body.workspaceId || body.wikiId || body.documentId;
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 });
  }

  const draftRevision =
    body.versionId || typeof body.draftRevision === 'number'
      ? typeof body.draftRevision === 'number'
        ? body.draftRevision
        : null
      : await getCurrentDraftRevisionForDocument(actor.organizationId, workspaceId);
  const agentState = buildCommentMessageAgentState({
    agents: settings.commentAgents || [],
    bindingsJson: null,
    content: typeof body.firstMessage === 'string' ? body.firstMessage : '',
    role: 'user',
  });
  const mentions = agentState.mentions;

  const thread = await prisma.commentThread.create({
    data: {
      organizationId: actor.organizationId,
      documentId: workspaceId,
      fileId: body.fileId || null,
      versionId: body.versionId || null,
      anchorText: body.anchorText,
      draftRevision: draftRevision,
      selectionAnchor: body.selectionAnchor || null,
      agentBindingsJson: agentState.bindingsJson,
      createdByUserId: actor.userId,
      originDeviceId: actor.deviceId,
      messages: {
        create: body.firstMessage
          ? {
              organizationId: actor.organizationId,
              role: 'user',
              content: body.firstMessage,
              mentionedAgentsJson:
                mentions.length > 0 ? stringifyCommentAgentMentions(mentions) : null,
              createdByUserId: actor.userId,
              originDeviceId: actor.deviceId,
            }
          : undefined,
      },
    },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      version: {
        include: {
          labels: {
            where: { deletedAt: null },
          },
        },
      },
    },
  });
  return NextResponse.json(mapCommentThread(thread));
});

async function resolveSurfaceFiles(params: {
  organizationId: string;
  versionId: string | null;
  workspaceId: string;
}) {
  if (params.versionId) {
    const version = await prisma.version.findFirst({
      where: {
        deletedAt: null,
        documentId: params.workspaceId,
        id: params.versionId,
        organizationId: params.organizationId,
      },
      select: { content: true },
    });

    if (!version) {
      return [];
    }

    return parseVersionFiles(version.content).map((file) => ({
      content: file.content,
      id: file.id || null,
      path: file.path,
    }));
  }

  return prisma.workspaceFile.findMany({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
    },
    select: {
      content: true,
      id: true,
      path: true,
    },
  });
}

async function resolveInheritedVersionIds(params: {
  draftOnly: boolean;
  organizationId: string;
  versionId: string | null;
  workspaceId: string;
}) {
  if (params.versionId) {
    const lineageIds = await listVersionLineageIds({
      organizationId: params.organizationId,
      versionId: params.versionId,
      workspaceId: params.workspaceId,
    });
    return lineageIds.slice(1);
  }

  if (!params.draftOnly) {
    return [];
  }

  const persistedDraftBaseVersionId = (
    await prisma.document.findFirst({
      where: {
        deletedAt: null,
        id: params.workspaceId,
        organizationId: params.organizationId,
      },
      select: {
        draftBaseVersionId: true,
      },
    })
  )?.draftBaseVersionId;

  if (persistedDraftBaseVersionId) {
    const persistedDraftBase = await prisma.version.findFirst({
      where: {
        deletedAt: null,
        documentId: params.workspaceId,
        id: persistedDraftBaseVersionId,
        organizationId: params.organizationId,
      },
      select: { id: true },
    });

    if (persistedDraftBase) {
      return listVersionLineageIds({
        organizationId: params.organizationId,
        versionId: persistedDraftBase.id,
        workspaceId: params.workspaceId,
      });
    }
  }

  const latestVisibleVersion = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      labels: {
        some: {
          deletedAt: null,
          kind: 'milestone',
        },
      },
    },
    orderBy: [{ versionNum: 'desc' }, { lockedAt: 'desc' }],
    select: { id: true },
  });

  if (!latestVisibleVersion) {
    return [];
  }

  return listVersionLineageIds({
    organizationId: params.organizationId,
    versionId: latestVisibleVersion.id,
    workspaceId: params.workspaceId,
  });
}

async function listVersionLineageIds(params: {
  organizationId: string;
  versionId: string;
  workspaceId: string;
}) {
  const versions = await prisma.version.findMany({
    where: buildCommentVersionLineageFilter(params),
    select: {
      id: true,
      parentVersionId: true,
    },
  });

  return resolveCommentVersionLineageIds({
    startVersionId: params.versionId,
    versions,
  });
}
