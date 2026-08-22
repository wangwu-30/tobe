'use client';

import * as React from 'react';
import type { RoomAgentMentionV1 } from '@/agent/room-runtime/contracts';
import type {
  RoomDtoV1,
  RoomEventDtoV1,
  RoomMessageDtoV1,
  RoomMessageReceiptV1,
} from '@/objects/room';

import { deriveRoomAgentActivity } from '@/lib/room/activity';
import {
  consumeRoomEventStream,
  getRoomEventMessage,
  getProjectRoom,
  listRoomAgents,
  listRoomEvents,
  listRoomMessages,
  sendRoomMessage,
  type RoomAgent,
  type SendRoomMessageInput,
} from '@/lib/room/client';

export type RoomConnectionState =
  | 'connecting'
  | 'live'
  | 'offline'
  | 'polling';

export type PendingRoomMessage = {
  attempts: number;
  correlationId: string;
  createdAt: string;
  error: string | null;
  mentions: readonly RoomAgentMentionV1[];
  receipt: RoomMessageReceiptV1 | null;
  replyToMessageId: string | null;
  retryable: boolean;
  status: 'accepted' | 'error' | 'pending';
  text: string;
};

export type SendProjectRoomMessageInput = {
  mentions: readonly RoomAgentMentionV1[];
  replyToMessageId?: string | null;
  text: string;
};

