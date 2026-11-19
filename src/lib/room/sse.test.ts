import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoomEventSseResponse } from './sse';

function event(sequence: number) {
  return { sequence, type: 'message.accepted' };
}

test('stops producing at backpressure and resumes on consumer pulls', async () => {
  const decoder = new TextDecoder();
  let loadCalls = 0;
  const response = createRoomEventSseResponse({
    after: 0,
    initialEvents: [event(1), event(2), event(3)],
    loadEvents: async () => {
      loadCalls += 1;
      return [];
    },
    pollIntervalMs: 60_000,
  });
  const reader = response.body!.getReader();

  assert.match(decoder.decode((await reader.read()).value), /: connected/);
  await Promise.resolve();
  assert.equal(loadCalls, 0);
  assert.match(decoder.decode((await reader.read()).value), /id: 1/);
  await Promise.resolve();
  assert.equal(loadCalls, 0);
  await reader.cancel('backpressure checked');
});

test('cancels promptly while a loader is in flight and forwards its signal', async () => {
  let loaderSignal: AbortSignal | undefined;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const response = createRoomEventSseResponse({
    after: 0,
    heartbeatIntervalMs: 60_000,
    loadEvents: async (_after, signal) => {
      loaderSignal = signal;
      markStarted();
      return new Promise<never>(() => undefined);
    },
    pollIntervalMs: 1,
  });
  const reader = response.body!.getReader();

  await reader.read();
  await started;
  await reader.cancel('consumer left');
  assert.equal(loaderSignal?.aborted, true);
});

test('does not enqueue or poll for an already-aborted request', async () => {
  const controller = new AbortController();
  controller.abort('request ended');
  let loadCalls = 0;
  const response = createRoomEventSseResponse({
    after: 0,
    loadEvents: async () => {
      loadCalls += 1;
      return [];
    },
    signal: controller.signal,
  });

  assert.equal((await response.arrayBuffer()).byteLength, 0);
  assert.equal(loadCalls, 0);
});
