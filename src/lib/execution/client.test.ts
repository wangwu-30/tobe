import { expect, test } from '@playwright/test';
import { safeJsonParse } from '@/framework/resilience/safe-data';

import {
  createExecutionJob,
  listExecutionJobs,
  listExecutionLogs,
  normalizeExecutionLaunch,
  normalizeJobEnvelope,
  type CreateExecutionJobInput,
} from './client';

test('sends an encoded execution job search with pagination and abort signal', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedSignal: AbortSignal | null | undefined;

  globalThis.fetch = (async (input, init) => {
    requestedUrl = String(input);
    requestedSignal = init?.signal;
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        items: [],
        pageInfo: { hasNextPage: false, nextCursor: null },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const controller = new AbortController();
    await expect(
      listExecutionJobs({
        cursor: 'cursor/next',
        limit: 25,
        search: 'C++ & runtime/一',
        signal: controller.signal,
        status: 'running',
      })
    ).resolves.toEqual({
      data: {
        items: [],
        pageInfo: { hasNextPage: false, nextCursor: null },
      },
      ok: true,
    });
    const requested = new URL(requestedUrl, 'http://local.test');
    expect(requestedUrl).toContain(
      'q=C%2B%2B+%26+runtime%2F%E4%B8%80'
    );
    expect(requested.pathname).toBe('/api/execution-jobs');
    expect(requested.searchParams.get('cursor')).toBe('cursor/next');
    expect(requested.searchParams.get('limit')).toBe('25');
    expect(requested.searchParams.get('q')).toBe('C++ & runtime/一');
    expect(requested.searchParams.get('status')).toBe('running');
    expect(Boolean(requestedSignal)).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetches and defensively normalizes paged execution logs', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        items: [
          {
            id: 'log-text',
            jobId: 'job / logs',
            attemptId: 'attempt-1',
            sequence: 8,
            type: 'text-delta',
            source: 'runtime',
            runtimeEventId: 'runtime-event-8',
            text: ' line one\nline two ',
            percent: null,
            payloadValid: true,
            occurredAt: '2026-08-21T12:00:00.000Z',
          },
          {
            id: 'log-progress',
            jobId: 'job / logs',
            attemptId: 'attempt-1',
            sequence: 9,
            type: 'progress',
            source: 'runtime',
            runtimeEventId: 'runtime-event-9',
            text: 'Almost done',
            percent: 80,
            payloadValid: true,
            occurredAt: '2026-08-21T12:00:01.000Z',
          },
          {
            id: 'log-invalid-payload',
            jobId: 'job / logs',
            sequence: 10,
            type: 'progress',
            source: 'runtime',
            text: 'must be withheld',
            percent: 200,
            payloadValid: true,
          },
          { id: 'not-a-log', sequence: 11, type: 'checkpoint' },
        ],
        pageInfo: { hasNextPage: true, nextCursor: '10' },
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const result = await listExecutionLogs('job / logs', '7');

    expect(requestedUrl).toBe(
      '/api/execution-jobs/job%20%2F%20logs/logs?afterSequence=7'
    );
    expect(result).toEqual({
      data: {
        items: [
          expect.objectContaining({
            id: 'log-text',
            text: ' line one\nline two ',
            payloadValid: true,
          }),
          expect.objectContaining({
            id: 'log-progress',
            text: 'Almost done',
            percent: 80,
            payloadValid: true,
          }),
          expect.objectContaining({
            id: 'log-invalid-payload',
            text: null,
            percent: null,
            payloadValid: false,
          }),
        ],
        pageInfo: { hasNextPage: true, nextCursor: '10' },
      },
      ok: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizes execution origin room fields only as a complete nullable pair', () => {
  expect(normalizeJobEnvelope({
    job: {
      id: 'job-with-origin',
      originRoomId: 'room-1',
      originRoomMessageId: 'message-1',
      status: 'queued',
    },
  })).toMatchObject({
    originRoomId: 'room-1',
    originRoomMessageId: 'message-1',
  });
  expect(normalizeJobEnvelope({
    job: {
      id: 'job-without-origin',
      originRoomId: null,
      originRoomMessageId: null,
      status: 'queued',
    },
  })).toMatchObject({
    originRoomId: null,
    originRoomMessageId: null,
  });
  expect(normalizeJobEnvelope({
    job: {
      id: 'job-with-partial-origin',
      originRoomId: 'room-1',
      originRoomMessageId: null,
      status: 'queued',
    },
  })).toBeNull();
});

test('preserves job revision and successful result for product actions', () => {
  expect(
    normalizeJobEnvelope({
      job: {
        id: 'job-actionable',
        originRoomId: null,
        originRoomMessageId: null,
        result: { delivered: true },
        revision: 7,
        status: 'succeeded',
      },
    })
  ).toMatchObject({
    id: 'job-actionable',
    result: { delivered: true },
    revision: 7,
  });
});

test('preserves runtime kinds so incompatible explicit choices can be disabled', () => {
  const launch = normalizeExecutionLaunch({
    receipt: {
      jobId: 'job-runtime-capabilities',
      selection: {
        matched: true,
        selected: {
          descriptor: {
            capabilities: { kinds: ['browser'] },
            displayName: 'Browser only',
            runtimeId: 'runtime-browser',
          },
        },
      },
      status: 'queued',
    },
  });

  expect(launch?.job.selectedRuntime).toMatchObject({
    capabilities: { kinds: ['browser'] },
    id: 'runtime-browser',
  });
});

test('submits only client-owned fields using the canonical idempotency header', async () => {
  const originalFetch = globalThis.fetch;
  let submittedBody: unknown;
  let submittedHeaders = new Headers();

  globalThis.fetch = (async (_input, init) => {
    submittedBody = safeJsonParse<unknown>(String(init?.body), null);
    submittedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        schemaVersion: 1,
        receipt: {
          schemaVersion: 1,
          acceptedAt: '2026-08-21T12:00:00.000Z',
          jobId: 'job-filtered-payload',
          revision: 1,
          selectedRuntimeId: null,
          selection: {
            schemaVersion: 1,
            matched: false,
            selected: null,
            failure: {
              code: 'no-compatible-runtime',
              message: 'No compatible runtime is registered.',
            },
            evaluations: [],
          },
          status: 'blocked',
          teamTaskId: 'team-task-1',
        },
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 202,
      }
    );
  }) as typeof fetch;

  try {
    const input = {
      agentPreference: { orderedRuntimeIds: ['client-authored-runtime'] },
      contextManifest: { clientAuthored: true },
      conversationId: 'conversation-1',
      documentVersionId: 'version-1',
      goal: 'Ship the document',
      kind: 'coding',
      organizationPolicy: { allowedRuntimeIds: ['client-authored-runtime'] },
      projectId: 'project-1',
      requirements: {},
      runtimeSelection: { mode: 'auto' },
      teamTaskId: 'team-task-1',
      watermark: { sequence: 42 },
      workspaceId: 'workspace-1',
    } as CreateExecutionJobInput;

    const result = await createExecutionJob(input, 'execution-idempotency-1');

    expect(result.ok).toBe(true);
    expect(submittedHeaders.get('x-dao-idempotency-key')).toBe(
      'execution-idempotency-1'
    );
    expect(submittedBody).toEqual({
      conversationId: 'conversation-1',
      documentVersionId: 'version-1',
      goal: 'Ship the document',
      kind: 'coding',
      projectId: 'project-1',
      requirements: {},
      runtimeSelection: { mode: 'auto' },
      teamTaskId: 'team-task-1',
      workspaceId: 'workspace-1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizes a matched receipt and its runtime selection reason', () => {
  const launch = normalizeExecutionLaunch(
    {
      schemaVersion: 1,
      receipt: {
        schemaVersion: 1,
        acceptedAt: '2026-08-21T12:00:00.000Z',
        jobId: 'job-queued',
        revision: 1,
        selectedRuntimeId: 'runtime-1',
        selection: {
          schemaVersion: 1,
          matched: true,
          selected: {
            descriptor: {
              displayName: 'Runtime One',
              runtimeId: 'runtime-1',
            },
            health: { acceptingNewAttempts: true, state: 'healthy' },
            capacity: { availableSlots: 1 },
          },
          selectedBy: 'automatic-ranking',
          evaluations: [],
        },
        status: 'queued',
        teamTaskId: null,
      },
    },
    { goal: 'Ship the document', kind: 'coding' }
  );

  expect(launch).toMatchObject({
    job: {
      id: 'job-queued',
      selectedRuntime: { id: 'runtime-1', name: 'Runtime One' },
      selectedRuntimeId: 'runtime-1',
      selectionReason: 'automatic-ranking',
      status: 'queued',
    },
    receipt: {
      blocked: false,
      jobId: 'job-queued',
      selectedRuntimeId: 'runtime-1',
      selectionReason: 'automatic-ranking',
      status: 'queued',
    },
  });
});

test('reads selectedBy from a nested selected result when supplied', () => {
  const launch = normalizeExecutionLaunch(
    {
      receipt: {
        jobId: 'job-nested-selection-reason',
        selection: {
          matched: true,
          selected: { selectedBy: 'explicit-request' },
        },
        status: 'queued',
      },
    },
    { goal: 'Use the requested runtime', kind: 'coding' }
  );

  expect(launch?.job.selectionReason).toBe('explicit-request');
  expect(launch?.receipt.selectionReason).toBe('explicit-request');
});

test('keeps an accepted blocked receipt distinct from execution lifecycle state', () => {
  const acceptedAt = '2026-08-21T12:00:00.000Z';
  const launch = normalizeExecutionLaunch(
    {
      schemaVersion: 1,
      receipt: {
        schemaVersion: 1,
        acceptedAt,
        jobId: 'job-blocked',
        revision: 1,
        selectedRuntimeId: null,
        selection: {
          schemaVersion: 1,
          matched: false,
          selected: null,
          failure: {
            code: 'no-compatible-runtime',
            message: 'No compatible runtime is registered.',
          },
          evaluations: [],
        },
        status: 'blocked',
        teamTaskId: null,
      },
    },
    { goal: 'Ship the document', kind: 'coding' }
  );

  expect(launch).toMatchObject({
    job: {
      goal: 'Ship the document',
      id: 'job-blocked',
      status: 'blocked',
    },
    receipt: {
      acceptedAt,
      blocked: true,
      jobId: 'job-blocked',
      reason: 'No compatible runtime is registered.',
      selectionReason: 'no-compatible-runtime',
      status: 'blocked',
    },
  });
});

test('uses only the immutable receipt disposition when a job is also returned', () => {
  const launch = normalizeExecutionLaunch(
    {
      receipt: {
        acceptedAt: '2026-08-21T12:00:00.000Z',
        jobId: 'job-queued',
        status: 'queued',
      },
      job: {
        id: 'job-queued',
        status: 'failed',
        spec: { goal: 'Later failure', kind: 'coding' },
      },
    },
    { goal: 'Later failure', kind: 'coding' }
  );

  expect(launch?.job.status).toBe('failed');
  expect(launch?.receipt).toMatchObject({
    blocked: false,
    status: 'queued',
  });
});