export function useProjectRoom(projectId?: string | null) {
  const [room, setRoom] = React.useState<RoomDtoV1 | null>(null);
  const [agents, setAgents] = React.useState<RoomAgent[]>([]);
  const [messages, setMessages] = React.useState<RoomMessageDtoV1[]>([]);
  const [events, setEvents] = React.useState<RoomEventDtoV1[]>([]);
  const [pendingMessages, setPendingMessages] = React.useState<
    PendingRoomMessage[]
  >([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [historyReady, setHistoryReady] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [connectionError, setConnectionError] = React.useState<string | null>(null);
  const [connectionState, setConnectionState] =
    React.useState<RoomConnectionState>('connecting');

  const eventCursorRef = React.useRef(0);
  const loadControllerRef = React.useRef<AbortController | null>(null);
  const loadGenerationRef = React.useRef(0);
  const messageCursorRef = React.useRef(0);
  const pendingAttemptRef = React.useRef(new Map<string, number>());
  const pendingInFlightRef = React.useRef(new Set<string>());
  const roomGenerationRef = React.useRef(0);
  const roomRef = React.useRef<RoomDtoV1 | null>(null);

  const mergeMessages = React.useCallback(
    (incoming: readonly RoomMessageDtoV1[]) => {
      const activeRoomId = roomRef.current?.id;
      const activeMessages = activeRoomId
        ? incoming.filter((message) => message.roomId === activeRoomId)
        : [];
      if (activeMessages.length === 0) return;
      messageCursorRef.current = Math.max(
        messageCursorRef.current,
        ...activeMessages.map((message) => message.sequence)
      );
      setMessages((current) =>
        mergeBySequence(
          current.filter((message) => message.roomId === activeRoomId),
          activeMessages
        )
      );
      const correlations = new Set(
        activeMessages
          .map((message) => message.correlationId)
          .filter((id): id is string => Boolean(id))
      );
      if (correlations.size > 0) {
        correlations.forEach((correlationId) => {
          pendingAttemptRef.current.delete(correlationId);
          pendingInFlightRef.current.delete(correlationId);
        });
        setPendingMessages((current) =>
          current.filter((message) => !correlations.has(message.correlationId))
        );
      }
    },
    []
  );

  const mergeEvents = React.useCallback(
    (incoming: readonly RoomEventDtoV1[]) => {
      const activeRoomId = roomRef.current?.id;
      const activeEvents = activeRoomId
        ? incoming.filter((event) => event.roomId === activeRoomId)
        : [];
      if (activeEvents.length === 0) return;
      eventCursorRef.current = Math.max(
        eventCursorRef.current,
        ...activeEvents.map((event) => event.sequence)
      );
      setEvents((current) =>
        mergeBySequence(
          current.filter((event) => event.roomId === activeRoomId),
          activeEvents
        ).slice(-500)
      );
      mergeMessages(
        activeEvents
          .map(getRoomEventMessage)
          .filter((message): message is RoomMessageDtoV1 => message !== null)
      );
    },
    [mergeMessages]
  );

  const loadRoom = React.useCallback(
    async (signal: AbortSignal, generation: number, refresh = false) => {
      const isCurrentLoad = () =>
        !signal.aborted && loadGenerationRef.current === generation;
      let loadingHistory = false;

      setIsLoading(!refresh);
      setIsRefreshing(refresh);

      try {
        const [roomResult, agentResult] = await Promise.all([
          getProjectRoom(projectId, signal),
          listRoomAgents(signal),
        ]);
        if (!isCurrentLoad()) return;
        if (!roomResult.ok) {
          setLoadError(roomResult.error);
          if (!roomRef.current) {
            setConnectionState('offline');
            setConnectionError(roomResult.error);
            setHistoryReady(false);
          }
          return;
        }

        const nextRoom = roomResult.data;
        const roomChanged = roomRef.current?.id !== nextRoom.id;
        if (roomChanged) {
          roomGenerationRef.current += 1;
          pendingAttemptRef.current.clear();
          pendingInFlightRef.current.clear();
          eventCursorRef.current = 0;
          messageCursorRef.current = 0;
          setEvents([]);
          setMessages([]);
          setPendingMessages([]);
          setHistoryReady(false);
          setConnectionState('connecting');
          setConnectionError(null);
        }
        roomRef.current = nextRoom;
        setRoom(nextRoom);

        const loadErrors: string[] = [];
        if (agentResult.ok) {
          setAgents(agentResult.data.filter((agent) => agent.enabled));
        } else {
          loadErrors.push(agentResult.error);
        }

        loadingHistory = true;
        const [messageResult, eventResult] = await Promise.all([
          collectRoomMessages(nextRoom, signal),
          collectRoomEvents(nextRoom, signal),
        ]);
        if (!isCurrentLoad()) return;

        const nextMessages = sortBySequence(messageResult.data);
        messageCursorRef.current = Math.max(
          messageCursorRef.current,
          nextMessages.at(-1)?.sequence || 0
        );
        setMessages((current) =>
          mergeBySequence(
            nextMessages,
            current.filter((message) => message.roomId === nextRoom.id)
          )
        );
        if (!messageResult.ok) loadErrors.push(messageResult.error);

        const nextEvents = sortBySequence(eventResult.data);
        eventCursorRef.current = Math.max(
          eventCursorRef.current,
          nextEvents.at(-1)?.sequence || 0
        );
        setEvents((current) =>
          mergeBySequence(
            nextEvents,
            current.filter((event) => event.roomId === nextRoom.id)
          ).slice(-500)
        );
        if (!eventResult.ok) loadErrors.push(eventResult.error);

        setHistoryReady(messageResult.ok && eventResult.ok);
        setLoadError(loadErrors.length > 0 ? loadErrors.join(' ') : null);
      } catch (error) {
        if (!isCurrentLoad()) return;
        const message = toErrorMessage(error, 'Room data could not be loaded.');
        setLoadError(message);
        if (loadingHistory) setHistoryReady(false);
        if (!roomRef.current) {
          setConnectionState('offline');
          setConnectionError(message);
        }
      } finally {
        if (isCurrentLoad()) {
          setIsLoading(false);
          setIsRefreshing(false);
          if (loadControllerRef.current?.signal === signal) {
            loadControllerRef.current = null;
          }
        }
      }
    },
    [projectId]
  );

  const startLoad = React.useCallback(
    (refresh = false) => {
      loadControllerRef.current?.abort();
      const controller = new AbortController();
      const generation = loadGenerationRef.current + 1;
      loadGenerationRef.current = generation;
      loadControllerRef.current = controller;
      void loadRoom(controller.signal, generation, refresh);
    },
    [loadRoom]
  );

  React.useEffect(() => {
    roomGenerationRef.current += 1;
    pendingAttemptRef.current.clear();
    pendingInFlightRef.current.clear();
    roomRef.current = null;
    eventCursorRef.current = 0;
    messageCursorRef.current = 0;
    setRoom(null);
    setAgents([]);
    setMessages([]);
    setEvents([]);
    setPendingMessages([]);
    setHistoryReady(false);
    setIsLoading(true);
    setIsRefreshing(false);
    setLoadError(null);
    setConnectionState('connecting');
    setConnectionError(null);
    startLoad();
    return () => {
      loadGenerationRef.current += 1;
      loadControllerRef.current?.abort();
      loadControllerRef.current = null;
    };
  }, [startLoad]);

  React.useEffect(() => {
    if (!room?.id || isLoading) return;
    const controller = new AbortController();
    const roomGeneration = roomGenerationRef.current;
    const isCurrentRoom = () =>
      !controller.signal.aborted &&
      roomGenerationRef.current === roomGeneration &&
      roomRef.current?.id === room.id;
    let reconnectAttempt = 0;

    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          await consumeRoomEventStream(
            room.id,
            eventCursorRef.current,
            controller.signal,
            {
              onConnectionChange: (nextState) => {
                if (!isCurrentRoom()) return;
                setConnectionState(nextState);
                if (nextState === 'live') setConnectionError(null);
              },
              onEvent: (event) => {
                if (isCurrentRoom()) mergeEvents([event]);
              },
            }
          );
          reconnectAttempt = 0;
        } catch (error) {
          if (!isCurrentRoom()) return;
          reconnectAttempt += 1;
          setConnectionError(toErrorMessage(error));
        }
        if (!isCurrentRoom()) return;

        setConnectionState('polling');
        try {
          const pollResult = await listRoomEvents(
            room.id,
            eventCursorRef.current,
            controller.signal
          );
          if (!isCurrentRoom()) return;
          if (pollResult.ok) {
            mergeEvents(pollResult.data);
            setConnectionError(null);
          } else {
            setConnectionState('offline');
            setConnectionError(pollResult.error);
          }
        } catch (error) {
          if (!isCurrentRoom()) return;
          reconnectAttempt += 1;
          setConnectionState('offline');
          setConnectionError(toErrorMessage(error));
        }

        await waitForReconnect(
          Math.min(15_000, 1_000 * 2 ** Math.min(reconnectAttempt, 4)),
          controller.signal
        );
      }
    };

    void run().catch((error) => {
      if (!isCurrentRoom()) return;
      setConnectionState('offline');
      setConnectionError(toErrorMessage(error));
    });
    return () => controller.abort();
  }, [isLoading, mergeEvents, room?.id]);

  const syncAfterSend = React.useCallback(
    async (roomId: string, roomGeneration: number) => {
      try {
        const eventResult = await listRoomEvents(
          roomId,
          eventCursorRef.current
        );
        if (
          roomGenerationRef.current !== roomGeneration ||
          roomRef.current?.id !== roomId
        ) return;
        if (eventResult.ok) {
          mergeEvents(eventResult.data);
        } else {
          setConnectionError(eventResult.error);
        }
      } catch (error) {
        if (
          roomGenerationRef.current === roomGeneration &&
          roomRef.current?.id === roomId
        ) {
          setConnectionError(toErrorMessage(error));
        }
      }
    },
    [mergeEvents]
  );

  const submitPending = React.useCallback(
    async (pending: PendingRoomMessage) => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return false;
      if (pendingInFlightRef.current.has(pending.correlationId)) return false;
      pendingInFlightRef.current.add(pending.correlationId);
      const activeRoomId = activeRoom.id;
      const roomGeneration = roomGenerationRef.current;
      const attempt = (pendingAttemptRef.current.get(pending.correlationId) || 0) + 1;
      pendingAttemptRef.current.set(pending.correlationId, attempt);
      const isCurrentAttempt = () =>
        roomGenerationRef.current === roomGeneration &&
        roomRef.current?.id === activeRoomId &&
        pendingAttemptRef.current.get(pending.correlationId) === attempt;

      setPendingMessages((current) =>
        current.map((message) =>
          message.correlationId === pending.correlationId
            ? {
                ...message,
                attempts: message.attempts + 1,
                status: 'pending',
              }
            : message
        )
      );
      const input: SendRoomMessageInput = {
        correlationId: pending.correlationId,
        mentions: pending.mentions,
        replyToMessageId: pending.replyToMessageId,
        text: pending.text,
      };
      let result: Awaited<ReturnType<typeof sendRoomMessage>>;
      try {
        result = await sendRoomMessage(activeRoomId, input);
      } catch (error) {
        pendingInFlightRef.current.delete(pending.correlationId);
        if (!isCurrentAttempt()) return false;
        setPendingMessages((current) =>
          current.map((message) =>
            message.correlationId === pending.correlationId
              ? {
                  ...message,
                  error: toErrorMessage(error, 'Room message could not be sent.'),
                  retryable: true,
                  status: 'error',
                }
              : message
          )
        );
        return false;
      }
      pendingInFlightRef.current.delete(pending.correlationId);
      if (!isCurrentAttempt()) return false;
      if (!result.ok) {
        setPendingMessages((current) =>
          current.map((message) =>
            message.correlationId === pending.correlationId
              ? {
                  ...message,
                  error: result.error,
                  retryable: result.retryable,
                  status: 'error',
                }
              : message
          )
        );
        return false;
      }

      setPendingMessages((current) =>
        current.map((message) =>
          message.correlationId === pending.correlationId
            ? {
                ...message,
                error: null,
                receipt: result.data,
                retryable: true,
                status: 'accepted',
              }
            : message
        )
      );
      await syncAfterSend(activeRoomId, roomGeneration);
      return isCurrentAttempt();
    },
    [syncAfterSend]
  );

  const sendMessage = React.useCallback(
    async (input: SendProjectRoomMessageInput) => {
      const activeRoom = roomRef.current;
      if (!activeRoom) return false;
      const activeRoomId = activeRoom.id;
      const roomGeneration = roomGenerationRef.current;
      const correlationId = createCorrelationId();
      const pending: PendingRoomMessage = {
        attempts: 0,
        correlationId,
        createdAt: new Date().toISOString(),
        error: null,
        mentions: [...input.mentions],
        receipt: null,
        replyToMessageId: input.replyToMessageId || null,
        retryable: true,
        status: 'pending',
        text: input.text,
      };
      setPendingMessages((current) => upsertPending(current, pending));
      await submitPending(pending);
      // The draft is now owned by the optimistic timeline entry. A failed
      // request remains visible there with a stable-idempotency retry action.
      return (
        roomGenerationRef.current === roomGeneration &&
        roomRef.current?.id === activeRoomId
      );
    },
    [submitPending]
  );

  const retryMessage = React.useCallback(
    (correlationId: string) => {
      const pending = pendingMessages.find(
        (message) => message.correlationId === correlationId
      );
      if (pending) void submitPending(pending);
    },
    [pendingMessages, submitPending]
  );

  const dismissPendingMessage = React.useCallback((correlationId: string) => {
    pendingAttemptRef.current.delete(correlationId);
    pendingInFlightRef.current.delete(correlationId);
    setPendingMessages((current) =>
      current.filter((message) => message.correlationId !== correlationId)
    );
  }, []);

  const refresh = React.useCallback(() => {
    startLoad(true);
  }, [startLoad]);

  const agentActivity = React.useMemo(
    () =>
      deriveRoomAgentActivity({
        agents,
        events,
        hostAgentId: room?.hostAgentId || null,
        messages,
      }),
    [agents, events, messages, room?.hostAgentId]
  );

  return {
    agentActivity,
    agents,
    connectionError,
    connectionState,
    dismissPendingMessage,
    events,
    historyReady,
    isLoading,
    isRefreshing,
    loadError,
    messages,
    pendingMessages,
    refresh,
    retryMessage,
    room,
    sendMessage,
  };
}

