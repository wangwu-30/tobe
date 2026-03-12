export const COMMENT_REPLY_MODE_STORAGE_KEY = 'comment-reply-mode';
export const COMMENT_THREADS_CHANGED_EVENT = 'comment-threads-changed';
export const COMMENT_THREAD_FOCUS_EVENT = 'comment-thread-focus';
export const OPEN_SELECTION_COMMENT_COMPOSER_EVENT =
  'open-selection-comment-composer';

export type CommentThreadFocusDetail = {
  threadId: string;
};

export type CommentReplyMode = 'auto' | 'manual';

export function readCommentReplyMode(): CommentReplyMode {
  if (typeof window === 'undefined') {
    return 'auto';
  }

  const stored = window.localStorage.getItem(COMMENT_REPLY_MODE_STORAGE_KEY);
  return stored === 'manual' ? 'manual' : 'auto';
}

export function writeCommentReplyMode(mode: CommentReplyMode) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(COMMENT_REPLY_MODE_STORAGE_KEY, mode);
}

export function notifyCommentThreadsChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(COMMENT_THREADS_CHANGED_EVENT));
}

export function requestCommentThreadFocus(threadId: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<CommentThreadFocusDetail>(COMMENT_THREAD_FOCUS_EVENT, {
      detail: { threadId },
    })
  );
}

export function requestSelectionCommentComposerOpen() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(OPEN_SELECTION_COMMENT_COMPOSER_EVENT));
}
