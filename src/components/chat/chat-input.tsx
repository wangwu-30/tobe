'use client';

import * as React from 'react';
import { Paperclip, Search, SendHorizontal, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/components/providers/language-provider';
import {
  CHAT_CLIPBOARD_TEXT_FILE_THRESHOLD,
  type ChatComposerAttachment,
} from '@/components/chat/attachment-types';
import { ModelPicker } from '@/components/ai/model-picker';
import type { ModelCatalogData, ModelSelectionData, ResearchMode } from '@/types';
import {
  OPEN_AGENT_COMPOSER_EVENT,
  type OpenAgentComposerDetail,
} from '@/agent/events';

type OversizedPasteSnapshot = {
  expectedValue: string;
  selectionStart: number;
  value: string;
};

export function ChatInput({
  allowAttachments = true,
  allowDeepResearch = true,
  capabilityHint,
  onSend,
  onStop,
  isLoading,
  disabled,
  modelCatalog,
  modelLabel,
  modelSelection,
  onModelSelectionChange,
}: {
  allowAttachments?: boolean;
  allowDeepResearch?: boolean;
  capabilityHint?: string | null;
  onSend: (
    message: string,
    options?: {
      attachments?: ChatComposerAttachment[];
      researchMode?: ResearchMode;
    }
  ) => void;
  onStop?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  modelCatalog?: ModelCatalogData | null;
  modelLabel?: string | null;
  modelSelection?: ModelSelectionData | null;
  onModelSelectionChange?: (selection: ModelSelectionData) => void;
}) {
  const t = useT();
  const [value, setValue] = React.useState('');
  const [attachments, setAttachments] = React.useState<ChatComposerAttachment[]>([]);
  const [researchMode, setResearchMode] = React.useState<ResearchMode>('light');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const attachmentsRef = React.useRef<ChatComposerAttachment[]>([]);
  const oversizedPasteRef = React.useRef<OversizedPasteSnapshot | null>(null);

  const resetComposer = React.useCallback(() => {
    setValue('');
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
      return [];
    });

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const addAttachments = React.useCallback((files: File[], source: 'upload' | 'clipboard') => {
    const nextAttachments = files.map((file) => createComposerAttachment(file, source));
    setAttachments((current) => [...current, ...nextAttachments]);
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) return;
    onSend(trimmed, {
      attachments: allowAttachments ? attachments : [],
      researchMode: allowDeepResearch ? researchMode : 'light',
    });
    resetComposer();
    setResearchMode('light');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!allowAttachments) {
        return;
      }

      const clipboardItems = Array.from(event.clipboardData.items || []);
      const files = clipboardItems
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (files.length > 0) {
        addAttachments(files, 'clipboard');
        return;
      }

      const text = event.clipboardData.getData('text/plain');
      if (text.length > CHAT_CLIPBOARD_TEXT_FILE_THRESHOLD) {
        const currentValue = event.currentTarget.value;
        const selectionStart = event.currentTarget.selectionStart ?? currentValue.length;
        const selectionEnd = event.currentTarget.selectionEnd ?? selectionStart;
        const snapshot = {
          expectedValue: `${currentValue.slice(0, selectionStart)}${text}${currentValue.slice(selectionEnd)}`,
          selectionStart,
          value: currentValue,
        };
        oversizedPasteRef.current = snapshot;
        window.setTimeout(() => {
          if (oversizedPasteRef.current === snapshot) {
            oversizedPasteRef.current = null;
          }
        }, 0);

        const file = new File([text], `clipboard-${formatTimestampForFileName()}.txt`, {
          type: 'text/plain',
        });
        addAttachments([file], 'clipboard');
      }
    },
    [addAttachments, allowAttachments]
  );

  const handleFileChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) {
        return;
      }

      addAttachments(files, 'upload');
      event.target.value = '';
    },
    [addAttachments]
  );

  const removeAttachment = React.useCallback((attachmentId: string) => {
    setAttachments((current) => {
      const next = current.filter((attachment) => attachment.id !== attachmentId);
      const removed = current.find((attachment) => attachment.id === attachmentId);
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return next;
    });
  }, []);

  React.useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [value]);

  React.useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  React.useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, []);

  const handleChange = React.useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const oversizedPaste = oversizedPasteRef.current;
    const inputType = (event.nativeEvent as InputEvent).inputType;
    if (
      oversizedPaste &&
      (inputType === 'insertFromPaste' || event.target.value === oversizedPaste.expectedValue)
    ) {
      oversizedPasteRef.current = null;
      event.currentTarget.value = oversizedPaste.value;
      setValue(oversizedPaste.value);
      window.requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(
          oversizedPaste.selectionStart,
          oversizedPaste.selectionStart
        );
      });
      return;
    }

    oversizedPasteRef.current = null;
    setValue(event.target.value);
  }, []);

  React.useEffect(() => {
    const handleAgentComposerOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenAgentComposerDetail>).detail;
      if (detail?.prompt) {
        setValue((current) => {
          if (!current.trim()) return detail.prompt || '';
          return `${current.trimEnd()}\n\n---\n\n${detail.prompt}`;
        });
      }
      window.requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };

    window.addEventListener(OPEN_AGENT_COMPOSER_EVENT, handleAgentComposerOpen);
    return () => {
      window.removeEventListener(OPEN_AGENT_COMPOSER_EVENT, handleAgentComposerOpen);
    };
  }, []);

  return (
    <div className="border-t border-border bg-background p-3" data-testid="chat-composer">
      {allowAttachments ? (
        <input
          aria-label={t('chat.addAttachments')}
          autoComplete="off"
          name="chatAttachments"
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      ) : null}

      <div className="mb-2 flex flex-col gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {modelCatalog && modelSelection && onModelSelectionChange ? (
              <ModelPicker
                allowUnconfiguredProviders={false}
                catalog={modelCatalog}
                disabled={disabled || isLoading}
                idPrefix="chat-model"
                namePrefix="chatModel"
                value={modelSelection}
                variant="compact"
                onChange={onModelSelectionChange}
              />
            ) : (
              <div className="truncate pt-1">
                {modelLabel
                  ? t('chat.modelLabel', { model: modelLabel })
                  : t('chat.modelFromSettings')}
              </div>
            )}
          </div>
          {allowDeepResearch ? (
            <button
              aria-pressed={researchMode === 'deep'}
              disabled={disabled || isLoading}
              type="button"
              className={`inline-flex min-h-11 shrink-0 touch-manipulation items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 sm:min-h-0 ${
                researchMode === 'deep'
                  ? 'border-foreground/20 bg-foreground text-background'
                  : 'border-border bg-muted/30 text-muted-foreground'
              }`}
              onClick={() =>
                setResearchMode((current) => (current === 'deep' ? 'light' : 'deep'))
              }
            >
              <Search aria-hidden="true" className="h-3 w-3" />
              {researchMode === 'deep'
                ? t('chat.deepResearchEnabled')
                : t('chat.deepResearch')}
            </button>
          ) : null}
        </div>
      </div>

      {allowDeepResearch && researchMode === 'deep' ? (
        <div className="mb-2 rounded-xl border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          {t('chat.deepResearchInfo')}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div
          aria-label={t('chat.attachmentsLabel')}
          aria-live="polite"
          className="mb-2 flex flex-wrap gap-2"
          role="list"
        >
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1 text-[11px] text-foreground"
              role="listitem"
            >
              <span className="truncate" title={attachment.file.name}>
                {attachment.file.name}
                {attachment.kind === 'image'
                  ? ` · ${t('chat.attachmentImage')}`
                  : attachment.kind === 'text'
                    ? ` · ${t('chat.attachmentText')}`
                    : ` · ${t('chat.attachmentFile')}`}
              </span>
              <button
                aria-label={t('chat.removeAttachment', { name: attachment.file.name })}
                type="button"
                className="-m-2 inline-flex size-11 shrink-0 touch-manipulation items-center justify-center text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none sm:-m-1.5 sm:size-6"
                onClick={() => removeAttachment(attachment.id)}
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {allowAttachments ? (
          <Button
            aria-label={t('chat.addAttachments')}
            type="button"
            size="icon"
            variant="outline"
            className="shrink-0 rounded-xl"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isLoading}
          >
            <Paperclip aria-hidden="true" className="h-4 w-4" />
          </Button>
        ) : null}
        <Textarea
          aria-label={t('chat.messageLabel')}
          autoComplete="off"
          data-testid="agent-composer-input"
          name="message"
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            researchMode === 'deep'
              ? t('chat.askWithDeepResearchPlaceholder')
              : t('chat.askAiPlaceholder')
          }
          className="min-h-[44px] max-h-[200px] resize-none overscroll-contain rounded-xl border-muted-foreground/20"
          rows={1}
          disabled={disabled}
        />
        {isLoading ? (
          <Button
            aria-label={t('chat.stopGenerating')}
            type="button"
            size="icon"
            variant="ghost"
            onClick={onStop}
            className="shrink-0 rounded-xl"
          >
            <Square aria-hidden="true" className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            aria-label={t('chat.sendMessage')}
            type="button"
            size="icon"
            onClick={handleSubmit}
            disabled={(!value.trim() && attachments.length === 0) || disabled}
            className="shrink-0 rounded-xl"
          >
            <SendHorizontal aria-hidden="true" className="h-4 w-4" />
          </Button>
        )}
      </div>

      {capabilityHint || allowAttachments ? (
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          {capabilityHint || t('chat.attachmentHint')}
        </p>
      ) : null}
    </div>
  );
}

function createComposerAttachment(
  file: File,
  source: 'upload' | 'clipboard'
): ChatComposerAttachment {
  const kind = file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('text/')
      ? 'text'
      : 'file';

  return {
    file,
    id: `${source}-${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
    source,
  };
}

function formatTimestampForFileName() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
