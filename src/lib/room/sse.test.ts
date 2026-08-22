import { expect, test } from '@playwright/test';

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

  expect(decoder.decode((await reader.read()).value)).toContain(': connected');
  await Promise.resolve();
  expect(loadCalls).toBe(0);
  expect(decoder.decode((await reader.read()).value)).toContain('id: 1');
  await Promise.resolve();
  expect(loadCalls).toBe(0);
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
  expect(loaderSignal?.aborted).toBe(true);
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

  expect((await response.arrayBuffer()).byteLength).toBe(0);
  expect(loadCalls).toBe(0);
});
