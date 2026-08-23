'use client';

import * as React from 'react';
import { LoaderCircle, MessageSquareText } from 'lucide-react';

import { useAppLanguage, useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export type WikiCreateConfirmationPayload = {
  conversationId: string | null;
  purpose: string;
  title: string;
};

export type WikiCreateConfirmationCopy = {
  cancel: string;
  confirm: string;
  description: string;
  nameLabel: string;
  namePlaceholder: string;
  nameRequired: string;
  purposeHint: string;
  purposeLabel: string;
  purposePlaceholder: string;
  sessionContinuation: string;
  submitting: string;
  title: string;
};

export type WikiCreateConfirmationDialogProps = {
  confirmLabel?: string;
  conversationId?: string | null;
  copy?: Partial<WikiCreateConfirmationCopy>;
  disableInputs?: boolean;
  errorMessage?: string | null;
  isSubmitting?: boolean;
  onConfirm: (payload: WikiCreateConfirmationPayload) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  suggestedGoal?: string | null;
  suggestedTitle?: string | null;
};

const LOCAL_COPY = {
  'en-US': {
    description:
      'Review the name and purpose before creating this Wiki Space. Nothing is created until you confirm.',
    nameLabel: 'Wiki name',
    purposeHint: 'Optional. Keep this to one short description of what belongs here.',
    purposeLabel: 'Purpose',
    purposePlaceholder: 'What should this Wiki help you keep or build?',
    sessionContinuation:
      'This Wiki Space will continue the same conversation, keeping its messages and context together.',
    title: 'Create this Wiki Space?',
  },
  'zh-CN': {
    description: '创建前请确认名称和用途。只有你点击确认后，才会创建这个 Wiki 空间。',
    nameLabel: 'Wiki 名称',
    purposeHint: '选填。用一句话说明这里要长期沉淀或推进什么。',
    purposeLabel: '用途',
    purposePlaceholder: '这个 Wiki 要帮助你沉淀或完成什么？',
    sessionContinuation: '创建后会在 Wiki 空间中继续同一对话，并保留当前消息和上下文。',
    title: '确认创建这个 Wiki 空间？',
  },
} as const;

export function WikiCreateConfirmationDialog({
  confirmLabel,
  conversationId = null,
  copy: copyOverrides,
  disableInputs = false,
  errorMessage = null,
  isSubmitting = false,
  onConfirm,
  onOpenChange,
  open,
  suggestedGoal = null,
  suggestedTitle = null,
}: WikiCreateConfirmationDialogProps) {
  const language = useAppLanguage();
  const t = useT();
  const nameId = React.useId();
  const purposeId = React.useId();
  const purposeHintId = React.useId();
  const nameErrorId = React.useId();
  const submitStatusId = React.useId();
  const nameRef = React.useRef<HTMLInputElement>(null);
  const [title, setTitle] = React.useState('');
  const [purpose, setPurpose] = React.useState('');
  const [nameError, setNameError] = React.useState<string | null>(null);

  const copy = React.useMemo<WikiCreateConfirmationCopy>(
    () => ({
      ...LOCAL_COPY[language],
      cancel: t('common.cancel'),
      confirm: t('home.createWikiSpace'),
      namePlaceholder: t('sidebar.renameProjectPlaceholder'),
      nameRequired: t('sidebar.renameProjectRequired'),
      submitting: t('goal.creatingProject'),
      ...copyOverrides,
      ...(confirmLabel ? { confirm: confirmLabel } : {}),
    }),
    [confirmLabel, copyOverrides, language, t]
  );

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setTitle(suggestedTitle?.trim() || '');
    setPurpose(suggestedGoal?.trim() || '');
    setNameError(null);
  }, [open, suggestedGoal, suggestedTitle]);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (isSubmitting && !nextOpen) {
        return;
      }

      onOpenChange(nextOpen);
    },
    [isSubmitting, onOpenChange]
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) {
      return;
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setNameError(copy.nameRequired);
      window.requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }

    setNameError(null);
    void onConfirm({
      conversationId: conversationId?.trim() || null,
      purpose: purpose.trim(),
      title: normalizedTitle,
    });
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] min-w-0 overflow-y-auto p-5 sm:max-h-[calc(100dvh-2rem)] sm:max-w-[520px] sm:p-6"
        data-testid="wiki-create-confirmation-dialog"
        onEscapeKeyDown={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) {
            event.preventDefault();
          }
        }}
        showCloseButton={!isSubmitting}
      >
        <DialogHeader className="min-w-0 pr-8 text-left">
          <DialogTitle className="text-balance leading-snug">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-pretty leading-6">
            {copy.description}
          </DialogDescription>
        </DialogHeader>

        {conversationId ? (
          <div
            className="flex min-w-0 items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-sm"
            data-testid="wiki-create-session-continuation"
          >
            <MessageSquareText
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            <p className="min-w-0 leading-5 [overflow-wrap:anywhere]">
              {copy.sessionContinuation}
            </p>
          </div>
        ) : null}

        <form aria-busy={isSubmitting} className="min-w-0 space-y-5" noValidate onSubmit={handleSubmit}>
          <div className="min-w-0 space-y-2">
            <Label htmlFor={nameId}>{copy.nameLabel}</Label>
            <Input
              aria-describedby={nameError ? nameErrorId : undefined}
              aria-invalid={nameError ? true : undefined}
              autoCapitalize="sentences"
              autoComplete="off"
              data-testid="wiki-create-name-input"
              disabled={isSubmitting || disableInputs}
              id={nameId}
              maxLength={120}
              name="wikiName"
              onChange={(event) => {
                setTitle(event.target.value);
                if (nameError && event.target.value.trim()) {
                  setNameError(null);
                }
              }}
              placeholder={copy.namePlaceholder}
              ref={nameRef}
              required
              value={title}
            />
            {nameError ? (
              <p className="text-sm text-destructive" id={nameErrorId} role="alert">
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor={purposeId}>{copy.purposeLabel}</Label>
            <Textarea
              aria-describedby={purposeHintId}
              className="min-h-24 resize-y"
              data-testid="wiki-create-purpose-input"
              disabled={isSubmitting || disableInputs}
              id={purposeId}
              maxLength={2000}
              name="wikiPurpose"
              onChange={(event) => setPurpose(event.target.value)}
              placeholder={copy.purposePlaceholder}
              value={purpose}
            />
            <p className="text-xs leading-5 text-muted-foreground" id={purposeHintId}>
              {copy.purposeHint}
            </p>
          </div>

          {errorMessage ? (
            <div
              aria-atomic="true"
              aria-live="assertive"
              className="break-words rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {errorMessage}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              className="w-full sm:w-auto"
              disabled={isSubmitting}
              onClick={() => handleOpenChange(false)}
              type="button"
              variant="ghost"
            >
              {copy.cancel}
            </Button>
            <Button
              aria-busy={isSubmitting}
              aria-describedby={isSubmitting ? submitStatusId : undefined}
              className="w-full sm:w-auto"
              data-testid="wiki-create-confirm"
              disabled={isSubmitting || !title.trim()}
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                  {copy.submitting}
                </>
              ) : (
                copy.confirm
              )}
            </Button>
          </DialogFooter>
          <p
            aria-atomic="true"
            aria-live="polite"
            className="sr-only"
            id={submitStatusId}
            role="status"
          >
            {isSubmitting ? copy.submitting : ''}
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
