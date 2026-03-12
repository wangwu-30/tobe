'use client';

import * as React from 'react';
import { GitBranchPlus, Image as ImageIcon, Paperclip } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ChatMessageData } from '@/types';
import { Button } from '@/components/ui/button';

export function ChatMessage({
  message,
  onBranch,
}: {
  message: ChatMessageData;
  onBranch?: (messageId: string) => void;
}) {
  const isUser = message.role === 'user';
  const formattedContent = formatContent(message.content);
  const isThinking = !isUser && formattedContent.length === 0;

  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : isThinking
              ? 'border border-border/60 bg-muted/40 text-foreground shadow-sm'
              : 'bg-muted text-foreground'
        )}
      >
        {isThinking ? (
          <ThinkingPlaceholder seed={message.id} />
        ) : (
          <div className="space-y-3">
            <div className="whitespace-pre-wrap break-words">{formattedContent}</div>
            {message.attachments.length > 0 ? (
              <div className="space-y-2">
                {message.attachments.map((attachment) =>
                  attachment.kind === 'image' && attachment.previewUrl ? (
                    <div
                      key={attachment.id}
                      className="overflow-hidden rounded-2xl border border-border/60 bg-background/70"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={attachment.previewUrl}
                        alt={attachment.originalName}
                        className="max-h-56 w-full object-contain"
                      />
                      <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                        {attachment.originalName}
                      </div>
                    </div>
                  ) : (
                    <div
                      key={attachment.id}
                      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1 text-[11px] text-muted-foreground"
                    >
                      {attachment.kind === 'image' ? (
                        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="truncate">{attachment.originalName}</span>
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
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={() => onBranch(message.id)}
                >
                  <GitBranchPlus className="h-3.5 w-3.5" />
                  Branch from here
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingPlaceholder({ seed }: { seed: string }) {
  const quote = React.useMemo(
    () => THINKING_QUOTES[Math.abs(hashSeed(seed)) % THINKING_QUOTES.length],
    [seed]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        Thinking through the next move
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-2">
        <p className="whitespace-pre-wrap break-words italic text-foreground/90">
          &ldquo;{quote.text}&rdquo;
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">
          {quote.author}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {THINKING_DOT_DELAYS.map(delay => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-foreground/45 animate-bounce"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}
      </div>
    </div>
  );
}

function formatContent(content: string): string {
  // Strip document blocks from display in chat
  return content.replace(/```document\n[\s\S]*?\n```/g, '📄 Document generated — see right panel').trim();
}

const THINKING_DOT_DELAYS = [0, 0.12, 0.24];

const THINKING_QUOTES = [
  { text: '知者不言，言者不知。', author: 'Tao Te Ching' },
  { text: 'Stay hungry, stay foolish.', author: 'Steve Jobs' },
  {
    text: 'Simplicity is the ultimate sophistication.',
    author: 'Leonardo da Vinci',
  },
  { text: 'The only way out is through.', author: 'Robert Frost' },
  { text: 'Talk is cheap. Show me the code.', author: 'Linus Torvalds' },
  { text: '万物并作，吾以观复。', author: 'Tao Te Ching' },
  {
    text: 'What we know is a drop, what we do not know is an ocean.',
    author: 'Isaac Newton',
  },
  {
    text: 'The journey of a thousand miles begins with one step.',
    author: 'Lao Tzu',
  },
];

function hashSeed(seed: string) {
  return [...seed].reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7);
}