async function collectRoomMessages(room: RoomDtoV1, signal: AbortSignal) {
  const collected: RoomMessageDtoV1[] = [];
  let cursor = 0;
  while (!signal.aborted && cursor < room.messageSequence) {
    const result = await listRoomMessages(room.id, cursor, signal);
    if (!result.ok) return { ...result, data: collected };
    if (result.data.length === 0) {
      return incompleteHistory(
        collected,
        'Room message history ended before reaching the latest message.'
      );
    }
    collected.push(...result.data);
    const nextCursor = Math.max(...result.data.map((message) => message.sequence));
    if (nextCursor <= cursor) {
      return incompleteHistory(
        collected,
        'Room message history did not advance to the latest message.'
      );
    }
    cursor = nextCursor;
  }
  if (signal.aborted) {
    return incompleteHistory(collected, 'Room message history loading was interrupted.');
  }
  return { data: collected, ok: true } as const;
}

async function collectRoomEvents(room: RoomDtoV1, signal: AbortSignal) {
  const collected: RoomEventDtoV1[] = [];
  let cursor = 0;
  while (!signal.aborted && cursor < room.eventSequence) {
    const result = await listRoomEvents(room.id, cursor, signal);
    if (!result.ok) return { ...result, data: collected };
    if (result.data.length === 0) {
      return incompleteHistory(
        collected,
        'Room event history ended before reaching the latest event.'
      );
    }
    collected.push(...result.data);
    const nextCursor = Math.max(...result.data.map((event) => event.sequence));
    if (nextCursor <= cursor) {
      return incompleteHistory(
        collected,
        'Room event history did not advance to the latest event.'
      );
    }
    cursor = nextCursor;
  }
  if (signal.aborted) {
    return incompleteHistory(collected, 'Room event history loading was interrupted.');
  }
  return { data: collected, ok: true } as const;
}

function incompleteHistory<T>(data: T[], error: string) {
  return { data, error, ok: false, retryable: true } as const;
}

function mergeBySequence<T extends { sequence: number }>(
  current: readonly T[],
  incoming: readonly T[]
) {
  return sortBySequence(
    [...new Map([...current, ...incoming].map((item) => [item.sequence, item])).values()]
  );
}

function sortBySequence<T extends { sequence: number }>(items: readonly T[]) {
  return [...items].sort((left, right) => left.sequence - right.sequence);
}

function upsertPending(
  current: readonly PendingRoomMessage[],
  incoming: PendingRoomMessage
) {
  const existingIndex = current.findIndex(
    (message) => message.correlationId === incoming.correlationId
  );
  if (existingIndex < 0) return [...current, incoming];
  return current.map((message, index) =>
    index === existingIndex ? incoming : message
  );
}

function createCorrelationId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `room-web:${crypto.randomUUID()}`;
  }
  return `room-web:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function toErrorMessage(
  error: unknown,
  fallback = 'Room connection was interrupted.'
) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function waitForReconnect(duration: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, duration);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      window.clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}
