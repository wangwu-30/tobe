import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@/lib/db/prisma';
import { getPlatformPaths } from '@/lib/platform/paths';
import {
  findLegacyHtmlPreviewSource,
  looksLikeHtmlDocument,
} from '@/lib/workspace/preview';

type SnapshotMirrorFile = {
  content?: string;
  nodeType?: string;
  path: string;
  type?: string;
};

export interface WorkspaceMirrorManager {
  getWorkspaceMirrorPath(organizationId: string, workspaceId: string): string;
  materializeWorkspaceMirror(params: {
    organizationId: string;
    snapshotId?: string | null;
    workspaceId: string;
  }): Promise<string>;
}

export async function materializeWorkspaceMirror(params: {
  organizationId: string;
  snapshotId?: string | null;
  workspaceId: string;
}) {
  const mirrorDir = getWorkspaceMirrorPath(params.organizationId, params.workspaceId);
  const files = params.snapshotId
    ? await listSnapshotMirrorFiles(params.organizationId, params.snapshotId)
    : await prisma.workspaceFile.findMany({
        where: {
          deletedAt: null,
          documentId: params.workspaceId,
          organizationId: params.organizationId,
        },
        orderBy: [{ path: 'asc' }, { sortOrder: 'asc' }],
      });
  const filesToMaterialize = injectLegacyPreviewEntrypoint(files);

  await fs.rm(mirrorDir, { force: true, recursive: true });
  await fs.mkdir(mirrorDir, { recursive: true });

  for (const entry of filesToMaterialize) {
    const relativePath = sanitizeMirrorPath(entry.path);
    const targetPath = path.join(mirrorDir, relativePath);
    const entryNodeType =
      'nodeType' in entry ? entry.nodeType : 'type' in entry ? entry.type : 'file';
    const isFolder = entryNodeType === 'folder';

    if (isFolder) {
      await fs.mkdir(targetPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, entry.content || '', 'utf8');
  }

  return mirrorDir;
}

export function getWorkspaceMirrorPath(organizationId: string, workspaceId: string) {
  const { workspaceMirrorRoot } = getPlatformPaths();
  return path.join(workspaceMirrorRoot, organizationId, workspaceId);
}

function sanitizeMirrorPath(filePath: string) {
  const normalized = path
    .normalize(filePath)
    .replace(/^(\.\.(\/|\\|$))+/, '')
    .replace(/^[/\\]+/, '');

  return normalized || 'untitled.txt';
}

async function listSnapshotMirrorFiles(organizationId: string, snapshotId: string) {
  const snapshot = await prisma.version.findFirst({
    where: {
      deletedAt: null,
      id: snapshotId,
      organizationId,
    },
    select: {
      content: true,
    },
  });

  if (!snapshot) {
    throw new Error('Snapshot not found.');
  }

  const parsed = JSON.parse(snapshot.content || '{}') as {
    files?: SnapshotMirrorFile[];
  };

  return (parsed.files || []).filter((file) => typeof file.path === 'string');
}

function injectLegacyPreviewEntrypoint(files: SnapshotMirrorFile[]) {
  const existingIndexHtml = files.find((file) => file.path === 'index.html') || null;
  if (
    existingIndexHtml &&
    typeof existingIndexHtml.content === 'string' &&
    looksLikeHtmlDocument(existingIndexHtml.content)
  ) {
    return files;
  }

  const legacyHtmlSource = findLegacyHtmlPreviewSource(
    files
      .filter((file): file is SnapshotMirrorFile & { content: string } => typeof file.content === 'string')
      .map((file) => ({
        content: file.content,
        nodeType: file.nodeType === 'folder' ? 'folder' : 'file',
        path: file.path,
        type: file.type,
      }))
  );
  if (!legacyHtmlSource) {
    return files;
  }

  if (existingIndexHtml) {
    return files.map((file) =>
      file.path === 'index.html'
        ? {
            ...legacyHtmlSource,
            path: 'index.html',
          }
        : file
    );
  }

  return [
    ...files,
    {
      ...legacyHtmlSource,
      path: 'index.html',
    },
  ];
}
