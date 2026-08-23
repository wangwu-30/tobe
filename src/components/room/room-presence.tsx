'use client';

import * as React from 'react';
import { Bot, Circle, Info, Radio, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { RoomAgentActivity } from '@/lib/room/activity';

export type RoomPresenceProps = {
  activity: readonly RoomAgentActivity[];
};

export function RoomPresence({ activity }: RoomPresenceProps) {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <aside
      aria-label="Room Agent 活动"
      className="hidden w-64 shrink-0 overflow-y-auto border-l bg-muted/10 xl:block"
      data-testid="room-presence"
    >
      <div className="p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Agents
          </h2>
          <span className="text-xs tabular-nums text-muted-foreground">
            {activity.length}
          </span>
        </div>

        {activity.length > 0 ? (
          <div className="mt-3 space-y-1">
            {activity.map((item) => (
              <div
                className="rounded-lg px-2 py-2.5"
                data-agent-id={item.agent.id}
                key={item.agent.id}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground',
                      item.isCoordinator &&
                        'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                    )}
                  >
                    {item.isCoordinator ? (
                      <Sparkles className="size-3.5" />
                    ) : (
                      <Bot className="size-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-medium">
                        {item.agent.name}
                      </span>
                      {item.isCoordinator ? (
                        <span className="shrink-0 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          协调者
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {item.agent.handle}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 pl-9 text-xs text-muted-foreground">
                  <ActivityDot state={item.state} />
                  <span>{activityLabel(item, now)}</span>
                </div>
                {item.roomSessionId ? (
                  <div className="mt-1 break-all pl-9 font-mono text-[11px] text-muted-foreground">
                    <span className="sr-only">Room session </span>
                    <span aria-hidden="true">session </span>
                    {item.roomSessionId}
                    {item.deliverySequence !== null
                      ? ` · delivery ${item.deliverySequence}`
                      : ''}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
            暂无可用 Agent 活动
          </p>
        )}

        <div className="mt-4 flex gap-2 rounded-lg border bg-background/70 p-2.5 text-xs leading-5 text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>活动状态根据公开消息与投递事件推断，不代表实时在线或运行租约。</span>
        </div>
      </div>
    </aside>
  );
}

function ActivityDot({ state }: Pick<RoomAgentActivity, 'state'>) {
  if (state === 'responding') {
    return <Radio className="size-3 text-emerald-600" />;
  }
  if (state === 'observing') {
    return <Circle className="size-2 fill-sky-500 text-sky-500" />;
  }
  if (state === 'recent') {
    return <Circle className="size-2 fill-violet-500 text-violet-500" />;
  }
  return <Circle className="size-2 fill-muted-foreground/30 text-muted-foreground/30" />;
}

function activityLabel(activity: RoomAgentActivity, now: number) {
  if (activity.state === 'responding') return '已收到回应请求';
  if (activity.state === 'observing') return '正在观察讨论';
  if (activity.state === 'recent') {
    return `最近发言${relativeTime(activity.lastActivityAt, now)}`;
  }
  return activity.isCoordinator ? '等待协调' : '尚未参与';
}

function relativeTime(value: string | null, now: number) {
  if (!value) return '';
  const delta = now - Date.parse(value);
  if (!Number.isFinite(delta) || delta < 60_000) return ' · 刚刚';
  if (delta < 3_600_000) return ` · ${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return ` · ${Math.floor(delta / 3_600_000)} 小时前`;
  return '';
}
