export const COMMENT_THREADS_CHANGED_EVENT = 'comment-threads-changed';
export const COMMENT_THREAD_FOCUS_EVENT = 'comment-thread-focus';
export const OPEN_MANUAL_COMMENT_COMPOSER_EVENT = 'open-manual-comment-composer';
export const OPEN_SELECTION_COMMENT_COMPOSER_EVENT =
  'open-selection-comment-composer';

export type CommentThreadFocusDetail = {
  threadId: string;
};

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

export function requestManualCommentComposerOpen() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(OPEN_MANUAL_COMMENT_COMPOSER_EVENT));
}
