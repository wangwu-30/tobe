import type { WorkspaceVersionType } from '@/types';

export function normalizeWorkspaceVersionType(
  value: string | null | undefined
): WorkspaceVersionType {
  if (value === 'checkpoint' || value === 'checkpoint_pinned') {
    return value;
  }

  return 'manual';
}
