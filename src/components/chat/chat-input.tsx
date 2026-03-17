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

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  disabled,
  modelCatalog,
  modelLabel,
  modelSelection,
  onModelSelectionChange,
}: {
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

  const addAttachments = React.useCallback(async (files: File[], source: 'upload' | 'clipboard') => {
    const nextAttachments = files.map((file) => createComposerAttachment(file, source));
    setAttachments((current) => [...current, ...nextAttachments]);
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || isLoading) return;
    onSend(trimmed, { attachments, researchMode });
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
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardItems = Array.from(event.clipboardData.items || []);
      const files = clipboardItems
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (files.length > 0) {
        event.preventDefault();
        await addAttachments(files, 'clipboard');
        return;
      }

      const text = event.clipboardData.getData('text/plain');
      if (text.length > CHAT_CLIPBOARD_TEXT_FILE_THRESHOLD) {
        event.preventDefault();
        const file = new File([text], `clipboard-${formatTimestampForFileName()}.txt`, {
          type: 'text/plain',
        });
        await addAttachments([file], 'clipboard');
      }
    },
    [addAttachments]
  );

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);
      if (files.length === 0) {
        return;
      }

      await addAttachments(files, 'upload');
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
    return () => {
      attachments.forEach((attachment) => {
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
        }
      });
    };
  }, [attachments]);

  return (
    <div className="border-t border-border bg-background p-3" data-testid="chat-composer">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="mb-2 flex flex-col gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {modelCatalog && modelSelection && onModelSelectionChange ? (
              <ModelPicker
                allowUnconfiguredProviders={false}
                catalog={modelCatalog}
                disabled={disabled || isLoading}
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
          <button
            type="button"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors ${
              researchMode === 'deep'
                ? 'border-foreground/20 bg-foreground text-background'
                : 'border-border bg-muted/30 text-muted-foreground'
            }`}
            onClick={() =>
              setResearchMode((current) => (current === 'deep' ? 'light' : 'deep'))
            }
          >
            <Search className="h-3 w-3" />
            {researchMode === 'deep'
              ? t('chat.deepResearchEnabled')
              : t('chat.deepResearch')}
          </button>
        </div>
      </div>

      {researchMode === 'deep' ? (
        <div className="mb-2 rounded-xl border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          {t('chat.deepResearchInfo')}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1 text-[11px] text-foreground"
            >
              <span className="truncate">
                {attachment.file.name}
                {attachment.kind === 'image'
                  ? ` · ${t('chat.attachmentImage')}`
                  : attachment.kind === 'text'
                    ? ` · ${t('chat.attachmentText')}`
                    : ` · ${t('chat.attachmentFile')}`}
              </span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => removeAttachment(attachment.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="shrink-0 rounded-xl"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isLoading}
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            researchMode === 'deep'
              ? t('chat.askWithDeepResearchPlaceholder')
              : t('chat.askAiPlaceholder')
          }
          className="min-h-[44px] max-h-[200px] resize-none rounded-xl border-muted-foreground/20"
          rows={1}
          disabled={disabled}
        />
        {isLoading ? (
          <Button
            size="icon"
            variant="ghost"
            onClick={onStop}
            className="shrink-0 rounded-xl"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={(!value.trim() && attachments.length === 0) || disabled}
            className="shrink-0 rounded-xl"
          >
            <SendHorizontal className="h-4 w-4" />
          </Button>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        {t('chat.attachmentHint')}
      </p>
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
