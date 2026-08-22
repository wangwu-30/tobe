'use client';

import * as React from 'react';
import { AlertTriangle, Check, LoaderCircle, ShieldAlert, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  approveRoomToolConfirmation,
  listRoomToolConfirmations,
  rejectRoomToolConfirmation,
} from '@/lib/room/client';
import type { RoomEventDtoV1 } from '@/objects/room';
import type { RoomToolConfirmationRequestDtoV1 } from '@/objects/room-tool-confirmation';

export type RoomToolConfirmationsProps = {
  events: readonly RoomEventDtoV1[];
  roomId: string;
};

type PendingDecision = {
  decision: 'approve' | 'reject';
  requestId: string;
};

/**
 * Presents the authoritative pending-confirmation resource. Room events only
 * trigger a refresh; the card never trusts an event payload as decision state.
 */
export function RoomToolConfirmations({
  events,
  roomId,
}: RoomToolConfirmationsProps) {
  const [requests, setRequests] = React.useState<
    RoomToolConfirmationRequestDtoV1[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [pendingDecision, setPendingDecision] =
    React.useState<PendingDecision | null>(null);
  const loadGenerationRef = React.useRef(0);
  const roomIdRef = React.useRef(roomId);

  React.useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  const latestConfirmationEventSequence = React.useMemo(
    () =>
      events.reduce(
        (latest, event) =>
          isConfirmationEvent(event) ? Math.max(latest, event.sequence) : latest,
        0
      ),
    [events]
  );

  const load = React.useCallback(
    async (signal?: AbortSignal) => {
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      const isCurrent = () =>
        !signal?.aborted &&
        loadGenerationRef.current === generation &&
        roomIdRef.current === roomId;
      setIsLoading(true);
      const result = await listRoomToolConfirmations(roomId, 'pending', signal);
      if (!isCurrent()) return;
      if (result.ok) {
        setRequests(
          result.data
            .filter((request) => request.roomId === roomId && request.status === 'pending')
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        );
        setError('');
      } else {
        setError(`${result.error} 请重试。`);
      }
      setIsLoading(false);
    },
    [roomId]
  );

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [latestConfirmationEventSequence, load]);

  async function decide(
    request: RoomToolConfirmationRequestDtoV1,
    decision: PendingDecision['decision']
  ) {
    if (pendingDecision) return;
    const activeRoomId = roomId;
    setPendingDecision({ decision, requestId: request.id });
    setError('');
    const result =
      decision === 'approve'
        ? await approveRoomToolConfirmation(request.id, request.revision)
        : await rejectRoomToolConfirmation(request.id, request.revision);
    if (roomIdRef.current !== activeRoomId) return;
    setPendingDecision(null);
    if (result.ok) {
      setRequests((current) =>
        current.filter((candidate) => candidate.id !== request.id)
      );
      return;
    }
    setError(`${result.error} 已重新加载最新确认状态。`);
    await load();
  }

  if (!isLoading && requests.length === 0 && !error) return null;

  return (
    <section
      aria-busy={isLoading || Boolean(pendingDecision)}
      aria-label="待确认工具操作"
      className="shrink-0 border-b bg-amber-50/60 dark:bg-amber-950/15"
      data-testid="room-tool-confirmations"
    >
      <div className="mx-auto max-h-72 max-w-3xl space-y-2 overflow-y-auto overscroll-contain px-3 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-amber-900 dark:text-amber-200">
            <ShieldAlert className="size-4" />
            待确认操作
          </h2>
          {isLoading ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
              正在同步…
            </span>
          ) : null}
        </div>

        {error ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-background px-3 py-2 text-xs text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button
              className="min-h-8 shrink-0 rounded px-2 font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void load()}
              type="button"
            >
              重试
            </button>
          </div>
        ) : null}

        {requests.map((request) => {
          const approving =
            pendingDecision?.requestId === request.id &&
            pendingDecision.decision === 'approve';
          const rejecting =
            pendingDecision?.requestId === request.id &&
            pendingDecision.decision === 'reject';
          const titleId = `room-confirmation-${request.id}-title`;
          return (
            <article
              aria-labelledby={titleId}
              className="rounded-xl border border-amber-200 bg-background p-3 shadow-xs dark:border-amber-900"
              data-testid={`room-tool-confirmation-${request.id}`}
              key={request.id}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-semibold" id={titleId}>
                    Agent 请求执行 {request.toolName}
                  </h3>
                  <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                    {parameterSummary(request.parameters)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {safetyLabel(request.safetyLevel)}
                </span>
              </div>
              <details className="mt-2 text-xs text-muted-foreground">
                <summary className="min-h-8 cursor-pointer rounded py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  查看精确参数与权限范围
                </summary>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-2 text-[11px] leading-5">
                  {formatParameters(request.parameters)}
                </pre>
                <p className="mt-1">写入范围：{writePolicyLabel(request.writePolicy)}</p>
              </details>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <Button
                  aria-busy={rejecting}
                  data-testid={`room-tool-confirmation-reject-${request.id}`}
                  disabled={Boolean(pendingDecision)}
                  onClick={() => void decide(request, 'reject')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {rejecting ? (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <X />
                  )}
                  {rejecting ? '正在拒绝…' : '拒绝'}
                </Button>
                <Button
                  aria-busy={approving}
                  data-testid={`room-tool-confirmation-approve-${request.id}`}
                  disabled={Boolean(pendingDecision)}
                  onClick={() => void decide(request, 'approve')}
                  size="sm"
                  type="button"
                >
                  {approving ? (
                    <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                  ) : (
                    <Check />
                  )}
                  {approving ? '正在批准…' : '批准并执行'}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function isConfirmationEvent(event: RoomEventDtoV1) {
  return event.type.includes('tool_confirmation');
}

function parameterSummary(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const goal = (value as Record<string, unknown>).goal;
    if (typeof goal === 'string' && goal.trim()) return goal;
  }
  const formatted = formatParameters(value).replace(/\s+/g, ' ').trim();
  return formatted.length > 180 ? `${formatted.slice(0, 177)}…` : formatted;
}

function formatParameters(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return '参数无法显示';
  }
}

function safetyLabel(value: RoomToolConfirmationRequestDtoV1['safetyLevel']) {
  if (value === 'privileged') return '高权限';
  if (value === 'confirm') return '需要确认';
  return '安全操作';
}

function writePolicyLabel(value: RoomToolConfirmationRequestDtoV1['writePolicy']) {
  if (value === 'read-only') return '只读';
  if (value === 'organization-scoped-append') return '组织内追加';
  if (value === 'workspace-write') return '工作区写入';
  return '特权写入';
}
