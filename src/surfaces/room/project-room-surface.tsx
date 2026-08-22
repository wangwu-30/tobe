'use client';

import * as React from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleOff,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Users,
  Wifi,
} from 'lucide-react';

import { renderExecutionRoomEvent } from '@/components/execution/execution-room-event';
import { RoomComposer } from '@/components/room/room-composer';
import { RoomFeed } from '@/components/room/room-feed';
import { RoomGrants } from '@/components/room/room-grants';
import { RoomPresence } from '@/components/room/room-presence';
import { RoomToolConfirmations } from '@/components/room/room-tool-confirmations';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { RoomMessageDtoV1 } from '@/objects/room';

import {
  useProjectRoom,
  type RoomConnectionState,
} from './use-project-room';

export type ProjectRoomSurfaceProps = {
  className?: string;
  projectId?: string | null;
  showPresence?: boolean;
};

/**
 * Complete Project Room product surface. It owns Room bootstrap, durable feed
 * synchronization and optimistic send state, while accepting only a project
 * identity from its host page.
 */
export function ProjectRoomSurface({
  className,
  projectId = null,
  showPresence = true,
}: ProjectRoomSurfaceProps) {
  const state = useProjectRoom(projectId);
  const [replyTo, setReplyTo] = React.useState<RoomMessageDtoV1 | null>(null);
  const [isSlowLoading, setIsSlowLoading] = React.useState(false);
  const coordinator =
    state.agents.find((agent) => agent.id === state.room?.hostAgentId) || null;

  React.useEffect(() => {
    if (
      replyTo &&
      !state.messages.some((message) => message.messageId === replyTo.messageId)
    ) {
      setReplyTo(null);
    }
  }, [replyTo, state.messages]);

  React.useEffect(() => {
    setReplyTo(null);
  }, [projectId]);

  React.useEffect(() => {
    if (!state.isLoading) {
      setIsSlowLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(() => setIsSlowLoading(true), 8_000);
    return () => window.clearTimeout(timeoutId);
  }, [state.isLoading]);

  return (
    <section
      aria-label="Project Room"
      className={cn(
        'flex h-full min-h-0 min-w-0 overflow-hidden bg-background',
        className
      )}
      data-testid="project-room-surface"
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b px-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card shadow-xs"
            >
              <Users className="size-4 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-sm font-semibold text-balance">
                  {state.room?.name || 'Project Room'}
                </h1>
                {coordinator ? (
                  <span className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 sm:inline-flex">
                    <Sparkles className="size-2.5" />
                    {coordinator.name} 协调
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                {state.room ? (
                  <>
                    <ConnectionLabel
                      error={state.connectionError}
                      state={state.connectionState}
                    />
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <span className="truncate tabular-nums">
                  {state.agents.length} 个可用 Agent
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {state.room ? (
              <RoomGrants
                agents={state.agents}
                events={state.events}
                hostAgentId={state.room.hostAgentId}
                key={state.room.id}
                roomId={state.room.id}
              />
            ) : null}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  aria-label="查看 Agent 活动"
                  className={cn('size-11 sm:size-8', showPresence && 'xl:hidden')}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Users />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[min(20rem,calc(100vw-1rem))] p-2 motion-reduce:data-[state=closed]:animate-none motion-reduce:data-[state=open]:animate-none"
              >
                <MobileAgentActivity
                  activity={state.agentActivity}
                />
              </PopoverContent>
            </Popover>
            <Button
              aria-label="刷新 Room"
              aria-busy={state.isLoading || state.isRefreshing}
              className="size-11 sm:size-8"
              disabled={state.isLoading || state.isRefreshing}
              onClick={state.refresh}
              size="icon-sm"
              title="刷新"
              type="button"
              variant="ghost"
            >
              <RefreshCw
                className={cn(
                  (state.isLoading || state.isRefreshing) &&
                    'animate-spin motion-reduce:animate-none'
                )}
              />
            </Button>
          </div>
        </header>

        {state.loadError ? (
          <div
            className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive sm:mx-5"
            role="alert"
          >
            <AlertCircle className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">
              {state.loadError} 请重试；若问题持续，请检查连接。
            </span>
            <button
              className="min-h-10 shrink-0 rounded-md px-2 font-medium underline underline-offset-2 hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive sm:min-h-8"
              onClick={state.refresh}
              type="button"
            >
              重试
            </button>
          </div>
        ) : null}

        {state.room ? (
          <RoomToolConfirmations
            events={state.events}
            key={state.room.id}
            roomId={state.room.id}
          />
        ) : null}

        <RoomFeed
          agents={state.agents}
          events={state.events}
          historyReady={state.historyReady}
          hostAgentId={state.room?.hostAgentId || null}
          isLoading={state.isLoading}
          isSlowLoading={isSlowLoading}
          messages={state.messages}
          onDismissPending={state.dismissPendingMessage}
          onReply={setReplyTo}
          onRetryPending={state.retryMessage}
          pendingMessages={state.pendingMessages}
          renderEvent={renderExecutionRoomEvent}
        />

        <RoomComposer
          key={projectId || 'default-room'}
          agents={state.agents}
          disabled={!state.room || state.isLoading}
          hostAgentId={state.room?.hostAgentId || null}
          onCancelReply={() => setReplyTo(null)}
          onSubmit={state.sendMessage}
          replyTo={replyTo}
        />
      </div>

      {showPresence ? <RoomPresence activity={state.agentActivity} /> : null}
    </section>
  );
}

function ConnectionLabel({
  error,
  state,
}: {
  error: string | null;
  state: RoomConnectionState;
}) {
  if (state === 'live') {
    return (
      <span
        aria-live="polite"
        className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"
        role="status"
      >
        <Wifi className="size-3" /> 实时同步
      </span>
    );
  }
  if (state === 'polling') {
    return (
      <span
        aria-live="polite"
        className="inline-flex min-w-0 items-center gap-1 text-amber-700 dark:text-amber-400"
        role="status"
      >
        <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" />
        <span className="truncate">正在轮询同步</span>
        {error ? <span className="sr-only">原因：{error}</span> : null}
      </span>
    );
  }
  if (state === 'offline') {
    return (
      <span
        aria-live="polite"
        className="inline-flex min-w-0 items-center gap-1 text-destructive"
        role="status"
      >
        <CircleOff className="size-3" />
        <span className="truncate">连接不可用，等待重连</span>
        {error ? <span className="sr-only">原因：{error}</span> : null}
      </span>
    );
  }
  return (
    <span aria-live="polite" className="inline-flex items-center gap-1" role="status">
      <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
      正在连接…
    </span>
  );
}

function MobileAgentActivity({
  activity,
}: {
  activity: ReturnType<typeof useProjectRoom>['agentActivity'];
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-semibold">Agent 活动</span>
        <span className="text-xs text-muted-foreground">基于公开事件推断</span>
      </div>
      {activity.length > 0 ? (
        <div className="mt-1 max-h-72 overflow-y-auto overscroll-contain">
          {activity.map((item) => (
            <div
              className="flex items-center gap-2 rounded-md px-2 py-2"
              key={item.agent.id}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground',
                  item.isCoordinator &&
                    'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                )}
              >
                {item.isCoordinator ? (
                  <Sparkles className="size-3.5" />
                ) : (
                  <Bot className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {item.agent.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {item.state === 'responding'
                    ? '已收到回应请求'
                    : item.state === 'observing'
                      ? '正在观察讨论'
                      : item.state === 'recent'
                        ? '最近发言'
                        : item.isCoordinator
                          ? '等待协调'
                          : '尚未参与'}
                </span>
              </span>
              {item.state === 'responding' || item.state === 'recent' ? (
                item.state === 'responding' ? (
                  <LoaderCircle className="size-3.5 animate-spin text-amber-600 motion-reduce:animate-none" />
                ) : (
                  <CheckCircle2 className="size-3.5 text-emerald-600" />
                )
              ) : item.state === 'observing' ? (
                <span className="size-2 rounded-full bg-sky-500" />
              ) : (
                <MoreHorizontal className="size-3.5 text-muted-foreground/50" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          暂无可用 Agent 活动
        </p>
      )}
    </div>
  );
}
