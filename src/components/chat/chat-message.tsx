'use client';

import * as React from 'react';
import { Image as ImageIcon, MessageSquarePlus, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessageData } from '@/types';
import { Button } from '@/components/ui/button';
import { useT } from '@/components/providers/language-provider';

export function ChatMessage({
  message,
  onBranch,
}: {
  message: ChatMessageData;
  onBranch?: (messageId: string) => void;
}) {
  const t = useT();
  const isUser = message.role === 'user';
  const formattedContent = formatContent(message.content);
  const isThinking = !isUser && formattedContent.length === 0;

  return (
    <div className={cn('flex gap-3 px-3 py-3 sm:px-4', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'min-w-0 max-w-[92%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[85%]',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isThinking
              ? 'border border-border/60 bg-muted/40 text-foreground shadow-sm'
              : 'bg-muted text-foreground'
        )}
      >
        {isThinking ? (
          <ThinkingPlaceholder label={t('chat.planning')} />
        ) : (
          <div className="space-y-3">
            <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {formattedContent}
            </div>
            {message.attachments.length > 0 ? (
              <div className="space-y-2">
                {message.attachments.map((attachment) =>
                  attachment.kind === 'image' && attachment.previewUrl ? (
                    <figure
                      key={attachment.id}
                      className="overflow-hidden rounded-2xl border border-border/60 bg-background/70"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachment.previewUrl}
                        alt=""
                        width={640}
                        height={360}
                        loading="lazy"
                        decoding="async"
                        className="h-auto max-h-56 w-full object-contain"
                      />
                      <figcaption className="break-words border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                        {attachment.originalName}
                      </figcaption>
                    </figure>
                  ) : (
                    <div
                      key={attachment.id}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground"
                    >
                      {attachment.kind === 'image' ? (
                        <ImageIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Paperclip aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate" title={attachment.originalName}>
                        {attachment.originalName}
                      </span>
                    </div>
                  )
                )}
              </div>
            ) : null}
            {!isUser && onBranch ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 gap-1.5 px-2 text-[11px] sm:h-7"
                  data-testid={`chat-new-conversation-message-${message.id}`}
                  onClick={() => onBranch(message.id)}
                >
                  <MessageSquarePlus aria-hidden="true" className="h-3.5 w-3.5" />
                  {t('chat.startNewConversationHere')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingPlaceholder({ label }: { label: string }) {
  return (
    <div
      className="space-y-3"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span
          aria-hidden="true"
          className="h-2 w-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
        />
        {label}
      </div>

      <div
        aria-hidden="true"
        className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3"
      >
        <div className="space-y-2">
          <div className="h-2.5 w-3/5 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
          <div className="h-2.5 w-4/5 animate-pulse rounded-full bg-muted/80 motion-reduce:animate-none" />
          <div className="h-2.5 w-2/5 animate-pulse rounded-full bg-muted/60 motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

function formatContent(content: string): string {
  // Strip document blocks from display in chat
  return content.replace(/```document\n[\s\S]*?\n```/g, '📄 Document generated — see right panel').trim();
}
