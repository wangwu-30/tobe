import type { Value } from 'platejs';

import { safeJsonParse } from '@/framework/resilience';
import type {
  WorkspaceFileData,
  WorkspaceVersionFileData,
} from '@/types';

type VersionPayload = {
  files: WorkspaceVersionFileData[];
  workspaceTitle?: string;
};

type WorkspaceFileRecord = {
  content: string;
  createdAt: Date;
  createdByUserId: string | null;
  deletedAt: Date | null;
  documentId: string;
  id: string;
  isPrimary: boolean;
  kind: string;
  language: string | null;
  name: string;
  organizationId: string;
  originDeviceId: string | null;
  parentId: string | null;
  path: string;
  role?: string | null;
  revision: number;
  sortOrder: number;
  type: string;
  updatedAt: Date;
};

export function normalizeWorkspaceFileRole(
  role?: string | null
): WorkspaceFileData['role'] {
  return role === 'support' ? 'support' : 'deliverable';
}

export function normalizeFileKind(value: string): WorkspaceFileData['kind'] {
  if (value === 'markdown' || value === 'text' || value === 'code') {
    return value;
  }

  return 'richtext';
}

export function mapWorkspaceFile(file: WorkspaceFileRecord): WorkspaceFileData {
  return {
    id: file.id,
    organizationId: file.organizationId,
    workspaceId: file.documentId,
    parentId: file.parentId,
    name: file.name,
    path: file.path,
    nodeType: file.type === 'folder' ? 'folder' : 'file',
    kind: normalizeFileKind(file.kind),
    role: normalizeWorkspaceFileRole(file.role),
    language: file.language,
    content: file.content,
    sortOrder: file.sortOrder,
    isPrimary: file.isPrimary,
    createdByUserId: file.createdByUserId,
    originDeviceId: file.originDeviceId,
    revision: file.revision,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  };
}

export function parseVersionFiles(content: string): WorkspaceVersionFileData[] {
  const parsed = safeJsonParse<VersionPayload | Value | null>(content, null);
  if (
    parsed &&
    typeof parsed === 'object' &&
    'files' in parsed &&
    Array.isArray((parsed as VersionPayload).files)
  ) {
    return (parsed as VersionPayload).files.map((file) => ({
      ...file,
      kind: normalizeFileKind(file.kind),
      role: normalizeWorkspaceFileRole(file.role),
      language: file.language || null,
      nodeType: file.nodeType === 'folder' ? 'folder' : 'file',
      versionId: file.versionId || null,
    }));
  }

  return [
    {
      id: 'legacy-primary',
      workspaceId: 'legacy',
      parentId: null,
      name: 'main.md',
      path: 'main.md',
      nodeType: 'file',
      kind: 'richtext',
      role: 'deliverable',
      language: 'markdown',
      content,
      sortOrder: 0,
      isPrimary: true,
      createdByUserId: null,
      originDeviceId: null,
      revision: 1,
      versionId: null,
    },
  ];
}

export function serializeWorkspaceVersion(payload: VersionPayload) {
  return JSON.stringify(payload);
}

export function mapWorkspaceFileToVersion(
  file: WorkspaceFileData
): WorkspaceVersionFileData {
  return {
    id: file.id,
    workspaceId: file.workspaceId,
    parentId: file.parentId,
    name: file.name,
    path: file.path,
    nodeType: file.nodeType,
    kind: file.kind,
    role: file.role,
    language: file.language,
    content: file.content,
    sortOrder: file.sortOrder,
    isPrimary: file.isPrimary,
    versionId: null,
    createdByUserId: file.createdByUserId,
    originDeviceId: file.originDeviceId,
    revision: file.revision,
  };
}

export function resolvePrimaryFile(files: WorkspaceFileRecord[]) {
  const deliverableFiles = files.filter(
    (file) => normalizeWorkspaceFileRole(file.role) === 'deliverable'
  );
  return (
    deliverableFiles.find((file) => file.isPrimary && file.type === 'file') ||
    deliverableFiles.find((file) => file.type === 'file') ||
    null
  );
}

