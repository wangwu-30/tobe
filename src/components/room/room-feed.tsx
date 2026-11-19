'use client';

import * as React from 'react';
import { MessagesSquare, Sparkles } from 'lucide-react';

import { useT } from '@/components/providers/language-provider';
import type { RoomAgent } from '@/lib/room/client';
import type { RoomEventDtoV1, RoomMessageDtoV1 } from '@/objects/room';
import type { PendingRoomMessage } from '@/surfaces/room/use-project-room';

import { PendingRoomMessageItem, RoomMessage } from './room-message';

export type RoomFeedProps = {
  agents: readonly RoomAgent[];
  events?: readonly RoomEventDtoV1[];
  hostAgentId: string | null;
  historyReady?: boolean;
  isLoading?: boolean;
  isSlowLoading?: boolean;
  messages: readonly RoomMessageDtoV1[];
  onDismissPending: (correlationId: string) => void;
  onReply: (message: RoomMessageDtoV1) => void;
  onRetryPending: (correlationId: string) => void;
  pendingMessages: readonly PendingRoomMessage[];
  renderEvent?: (event: RoomEventDtoV1) => React.ReactNode;
};

export function isRoomFeedNearBottom(
  metrics: {
    clientHeight: number;
    scrollHeight: number;
    scrollTop: number;
  },
  threshold = SCROLL_BOTTOM_THRESHOLD
) {
  return (
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < threshold
  );
}

export function getRoomFeedUnreadIncrement(params: {
  announcementReady: boolean;
  nextDurableItemCount: number;
  previousDurableItemCount: number;
  shouldStickToBottom: boolean;
}) {
  if (!params.announcementReady || params.shouldStickToBottom) return 0;
  return Math.max(
    0,
    params.nextDurableItemCount - params.previousDurableItemCount
  );
}

