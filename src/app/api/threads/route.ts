import { NextRequest, NextResponse } from 'next/server';
import {
  parseCommentAgentMentions,
  refreshCommentAgentBindings,
  stringifyCommentAgentBindings,
  stringifyCommentAgentMentions,
} from '@/lib/comments/agents';
import { getSettingsFromHeaders } from '@/lib/ai/providers';
import { prisma } from '@/lib/db/prisma';
import {
  getCurrentDraftRevisionForDocument,
} from '@/lib/comments/version-binding';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';
import { parseVersionFiles } from '@/lib/workspace/service';
import { mapCommentThread } from '@/lib/wiki/service';
import type {
  CommentThreadData,
  CommentThreadInheritanceState,
} from '@/types';

type ThreadRecord = Parameters<typeof mapCommentThread>[0];
type SurfaceFileRecord = {
  content: string;
  id: string | null;
  path: string;
};

export async function GET(req: NextRequest) {
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

  const directWhere =
    versionId
      ? { versionId }
      : draftOnly
        ? { versionId: null, draftRevision: currentDraftRevision }
        : {};

  const directThreads = await prisma.commentThread.findMany({
    where: {
      deletedAt: null,
      documentId: workspaceId,
      ...(fileId ? { fileId } : {}),
      organizationId: actor.organizationId,
      ...directWhere,
    },
    include: {
      messages: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'asc' },
      },
      version: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const inheritedVersionIds = await resolveInheritedVersionIds({
    draftOnly,
    organizationId: actor.organizationId,
    versionId,
    workspaceId,
  });

  const inheritedThreads =
    inheritedVersionIds.length > 0
      ? await prisma.commentThread.findMany({
          where: {
            deletedAt: null,
            documentId: workspaceId,
            ...(fileId ? { fileId } : {}),
            organizationId: actor.organizationId,
            status: {
              in: ['open', 'applied'],
            },
            versionId: {
              in: inheritedVersionIds,
            },
          },
          include: {
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
            version: true,
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
  const seenInheritedFingerprints = new Set<string>();
  const versionRank = new Map(inheritedVersionIds.map((id, index) => [id, index]));
  const surfaceFilesById = new Map(
    surfaceFiles
      .filter((file): file is SurfaceFileRecord & { id: string } => Boolean(file.id))
      .map((file) => [file.id, file])
  );
  const combinedSurfaceText = buildCombinedSurfaceText(surfaceFiles);

  const mappedInheritedThreads = [...inheritedThreads]
    .sort((left, right) => {
      const leftRank = versionRank.get(left.versionId || '') ?? Number.MAX_SAFE_INTEGER;
      const rightRank = versionRank.get(right.versionId || '') ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const updatedDelta =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updatedDelta !== 0) {
        return updatedDelta;
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    })
    .map((thread) => {
      const mapped = mapCommentThread(thread);
      const state = classifyInheritedThread({
        combinedSurfaceText,
        directFingerprints,
        seenInheritedFingerprints,
        surfaceFilesById,
        thread: mapped,
      });

      if (state !== 'stale') {
        seenInheritedFingerprints.add(mapped.anchorFingerprint);
      }

      return mapThreadResponse(thread, state);
    });

  return NextResponse.json([...mappedDirectThreads, ...mappedInheritedThreads]);
}

export async function POST(req: NextRequest) {
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
  const mentions =
    typeof body.firstMessage === 'string' && body.firstMessage.trim()
      ? parseCommentAgentMentions(body.firstMessage, settings.commentAgents || [])
      : [];
  const agentBindings = refreshCommentAgentBindings({
    bindings: [],
    mentions,
  });

  const thread = await prisma.commentThread.create({
    data: {
      organizationId: actor.organizationId,
      documentId: workspaceId,
      fileId: body.fileId || null,
      versionId: body.versionId || null,
      anchorText: body.anchorText,
      draftRevision: draftRevision,
      selectionAnchor: body.selectionAnchor || null,
      agentBindingsJson:
        agentBindings.length > 0 ? stringifyCommentAgentBindings(agentBindings) : null,
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
      version: true,
    },
  });
  return NextResponse.json(mapCommentThread(thread));
}

function mapThreadResponse(
  thread: ThreadRecord,
  inheritanceState: CommentThreadInheritanceState
): CommentThreadData {
  const mapped = mapCommentThread(thread);

  return {
    ...mapped,
    sourceVersionId: mapped.versionId,
    scope: 'inherited',
    inheritanceState,
    inheritedFromVersionId: mapped.versionId,
    inheritedFromVersionTitle: mapped.version?.title || null,
    isInherited: true,
  };
}

function classifyInheritedThread(params: {
  combinedSurfaceText: string;
  directFingerprints: Set<string>;
  seenInheritedFingerprints: Set<string>;
  surfaceFilesById: Map<string, SurfaceFileRecord>;
  thread: CommentThreadData;
}): CommentThreadInheritanceState {
  if (
    !canMapThreadToCurrentSurface({
      combinedSurfaceText: params.combinedSurfaceText,
      surfaceFilesById: params.surfaceFilesById,
      thread: params.thread,
    })
  ) {
    return 'stale';
  }

  if (
    params.directFingerprints.has(params.thread.anchorFingerprint) ||
    params.seenInheritedFingerprints.has(params.thread.anchorFingerprint)
  ) {
    return 'superseded';
  }

  return 'actionable';
}

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

function canMapThreadToCurrentSurface(params: {
  combinedSurfaceText: string;
  surfaceFilesById: Map<string, SurfaceFileRecord>;
  thread: CommentThreadData;
}) {
  const fileContent =
    params.thread.fileId !== null
      ? params.surfaceFilesById.get(params.thread.fileId)?.content || null
      : null;

  if (params.thread.fileId !== null && !fileContent) {
    return false;
  }

  const searchableSurface = fileContent
    ? buildSearchableContent(fileContent)
    : params.combinedSurfaceText;
  const anchorCandidates = collectAnchorCandidates(params.thread);

  if (anchorCandidates.length === 0) {
    return true;
  }

  return anchorCandidates.some((candidate) => searchableSurface.includes(candidate));
}

function collectAnchorCandidates(thread: CommentThreadData) {
  const candidates = new Set<string>();
  const excerpt =
    typeof thread.reviewAnchor?.anchorPayload?.excerpt === 'string'
      ? thread.reviewAnchor.anchorPayload.excerpt
      : null;

  [thread.anchorText, excerpt].forEach((value) => {
    const normalized = normalizeSearchText(value || '');
    if (normalized) {
      candidates.add(normalized);
    }
  });

  return [...candidates];
}

function buildCombinedSurfaceText(surfaceFiles: SurfaceFileRecord[]) {
  return surfaceFiles.map((file) => buildSearchableContent(file.content)).join('\n');
}

function buildSearchableContent(content: string) {
  const rawText = normalizeSearchText(content);
  const extractedText: string[] = [];

  try {
    collectJsonText(JSON.parse(content), extractedText);
  } catch {
    return rawText;
  }

  const jsonText = normalizeSearchText(extractedText.join(' '));
  if (!jsonText) {
    return rawText;
  }

  if (!rawText) {
    return jsonText;
  }

  return `${rawText}\n${jsonText}`;
}

function collectJsonText(value: unknown, target: string[]) {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonText(entry, target));
    return;
  }

  Object.entries(value).forEach(([key, entry]) => {
    if (key === 'text' && typeof entry === 'string' && entry.trim()) {
      target.push(entry);
      return;
    }

    if (entry && typeof entry === 'object') {
      collectJsonText(entry, target);
    }
  });
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function resolveInheritedVersionIds(params: {
  draftOnly: boolean;
  organizationId: string;
  versionId: string | null;
  workspaceId: string;
}) {
  if (params.versionId) {
    return listAncestorVersionIds(params.organizationId, params.versionId);
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
      const ancestorIds = await listAncestorVersionIds(
        params.organizationId,
        persistedDraftBase.id
      );

      return [persistedDraftBase.id, ...ancestorIds];
    }
  }

  const latestVisibleVersion = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      documentId: params.workspaceId,
      organizationId: params.organizationId,
      versionType: {
        notIn: ['checkpoint', 'checkpoint_pinned'],
      },
    },
    orderBy: [{ versionNum: 'desc' }, { lockedAt: 'desc' }],
    select: { id: true },
  });

  if (!latestVisibleVersion) {
    return [];
  }

  const ancestorIds = await listAncestorVersionIds(
    params.organizationId,
    latestVisibleVersion.id
  );

  return [latestVisibleVersion.id, ...ancestorIds];
}

async function listAncestorVersionIds(organizationId: string, versionId: string) {
  const ids: string[] = [];
  let currentVersionId: string | null = versionId;

  while (currentVersionId) {
    const current: { parentVersionId: string | null } | null =
      await prisma.version.findFirst({
        where: {
          deletedAt: null,
          id: currentVersionId,
          organizationId,
        },
        select: {
          parentVersionId: true,
        },
      });

    if (!current?.parentVersionId) {
      break;
    }

    ids.push(current.parentVersionId);
    currentVersionId = current.parentVersionId;
  }

  return ids;
}
