'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { CommentAgentTextarea } from '@/components/comments/comment-agent-textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import type { CommentTranslateFn } from './comment-sidebar-helpers';
import type { CommentAgentConfigData } from '@/types';

export function ManualCommentComposer({
  agents,
  anchorText,
  commentText,
  error,
  onAnchorTextChange,
  onClose,
  onCommentTextChange,
  onSubmit,
  submitting,
  t,
}: {
  agents: CommentAgentConfigData[];
  anchorText: string;
  commentText: string;
  error: string | null;
  onAnchorTextChange: (value: string) => void;
  onClose: () => void;
  onCommentTextChange: (value: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  t: CommentTranslateFn;
}) {
  const anchorFieldId = React.useId();
  const commentFieldId = React.useId();
  const titleId = React.useId();
  const errorId = React.useId();

  return (
    <form
      aria-busy={submitting}
      aria-labelledby={titleId}
      className="rounded-xl border border-border/70 bg-background/80 p-3"
      data-testid="manual-comment-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p id={titleId} className="text-xs font-semibold">
            {t('comments.manualComposerTitle')}
          </p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {t('comments.manualComposerDescription')}
          </p>
        </div>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-11 sm:size-6"
          aria-label={t('execution.close')}
          onClick={onClose}
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-3 space-y-2">
        <label
          className="text-[11px] font-medium text-foreground"
          htmlFor={anchorFieldId}
        >
          {t('comments.manualAnchorLabel')}
        </label>
        <Input
          id={anchorFieldId}
          name="comment-scope"
          autoComplete="off"
          data-testid="manual-comment-anchor-input"
          value={anchorText}
          onChange={(event) => onAnchorTextChange(event.target.value)}
          placeholder={t('comments.manualAnchorPlaceholder')}
        />
      </div>

      <div className="mt-3 space-y-2">
        <label
          className="text-[11px] font-medium text-foreground"
          htmlFor={commentFieldId}
        >
          {t('comments.manualCommentLabel')}
        </label>
        <CommentAgentTextarea
          agents={agents}
          id={commentFieldId}
          name="comment"
          required
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          data-testid="manual-comment-textarea"
          value={commentText}
          onChange={onCommentTextChange}
          placeholder={t('comments.manualCommentPlaceholder')}
          className="min-h-[104px]"
        />
      </div>

      {error ? (
        <p
          id={errorId}
          className="mt-2 break-words text-[11px] text-destructive [overflow-wrap:anywhere]"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] text-muted-foreground">
          {t('comments.agentMentionHint')}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-11 sm:h-8"
            onClick={onClose}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            className="h-11 sm:h-8"
            aria-busy={submitting}
            disabled={submitting || !commentText.trim()}
          >
            {submitting
              ? t('comments.manualCreating')
              : t('comments.manualCreate')}
          </Button>
        </div>
      </div>
    </form>
  );
}
