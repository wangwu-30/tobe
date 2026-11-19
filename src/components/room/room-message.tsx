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

import { useAppLanguage, useT } from '@/components/providers/language-provider';
import { Button } from '@/components/ui/button';
import type { AppLanguage } from '@/lib/i18n/language';
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
  const language = useAppLanguage();
  const t = useT();
  const actor = getActorPresentation(message, agents, hostAgentId, t);

  return (
    <article
      aria-labelledby={`room-message-actor-${message.messageId}`}
      aria-posinset={index}
      aria-setsize={total}
      aria-roledescription={t('room.messageRoleDescription')}
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
              {t('room.coordinatorAgentBadge')}
            </span>
          ) : actor.kind === 'agent' ? (
            <span className="text-[10px] font-medium text-violet-600 dark:text-violet-300">
              {t('room.agentBadge')}
            </span>
          ) : null}
          <time
            className="text-[11px] text-muted-foreground"
            dateTime={message.createdAt}
            title={formatFullDate(message.createdAt, language)}
          >
            {formatMessageTime(message.createdAt, language)}
          </time>
        </div>

        {replyTo ? (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 border-l-2 pl-2 text-xs text-muted-foreground">
            <CornerUpLeft className="size-3 shrink-0" />
            <span className="shrink-0 font-medium text-foreground/70">
              {getActorPresentation(replyTo, agents, hostAgentId, t).name}
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
                  <span className="sr-only">{t('room.opensInNewTab')}</span>
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
          aria-label={t('room.replyToActorAria', { name: actor.name })}
          className="absolute right-3 top-2 size-10 opacity-100 shadow-sm transition-opacity motion-reduce:transition-none sm:size-8 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          onClick={() => onReply(message)}
          size="icon-xs"
          title={t('room.replyTitle')}
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
  const t = useT();
  const youLabel = t('room.actorYou');
  return (
    <article
      className={cn(
        'flex gap-3 px-3 py-3 sm:px-5',
        message.status === 'error' && 'bg-destructive/5'
      )}
      data-testid={`room-pending-${message.status}`}
    >
      <MessageAvatar kind="human" name={youLabel} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{youLabel}</span>
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
              {t('room.pendingErrorSuffix', { error: message.error })}
            </span>
            {message.retryable ? (
              <button
                className="inline-flex min-h-10 items-center gap-1 rounded-md px-2 font-medium underline underline-offset-2 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive sm:min-h-8"
                onClick={() => onRetry(message.correlationId)}
                type="button"
              >
                <RefreshCw className="size-3" />
                {t('room.retry')}
              </button>
            ) : null}
            <button
              aria-label={t('room.dismissFailedAria')}
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
  const t = useT();
  if (status === 'error') {
    return <span className="text-[11px] text-destructive">{t('room.pendingStatusError')}</span>;
  }
  if (status === 'accepted') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Check className="size-3" /> {t('room.pendingStatusAccepted')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Clock3 className="size-3 animate-pulse motion-reduce:animate-none" /> {t('room.pendingStatusSending')}
    </span>
  );
}

function getActorPresentation(
  message: RoomMessageDtoV1,
  agents: readonly RoomAgent[],
  hostAgentId: string | null,
  t: ReturnType<typeof useT>
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
      name: message.actor.displayName || t('room.actorYou'),
    };
  }
  return { coordinator: false, kind: 'system' as const, name: t('room.actorSystem') };
}

function formatMessageTime(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return (sameDay ? SAME_DAY_FORMATTERS[language] : DATE_TIME_FORMATTERS[language]).format(date);
}

function formatFullDate(value: string, language: AppLanguage) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : FULL_DATE_TIME_FORMATTERS[language].format(date);
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

const SAME_DAY_FORMATTERS: Record<AppLanguage, Intl.DateTimeFormat> = {
  'en-US': new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }),
  'zh-CN': new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }),
};
const DATE_TIME_FORMATTERS: Record<AppLanguage, Intl.DateTimeFormat> = {
  'en-US': new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }),
  'zh-CN': new Intl.DateTimeFormat('zh-CN', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  }),
};
const FULL_DATE_TIME_FORMATTERS: Record<AppLanguage, Intl.DateTimeFormat> = {
  'en-US': new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }),
  'zh-CN': new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }),
};
