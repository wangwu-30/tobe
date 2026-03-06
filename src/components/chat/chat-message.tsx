'use client';

import { cn } from '@/lib/utils';
import type { ChatMessageData } from '@/types';

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        )}
      >
        <div className="whitespace-pre-wrap break-words">{formatContent(message.content)}</div>
        {message.model && !isUser && (
          <div className="mt-1.5 text-xs opacity-50">{message.model}</div>
        )}
      </div>
    </div>
  );
}

function formatContent(content: string): string {
  // Strip document blocks from display in chat
  return content.replace(/```document\n[\s\S]*?\n```/g, '📄 Document generated — see right panel').trim();
}
