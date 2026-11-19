import path from 'node:path';

import { readBoundKnowledgeDocumentForScope } from '@/agent/knowledge/search';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience';
import { prisma } from '@/lib/db/prisma';
import {
  createStagedChangeSet,
  type StagedChangePatchInput,
} from '@/lib/workspace/planning';
import type { StagedChangeSetData } from '@/types';

type BridgeActorContext = {
  actorType: 'user';
  deviceId: string;
  organizationId: string;
  userId: string;
};

export type ProposeKnowledgeToWikiInput = {
  documentPath: string;
  fileName?: string;
  spaceId: string;
  summary?: string;
  targetFileId?: string | null;
  title?: string;
  workspaceId: string;
};

export type ProposeKnowledgeToWikiResult = {
  changeSet: StagedChangeSetData;
  source: {
    commitSha: string;
    documentPath: string;
    snapshotId: string;
    spaceId: string;
  };
  workspaceId: string;
};

/**
 * Controlled Git Knowledge -> Wiki bridge. Reads a live-ACL-verified document
 * from a ready Git Knowledge snapshot bound to the target workspace/project and
 * stages a pending `StagedChangeSet` for human owner review. Never mutates the
 * live Wiki draft directly.
 */
export async function proposeKnowledgeToWikiChangeSet(
  actor: BridgeActorContext,
  input: ProposeKnowledgeToWikiInput
): Promise<ProposeKnowledgeToWikiResult> {
  const workspaceId = requireTrimmed(input.workspaceId, 'workspaceId');
  const spaceId = requireTrimmed(input.spaceId, 'spaceId');
  const documentPath = requireTrimmed(input.documentPath, 'documentPath');

  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
    },
    select: { role: true },
  });
  if (!membership) {
    throw new ForbiddenError('Organization membership is required to propose knowledge changes.');
  }

  const workspace = await prisma.document.findFirst({
    where: {
      deletedAt: null,
      id: workspaceId,
      organizationId: actor.organizationId,
    },
    select: {
      draftBaseVersionId: true,
      draftRevision: true,
      id: true,
      projectId: true,
      title: true,
    },
  });
  if (!workspace) {
    throw new NotFoundError('Target Wiki workspace not found.');
  }

  const space = await prisma.knowledgeSpace.findFirst({
    where: {
      id: spaceId,
      organizationId: actor.organizationId,
    },
    select: {
      id: true,
      ownerAgentId: true,
      scope: true,
    },
  });
  if (!space) {
    throw new NotFoundError(
      'Bound Git Knowledge document was not found or is not authorized for this workspace.'
    );
  }

  const knowledgeDoc = await readBoundKnowledgeDocumentForScope({
    agentId: space.scope === 'agent' ? space.ownerAgentId : null,
    documentPath,
    maxChars: 12_000,
    offsetChars: 0,
    organizationId: actor.organizationId,
    prisma,
    projectId: workspace.projectId ?? workspace.id,
    spaceId: space.id,
    workspaceId: workspace.id,
  });
  if (!knowledgeDoc) {
    throw new NotFoundError(
      'Bound Git Knowledge document was not found or is not authorized for this workspace.'
    );
  }

  const provenanceBanner = `<!-- Source: Git Knowledge space=${knowledgeDoc.spaceId} path=${knowledgeDoc.path} commit=${knowledgeDoc.commitSha.slice(0, 12)} -->`;
  const proposedBody = `${provenanceBanner}\n\n${knowledgeDoc.content}`;
  const targetFileId = input.targetFileId?.trim() || null;

  let changes: StagedChangePatchInput[];
  if (targetFileId) {
    const existing = await prisma.workspaceFile.findFirst({
      where: {
        deletedAt: null,
        documentId: workspace.id,
        id: targetFileId,
        organizationId: actor.organizationId,
        type: 'file',
      },
      select: {
        content: true,
        id: true,
        kind: true,
        name: true,
        revision: true,
      },
    });
    if (!existing) {
      throw new NotFoundError('Target workspace file not found.');
    }
    changes = [
      {
        fileId: existing.id,
        kind: normalizePatchKind(existing.kind),
        name: existing.name,
        nextContent: proposedBody,
        operation: 'update',
        preimage: {
          content: existing.content,
          revision: existing.revision,
        },
        summary: `Import ${knowledgeDoc.path} (${knowledgeDoc.commitSha.slice(0, 8)}) into ${existing.name}`,
      },
    ];
  } else {
    const existingRootFiles = await prisma.workspaceFile.findMany({
      where: {
        deletedAt: null,
        documentId: workspace.id,
        organizationId: actor.organizationId,
        parentId: null,
      },
      select: { name: true },
    });
    const existingNames = new Set(existingRootFiles.map((file) => file.name));
    const leafName = resolveUniqueLeafName(
      input.fileName?.trim() || path.basename(knowledgeDoc.path),
      existingNames
    );
    changes = [
      {
        fileId: null,
        kind: inferPatchKind(leafName),
        name: leafName,
        nextContent: proposedBody,
        operation: 'create',
        preimage: null,
        summary: `Import ${knowledgeDoc.path} (${knowledgeDoc.commitSha.slice(0, 8)}) from Git Knowledge`,
      },
    ];
  }

  const title =
    input.title?.trim() ||
    `Import from Git Knowledge: ${knowledgeDoc.path}`;
  const summary =
    input.summary?.trim() ||
    `Stage verified Git Knowledge document "${knowledgeDoc.path}" (commit ${knowledgeDoc.commitSha.slice(0, 12)}) into Wiki workspace "${workspace.title}" for owner review.`;

  const changeSet = await createStagedChangeSet(actor, {
    baseDraftRevision: workspace.draftRevision,
    baseVersionId: workspace.draftBaseVersionId,
    changes,
    sourceType: 'knowledge-bridge',
    summary,
    title,
    workspaceId: workspace.id,
  });

  return {
    changeSet,
    source: {
      commitSha: knowledgeDoc.commitSha,
      documentPath: knowledgeDoc.path,
      snapshotId: knowledgeDoc.snapshotId,
      spaceId: knowledgeDoc.spaceId,
    },
    workspaceId: workspace.id,
  };
}

function requireTrimmed(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function normalizePatchKind(kind: string): StagedChangePatchInput['kind'] {
  if (
    kind === 'markdown' ||
    kind === 'richtext' ||
    kind === 'code' ||
    kind === 'text'
  ) {
    return kind;
  }
  return 'markdown';
}

function inferPatchKind(fileName: string): StagedChangePatchInput['kind'] {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.txt') return 'text';
  if (ext === '.md' || ext === '.markdown' || ext === '.mdx') return 'markdown';
  if (
    ext === '.json' ||
    ext === '.ts' ||
    ext === '.tsx' ||
    ext === '.js' ||
    ext === '.jsx' ||
    ext === '.css' ||
    ext === '.html'
  ) {
    return 'code';
  }
  return 'markdown';
}

function resolveUniqueLeafName(rawName: string, existingNames: Set<string>): string {
  const sanitizedBase = rawName
    .replace(/[/\\:*?"<>|\0]+/g, '-')
    .replace(/^\.+/, '')
    .trim();
  const baseName = sanitizedBase || 'knowledge-import.md';
  if (!existingNames.has(baseName)) return baseName;

  const ext = path.extname(baseName);
  const stem = ext ? baseName.slice(0, -ext.length) : baseName;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${stem}-${suffix}${ext}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  throw new ValidationError('Unable to choose a unique filename for knowledge import.');
}