export function resolveCurrentWorkspaceFile(params: {
  fileId: string | null;
  files: WorkspaceFileData[];
}) {
  if (params.fileId) {
    const requestedFile = params.files.find(
      (file) => file.id === params.fileId && file.nodeType === 'file'
    );
    if (requestedFile) {
      return requestedFile;
    }
  }

  const deliverableFiles = params.files.filter((file) => file.role === 'deliverable');
  return (
    deliverableFiles.find((file) => file.isPrimary) ||
    deliverableFiles.find((file) => file.nodeType === 'file') ||
    null
  );
}

export function resolveCurrentVersionFile(params: {
  fileId: string | null;
  files: WorkspaceVersionFileData[];
}) {
  if (params.fileId) {
    const requestedFile = params.files.find(
      (file) => file.id === params.fileId && file.nodeType === 'file'
    );
    if (requestedFile) {
      return requestedFile;
    }
  }

  const deliverableFiles = params.files.filter((file) => file.role === 'deliverable');
  return (
    deliverableFiles.find((file) => file.isPrimary) ||
    deliverableFiles.find((file) => file.nodeType === 'file') ||
    null
  );
}

export function getDefaultFileName(
  kind: 'richtext' | 'markdown' | 'text' | 'code'
) {
  switch (kind) {
    case 'markdown':
      return 'main';
    case 'code':
      return 'index.ts';
    case 'text':
      return 'notes.txt';
    default:
      return 'main';
  }
}

export function getInitialFileContent(
  kind: 'richtext' | 'markdown' | 'text' | 'code'
) {
  switch (kind) {
    case 'code':
      return '';
    case 'text':
      return '';
    case 'markdown':
      return '[]';
    default:
      return '[]';
  }
}

export function inferFileKind(name: string): WorkspaceFileData['kind'] {
  if (name.endsWith('.md') || name.endsWith('.mdx')) {
    return 'markdown';
  }

  if (
    name.endsWith('.ts') ||
    name.endsWith('.tsx') ||
    name.endsWith('.js') ||
    name.endsWith('.jsx') ||
    name.endsWith('.css') ||
    name.endsWith('.html') ||
    name.endsWith('.json')
  ) {
    return 'code';
  }

  if (name.endsWith('.txt')) {
    return 'text';
  }

  return 'richtext';
}

export function inferFileLanguage(name: string) {
  const extension = name.split('.').pop()?.toLowerCase();
  if (!extension || extension === name.toLowerCase()) {
    return null;
  }

  const languageMap: Record<string, string> = {
    css: 'css',
    html: 'html',
    js: 'javascript',
    json: 'json',
    jsx: 'javascript',
    md: 'markdown',
    mdx: 'markdown',
    ts: 'typescript',
    tsx: 'typescript',
    txt: 'text',
  };

  return languageMap[extension] || extension;
}

export function makeUniqueChildName(
  name: string,
  siblings: Array<{ name: string }>
) {
  if (!siblings.some((sibling) => sibling.name === name)) {
    return name;
  }

  const extensionIndex = name.lastIndexOf('.');
  const hasExtension = extensionIndex > 0;
  const base = hasExtension ? name.slice(0, extensionIndex) : name;
  const extension = hasExtension ? name.slice(extensionIndex) : '';

  let counter = 2;
  let candidate = `${base} ${counter}${extension}`;
  while (siblings.some((sibling) => sibling.name === candidate)) {
    counter += 1;
    candidate = `${base} ${counter}${extension}`;
  }

  return candidate;
}

export function buildWorkspacePath(parentPath: string | null, name: string) {
  return parentPath ? `${parentPath}/${name}` : name;
}

export function getParentWorkspacePath(filePath: string) {
  const slashIndex = filePath.lastIndexOf('/');
  if (slashIndex === -1) {
    return null;
  }

  return filePath.slice(0, slashIndex) || null;
}

export function getWorkspacePathDepth(filePath: string) {
  return filePath.split('/').length;
}
