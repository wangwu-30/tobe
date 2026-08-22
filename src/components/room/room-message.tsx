'use client';

import * as React from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  CornerUpLeft,
  RefreshCw,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { RoomAgent } from '@/lib/room/client';
import type { PendingRoomMessage } from '@/surfaces/room/use-project-room';
import type { RoomMessageDtoV1 } from '@/objects/room';

export type RoomMessageProps = {
  agents: readonly RoomAgent[];
  hostAgentId: string | null;
  index?: number;
  message: RoomMessageDtoV1;
  onReply?: (message: RoomMessageDtoV1) => void;
  replyTo?: RoomMessageDtoV1 | null;
  total?: number;
};

export function RoomMessage({
  agents,
  hostAgentId,
  index,
  message,
  onReply,
  replyTo = null,
  total,
}: RoomMessageProps) {
  const actor = getActorPresentation(message, agents, hostAgentId);

  return (
    <article
      aria-labelledby={`room-message-actor-${message.messageId}`}
      aria-posinset={index}
      aria-setsize={total}
      aria-roledescription="消息"
      className="group relative flex gap-3 px-3 py-3 pr-14 hover:bg-muted/25 sm:px-5 sm:pr-14"
      data-room-feed-item="message"
      data-message-id={message.messageId}
      data-testid="room-message"
      id={`room-message-${message.messageId}`}
    >
      <MessageAvatar coordinator={actor.coordinator} kind={actor.kind} name={actor.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className="text-sm font-semibold"
            id={`room-message-actor-${message.messageId}`}
          >
            {actor.name}
          </span>
          {actor.coordinator ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <Sparkles className="size-2.5" />
              协调 Agent
            </span>
          ) : actor.kind === 'agent' ? (
            <span className="text-[10px] font-medium text-violet-600 dark:text-violet-300">
              Agent
            </span>
          ) : null}
          <time
            className="text-[11px] text-muted-foreground"
            dateTime={message.createdAt}
            title={formatFullDate(message.createdAt)}
          >
            {formatMessageTime(message.createdAt)}
          </time>
        </div>

        {replyTo ? (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 border-l-2 pl-2 text-xs text-muted-foreground">
            <CornerUpLeft className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-foreground/70">
              {getActorPresentation(replyTo, agents, hostAgentId).name}
            </span>
            <span className="truncate">{replyTo.text}</span>
          </div>
        ) : null}

        <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-foreground/90">
          <MentionText message={message} />
        </p>

        {message.attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((attachment) => {
              const href = safeAttachmentHref(attachment.uri);
              const label = attachment.name || attachment.mediaType;
              return href ? (
                <a
                  className="max-w-full break-words rounded-md border bg-background px-2.5 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={href}
                  key={attachment.attachmentId}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {label}
                  <span className="sr-only">（在新标签页打开）</span>
                </a>
              ) : (
                <span
                  className="max-w-full break-words rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
                  key={attachment.attachmentId}
                >
                  {label}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      {onReply ? (
        <Button
          aria-label={`回复 ${actor.name}`}
          className="absolute right-3 top-2 size-10 opacity-100 shadow-sm transition-opacity motion-reduce:transition-none sm:size-8 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          onClick={() => onReply(message)}
          size="icon-xs"
          title="回复"
          type="button"
          variant="outline"
        >
          <CornerUpLeft />
        </Button>
      ) : null}
    </article>
  );
}

export function PendingRoomMessageItem({
  message,
  onDismiss,
  onRetry,
}: {
  message: PendingRoomMessage;
  onDismiss: (correlationId: string) => void;
  onRetry: (correlationId: string) => void;
}) {
  return (
    <article
      className={cn(
        'flex gap-3 px-3 py-3 sm:px-5',
        message.status === 'error' && 'bg-destructive/5'
      )}
      data-testid={`room-pending-${message.status}`}
    >
      <MessageAvatar kind="human" name="你" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">你</span>
          <PendingStatus status={message.status} />
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/80">
          {message.text}
        </p>
        {message.error ? (
          <div
            aria-live="assertive"
            className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-destructive"
            role="alert"
          >
            <AlertCircle className="size-3.5" />
            <span className="min-w-0 flex-1 break-words">
              {message.error} 请检查连接后重试或移除这条消息。
            </span>
            {message.retryable ? (
              <button
                className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 font-medium underline underline-offset-2 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive sm:min-h-8"
                onClick={() => onRetry(message.correlationId)}
                type="button"
              >
                <RefreshCw className="size-3" />
                重试
              </button>
            ) : null}
            <button
              aria-label="移除失败消息"
              className="flex size-10 items-center justify-center rounded-md hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive sm:size-8"
              onClick={() => onDismiss(message.correlationId)}
              type="button"
            >
              <X className="size-3" />
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MentionText({ message }: { message: RoomMessageDtoV1 }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  const mentions = [...message.mentions].sort(
    (left, right) => left.range.start - right.range.start
  );

  mentions.forEach((mention, index) => {
    if (
      mention.range.start < cursor ||
      mention.range.start < 0 ||
      mention.range.end <= mention.range.start ||
      mention.range.end > message.text.length
    ) return;
    if (mention.range.start > cursor) {
      parts.push(message.text.slice(cursor, mention.range.start));
    }
    parts.push(
      <span
        className="rounded bg-violet-50 px-0.5 font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
        data-agent-id={mention.agentId}
        key={`${mention.agentId}:${mention.range.start}:${index}`}
      >
        {message.text.slice(mention.range.start, mention.range.end)}
      </span>
    );
    cursor = mention.range.end;
  });
  if (cursor < message.text.length) parts.push(message.text.slice(cursor));
  return <>{parts}</>;
}

function MessageAvatar({
  coordinator = false,
  kind,
  name,
}: {
  coordinator?: boolean;
  kind: 'agent' | 'human' | 'system';
  name: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-xs font-semibold text-muted-foreground',
        coordinator &&
          'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
        kind === 'agent' &&
          !coordinator &&
          'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300'
      )}
    >
      {coordinator ? (
        <Sparkles className="size-4" />
      ) : kind === 'agent' ? (
        <Bot className="size-4" />
      ) : kind === 'system' ? (
        <CheckCircle2 className="size-4" />
      ) : name ? (
        <UserRound className="size-4" />
      ) : null}
    </div>
  );
}

function PendingStatus({ status }: { status: PendingRoomMessage['status'] }) {
  if (status === 'error') {
    return <span className="text-[11px] text-destructive">发送失败</span>;
  }
  if (status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Check className="size-3" /> 已接收，等待同步
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Clock3 className="size-3 animate-pulse motion-reduce:animate-none" /> 发送中…
    </span>
  );
}

function getActorPresentation(
  message: RoomMessageDtoV1,
  agents: readonly RoomAgent[],
  hostAgentId: string | null
) {
  if (message.actor.type === 'agent') {
    const actor = message.actor;
    const profile = agents.find((agent) => agent.id === actor.agentId);
    return {
      coordinator: actor.agentId === hostAgentId,
      kind: 'agent' as const,
      name:
        actor.displayName ||
        profile?.name ||
        actor.handle.replace(/^@/, ''),
    };
  }
  if (message.actor.type === 'human') {
    return {
      coordinator: false,
      kind: 'human' as const,
      name: message.actor.displayName || '你',
    };
  }
  return { coordinator: false, kind: 'system' as const, name: '系统' };
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return (sameDay ? SAME_DAY_FORMATTER : DATE_TIME_FORMATTER).format(date);
}

function formatFullDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : FULL_DATE_TIME_FORMATTER.format(date);
}

function safeAttachmentHref(value?: string) {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://room.local');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin === 'https://room.local'
      ? `${url.pathname}${url.search}${url.hash}`
      : url.href;
  } catch {
    return null;
  }
}

const SAME_DAY_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  month: 'short',
});
const FULL_DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});