export function RoomFeed({
  agents,
  events = [],
  hostAgentId,
  historyReady = true,
  isLoading = false,
  isSlowLoading = false,
  messages,
  onDismissPending,
  onReply,
  onRetryPending,
  pendingMessages,
  renderEvent,
}: RoomFeedProps) {
  const t = useT();
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const shouldStickRef = React.useRef(true);
  const announcementReadyRef = React.useRef(false);
  const previousMessageCountRef = React.useRef(messages.length);
  const previousPendingStatusRef = React.useRef(new Map<string, string>());
  const previousDurableItemCountRef = React.useRef(0);
  const [announcement, setAnnouncement] = React.useState('');
  const [isNearBottom, setIsNearBottom] = React.useState(true);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const messageById = React.useMemo(
    () => new Map(messages.map((message) => [message.messageId, message])),
    [messages]
  );
  const renderedEvents = React.useMemo(
    () =>
      renderEvent
        ? events.flatMap((event) => {
            const content = renderEvent(event);
            return content === null ||
              content === undefined ||
              typeof content === 'boolean'
              ? []
              : [{ content, event }];
          })
        : [],
    [events, renderEvent]
  );
  const durableItems = React.useMemo(
    () =>
      [
        ...messages.map((message) => ({
          createdAt: message.createdAt,
          id: `message:${message.messageId}`,
          kind: 'message' as const,
          message,
        })),
        ...renderedEvents.map(({ content, event }) => ({
          content,
          createdAt: event.createdAt,
          event,
          id: `event:${event.eventId}`,
          kind: 'event' as const,
        })),
      ].sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id)
      ),
    [messages, renderedEvents]
  );
  const latestDurableItemId = durableItems.at(-1)?.id || null;

  const updateScrollState = React.useCallback((element: HTMLDivElement) => {
    const nearBottom = isRoomFeedNearBottom(element);
    shouldStickRef.current = nearBottom;
    setIsNearBottom(nearBottom);
    if (nearBottom) setUnreadCount(0);
  }, []);

  const scrollToLatest = React.useCallback((behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    shouldStickRef.current = true;
    setIsNearBottom(true);
    setUnreadCount(0);
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: prefersReducedMotion ? 'auto' : behavior,
    });
  }, []);

  React.useEffect(() => {
    if (!shouldStickRef.current || !scrollerRef.current) return;
    scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
  }, [latestDurableItemId, messages.length, pendingMessages.length]);

  React.useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const scroller = scrollerRef.current;
      if (scroller && shouldStickRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    updateScrollState(scroller);
  }, [updateScrollState, durableItems.length, pendingMessages.length]);

  React.useEffect(() => {
    const nextCount = durableItems.length;
    const delta = getRoomFeedUnreadIncrement({
      announcementReady: announcementReadyRef.current,
      nextDurableItemCount: nextCount,
      previousDurableItemCount: previousDurableItemCountRef.current,
      shouldStickToBottom: shouldStickRef.current,
    });
    previousDurableItemCountRef.current = nextCount;
    if (delta > 0) setUnreadCount((current) => current + delta);
  }, [durableItems.length]);

  React.useEffect(() => {
    if (isLoading) {
      announcementReadyRef.current = false;
      previousDurableItemCountRef.current = durableItems.length;
      return;
    }

    const nextPendingStatuses = new Map(
      pendingMessages.map((message) => [message.correlationId, message.status])
    );
    if (!announcementReadyRef.current) {
      announcementReadyRef.current = true;
      previousMessageCountRef.current = messages.length;
      previousPendingStatusRef.current = nextPendingStatuses;
      previousDurableItemCountRef.current = durableItems.length;
      return;
    }

    let nextAnnouncement = '';
    if (messages.length > previousMessageCountRef.current) {
      nextAnnouncement = t('room.announceNewMessage');
    } else {
      const changedPending = [...pendingMessages]
        .reverse()
        .find(
          (message) =>
            previousPendingStatusRef.current.get(message.correlationId) !== message.status
        );
      if (changedPending?.status === 'error') {
        nextAnnouncement = t('room.announceSendError');
      } else if (changedPending?.status === 'accepted') {
        nextAnnouncement = t('room.announceAccepted');
      } else if (changedPending?.status === 'pending') {
        nextAnnouncement = t('room.announceSending');
      }
    }

    previousMessageCountRef.current = messages.length;
    previousPendingStatusRef.current = nextPendingStatuses;
    if (nextAnnouncement) setAnnouncement(nextAnnouncement);
  }, [durableItems.length, isLoading, messages.length, pendingMessages, t]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        aria-atomic="false"
        aria-busy={isLoading}
        aria-label={t('room.feedAria')}
        aria-live={isNearBottom ? 'polite' : 'off'}
        aria-relevant="additions text"
        className="min-h-0 h-full overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid="room-feed"
        onScroll={(event) => updateScrollState(event.currentTarget)}
        ref={scrollerRef}
        role="log"
        tabIndex={0}
      >
        <span aria-atomic="true" aria-live="polite" className="sr-only">
          {announcement}
        </span>
        <span aria-live="polite" className="sr-only">
          {!isNearBottom && unreadCount > 0
            ? t('room.unreadAnnouncement', { count: unreadCount })
            : ''}
        </span>
        <div
          className="mx-auto flex min-h-full max-w-3xl flex-col justify-end py-4 sm:py-6"
          ref={contentRef}
        >
          {isLoading ? (
            <RoomFeedSkeleton isSlowLoading={isSlowLoading} />
          ) : !historyReady &&
            messages.length === 0 &&
            pendingMessages.length === 0 &&
            renderedEvents.length === 0 ? (
            <div
              className="mx-auto max-w-md px-6 py-16 text-center text-sm leading-6 text-muted-foreground"
              role="status"
            >
              {t('room.historyLoadIncomplete')}
            </div>
          ) : messages.length === 0 &&
            pendingMessages.length === 0 &&
            renderedEvents.length === 0 ? (
            <EmptyRoom host={agents.find((agent) => agent.id === hostAgentId) || null} />
          ) : (
            <>
              {durableItems.map((item, index) =>
                item.kind === 'message' ? (
                  <RoomMessage
                    agents={agents}
                    hostAgentId={hostAgentId}
                    index={index + 1}
                    key={item.id}
                    message={item.message}
                    onReply={onReply}
                    replyTo={
                      item.message.replyToMessageId
                        ? messageById.get(item.message.replyToMessageId) || null
                        : null
                    }
                    total={durableItems.length}
                  />
                ) : (
                  <div
                    aria-label={t('room.durableEventAria')}
                    aria-posinset={index + 1}
                    aria-setsize={durableItems.length}
                    data-testid="room-durable-event-feed"
                    key={item.id}
                    role="article"
                  >
                    {item.content}
                  </div>
                )
              )}
              {pendingMessages.map((message) => (
                <PendingRoomMessageItem
                  key={message.correlationId}
                  message={message}
                  onDismiss={onDismissPending}
                  onRetry={onRetryPending}
                />
              ))}
            </>
          )}
        </div>
      </div>
      {!isNearBottom && unreadCount > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3 sm:bottom-4">
          <button
            className="pointer-events-auto inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="room-feed-jump-to-latest"
            onClick={() => scrollToLatest()}
            type="button"
          >
            <span className="truncate">{t('room.jumpToLatest')}</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {unreadCount}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EmptyRoom({ host }: { host: RoomAgent | null }) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="flex size-11 items-center justify-center rounded-xl border bg-card shadow-xs"
      >
        <MessagesSquare className="size-5 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-base font-semibold">{t('room.emptyTitle')}</h2>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
        {host ? (
          <>
            {t('room.emptyBodyWithHostPrefix')}
            <span className="font-medium text-foreground">{host.name}</span>
            {t('room.emptyBodyWithHostSuffix')}
          </>
        ) : (
          t('room.emptyBodyNoHost')
        )}
      </p>
      <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <Sparkles className="size-3" />
        {t('room.emptyCoordinatorHint')}
      </div>
    </div>
  );
}

function RoomFeedSkeleton({ isSlowLoading }: { isSlowLoading: boolean }) {
  const t = useT();
  return (
    <div aria-live="polite" className="space-y-5 px-5 py-8" role="status">
      <span className="sr-only">{t('room.loadingMessagesSr')}</span>
      {isSlowLoading ? (
        <p className="text-center text-xs leading-5 text-muted-foreground">
          {t('room.slowLoadingHint')}
        </p>
      ) : null}
      <div aria-hidden="true" className="space-y-5">
        {[0, 1, 2].map((index) => (
          <div
            className="flex animate-pulse gap-3 motion-reduce:animate-none"
            key={index}
          >
            <div className="size-8 rounded-lg bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-28 rounded bg-muted" />
              <div className="h-3 w-full max-w-lg rounded bg-muted" />
              <div className="h-3 w-2/3 max-w-sm rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const SCROLL_BOTTOM_THRESHOLD = 96;
