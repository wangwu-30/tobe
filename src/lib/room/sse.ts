export const ROOM_SSE_POLL_INTERVAL_MS = 750;
export const ROOM_SSE_HEARTBEAT_INTERVAL_MS = 15_000;

type SequencedRoomEvent = {
  sequence: number;
  type: string;
};

type RoomEventStreamOptions<TEvent extends SequencedRoomEvent> = {
  after: number;
  initialEvents?: readonly TEvent[];
  loadEvents: (
    after: number,
    signal: AbortSignal
  ) => Promise<readonly TEvent[]>;
  pageSize?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
};

type RoomSseCapacityGate = {
  notify: () => void;
  wait: (
    controller: ReadableStreamDefaultController<Uint8Array>,
    signal: AbortSignal
  ) => Promise<void>;
};

/** Serializes one durable RoomEvent as a replayable SSE message. */
export function serializeRoomSseEvent<TEvent extends SequencedRoomEvent>(
  event: TEvent
) {
  assertSequence(event.sequence);
  const eventType = sanitizeRoomSseEventType(event.type);
  return `id: ${event.sequence}\nevent: ${eventType}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function serializeRoomSseHeartbeat(now = new Date()) {
  return `: heartbeat ${now.toISOString()}\n\n`;
}

/**
 * Streams the already-read replay page, then polls for durable events. The
 * initial read happens in the route so authorization/not-found errors can
 * still be returned as normal JSON before the response starts.
 */
export function createRoomEventSseResponse<
  TEvent extends SequencedRoomEvent,
>(options: RoomEventStreamOptions<TEvent>) {
  const encoder = new TextEncoder();
  const streamAbort = new AbortController();
  const capacityGate = createCapacityGate();
  const forwardAbort = () => streamAbort.abort(options.signal?.reason);

  if (options.signal?.aborted) {
    forwardAbort();
  } else {
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (streamAbort.signal.aborted) {
        closeController(controller);
        options.signal?.removeEventListener('abort', forwardAbort);
        return;
      }
      controller.enqueue(encoder.encode(': connected\nretry: 1000\n\n'));
      void pumpRoomEvents(
        controller,
        encoder,
        streamAbort.signal,
        capacityGate,
        options
      )
        .then(() => closeController(controller))
        .catch((error: unknown) => {
          if (streamAbort.signal.aborted) {
            closeController(controller);
            return;
          }
          controller.error(error);
        })
        .finally(() => {
          options.signal?.removeEventListener('abort', forwardAbort);
        });
    },
    pull() {
      capacityGate.notify();
    },
    cancel(reason) {
      streamAbort.abort(reason);
      capacityGate.notify();
      options.signal?.removeEventListener('abort', forwardAbort);
    },
  });

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      Vary: 'Accept',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function pumpRoomEvents<TEvent extends SequencedRoomEvent>(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  signal: AbortSignal,
  capacityGate: RoomSseCapacityGate,
  options: RoomEventStreamOptions<TEvent>
) {
  const pollIntervalMs = readPositiveDuration(
    options.pollIntervalMs,
    ROOM_SSE_POLL_INTERVAL_MS
  );
  const heartbeatIntervalMs = readPositiveDuration(
    options.heartbeatIntervalMs,
    ROOM_SSE_HEARTBEAT_INTERVAL_MS
  );
  const pageSize = options.pageSize ?? Number.POSITIVE_INFINITY;
  let cursor = options.after;
  let lastWriteAt = Date.now();
  let events = options.initialEvents ?? [];

  assertSequence(cursor);

  while (!signal.aborted) {
    const previousCursor = cursor;
    cursor = await enqueueEvents(
      controller,
      encoder,
      events,
      cursor,
      signal,
      capacityGate
    );
    if (cursor > previousCursor) {
      lastWriteAt = Date.now();
    }

    const drainedFullPage =
      events.length >= pageSize && cursor > previousCursor;
    if (!drainedFullPage) {
      await waitForPoll(pollIntervalMs, signal);
    }
    if (signal.aborted) return;

    if (Date.now() - lastWriteAt >= heartbeatIntervalMs) {
      await capacityGate.wait(controller, signal);
      if (signal.aborted) return;
      controller.enqueue(encoder.encode(serializeRoomSseHeartbeat()));
      lastWriteAt = Date.now();
    }

    const loaded = await waitForAbortable(
      options.loadEvents(cursor, signal),
      signal
    );
    if (loaded === ABORTED) return;
    events = loaded;
  }
}

async function enqueueEvents<TEvent extends SequencedRoomEvent>(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  events: readonly TEvent[],
  after: number,
  signal: AbortSignal,
  capacityGate: RoomSseCapacityGate
) {
  let cursor = after;
  const ordered = [...events].sort((left, right) =>
    left.sequence - right.sequence
  );

  for (const event of ordered) {
    assertSequence(event.sequence);
    if (event.sequence <= cursor) continue;
    await capacityGate.wait(controller, signal);
    if (signal.aborted) return cursor;
    controller.enqueue(encoder.encode(serializeRoomSseEvent(event)));
    cursor = event.sequence;
  }

  return cursor;
}

function createCapacityGate(): RoomSseCapacityGate {
  let notifyWaiter: (() => void) | null = null;

  return {
    notify() {
      notifyWaiter?.();
    },
    async wait(controller, signal) {
      while (!signal.aborted && (controller.desiredSize ?? 0) <= 0) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            if (notifyWaiter === finish) notifyWaiter = null;
            signal.removeEventListener('abort', finish);
            resolve();
          };
          notifyWaiter = finish;
          signal.addEventListener('abort', finish, { once: true });
          if ((controller.desiredSize ?? 0) > 0) finish();
        });
      }
    },
  };
}

function assertSequence(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Room SSE event sequence must be a non-negative integer.');
  }
}

function sanitizeRoomSseEventType(value: string) {
  const sanitized = value.replace(/[\r\n]/g, '').trim();
  return sanitized || 'room.event';
}

function readPositiveDuration(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError('Room SSE duration must be a positive number.');
  }
  return value;
}

function waitForPoll(durationMs: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, durationMs);
    signal.addEventListener('abort', finish, { once: true });

    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

const ABORTED = Symbol('room-sse-aborted');

function waitForAbortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) {
    void promise.catch(() => undefined);
    return Promise.resolve<T | typeof ABORTED>(ABORTED);
  }

  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      resolve(ABORTED);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function closeController(
  controller: ReadableStreamDefaultController<Uint8Array>
) {
  try {
    controller.close();
  } catch {
    // Cancellation can close the controller before the polling loop observes it.
  }
}
