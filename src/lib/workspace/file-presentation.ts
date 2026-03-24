import { safeJsonParse } from '@/framework/resilience';
import type { WorkspaceFileData, WorkspaceVersionFileData } from '@/types';

type WorkspaceFileLike =
  | Pick<WorkspaceFileData, 'content' | 'kind' | 'name' | 'nodeType'>
  | Pick<WorkspaceVersionFileData, 'content' | 'kind' | 'name' | 'nodeType'>;

export function looksLikePlateDocumentContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed.startsWith('[')) {
    return false;
  }

  const parsed = safeJsonParse<unknown>(trimmed, null);
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
}

export function isPlateBackedWorkspaceFile(file: WorkspaceFileLike | null | undefined) {
  if (!file || file.nodeType !== 'file') {
    return false;
  }

  if (file.kind === 'richtext') {
    return true;
  }

  // All markdown files are now renderable as rich text.
  // parsePlateContent handles both Plate JSON and legacy markdown content.
  if (file.kind === 'markdown') {
    return true;
  }

  return false;
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
