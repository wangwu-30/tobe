import type { WorkspaceFileData, WorkspaceVersionFileData } from '@/types';

type WorkspaceFileLike =
  | Pick<WorkspaceFileData, 'content' | 'kind' | 'name' | 'nodeType'>
  | Pick<WorkspaceVersionFileData, 'content' | 'kind' | 'name' | 'nodeType'>;

export function looksLikePlateDocumentContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed.startsWith('[')) {
    return false;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return (
      Array.isArray(parsed) &&
      (parsed.length === 0 ||
        parsed.every(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            ('children' in entry || 'text' in entry || 'type' in entry)
        ))
    );
  } catch {
    return false;
  }
}

export function isPlateBackedWorkspaceFile(file: WorkspaceFileLike | null | undefined) {
  if (!file || file.nodeType !== 'file') {
    return false;
  }

  if (file.kind === 'richtext') {
    return true;
  }

  return file.kind === 'markdown' && looksLikePlateDocumentContent(file.content);
}

export function stripMarkdownSuffix(name: string) {
  return name.replace(/\.mdx?$/i, '');
}

export function getWorkspaceFileDisplayName(
  file: WorkspaceFileLike | null | undefined
) {
  if (!file) {
    return '';
  }

  if (!isPlateBackedWorkspaceFile(file)) {
    return file.name;
  }

  return stripMarkdownSuffix(file.name);
}
