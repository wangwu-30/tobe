import type { CommentThreadStatus } from '@/types';

export const COMMENT_THREAD_STATUSES = [
  'open',
  'applied',
  'resolved',
] as const satisfies ReadonlyArray<CommentThreadStatus>;

export function isCommentThreadStatus(value: unknown): value is CommentThreadStatus {
  return (
    typeof value === 'string' &&
    COMMENT_THREAD_STATUSES.includes(value as CommentThreadStatus)
  );
}

export function normalizeCommentThreadStatus(
  value: string | null | undefined
): CommentThreadStatus {
  if (value === 'applied' || value === 'resolved') {
    return value;
  }

  return 'open';
}
