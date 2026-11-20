import assert from 'node:assert/strict';
import test from 'node:test';
import { safeJsonParse } from '@/framework/resilience/safe-data';
import { assertMatchesObject } from '@/lib/testing/node-assert';

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
    assert.deepEqual(
      await listExecutionJobs({
        cursor: 'cursor/next',
        limit: 25,
        search: 'C++ & runtime/一',
        signal: controller.signal,
        status: 'running',
      }),
      {
        data: {
          items: [],
          pageInfo: { hasNextPage: false, nextCursor: null },
        },
        ok: true,
      }
    );
    const requested = new URL(requestedUrl, 'http://local.test');
    assert.ok(requestedUrl.includes('q=C%2B%2B+%26+runtime%2F%E4%B8%80'));
    assert.equal(requested.pathname, '/api/execution-jobs');
    assert.equal(requested.searchParams.get('cursor'), 'cursor/next');
    assert.equal(requested.searchParams.get('limit'), '25');
    assert.equal(requested.searchParams.get('q'), 'C++ & runtime/一');
    assert.equal(requested.searchParams.get('status'), 'running');
    assert.equal(Boolean(requestedSignal), true);
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

    assert.equal(
      requestedUrl,
      '/api/execution-jobs/job%20%2F%20logs/logs?afterSequence=7'
    );
    assertMatchesObject(result, {
      data: {
        items: [
          {
            id: 'log-text',
            text: ' line one\nline two ',
            payloadValid: true,
          },
          {
            id: 'log-progress',
            text: 'Almost done',
            percent: 80,
            payloadValid: true,
          },
          {
            id: 'log-invalid-payload',
            text: null,
            percent: null,
            payloadValid: false,
          },
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
  assertMatchesObject(
    normalizeJobEnvelope({
      job: {
        id: 'job-with-origin',
        originRoomId: 'room-1',
        originRoomMessageId: 'message-1',
        status: 'queued',
      },
    }),
    {
      originRoomId: 'room-1',
      originRoomMessageId: 'message-1',
    }
  );
  assertMatchesObject(
    normalizeJobEnvelope({
      job: {
        id: 'job-without-origin',
        originRoomId: null,
        originRoomMessageId: null,
        status: 'queued',
      },
    }),
    {
      originRoomId: null,
      originRoomMessageId: null,
    }
  );
  assert.equal(
    normalizeJobEnvelope({
      job: {
        id: 'job-with-partial-origin',
        originRoomId: 'room-1',
        originRoomMessageId: null,
        status: 'queued',
      },
    }),
    null
  );
});

test('preserves job revision and successful result for product actions', () => {
  assertMatchesObject(
    normalizeJobEnvelope({
      job: {
        id: 'job-actionable',
        originRoomId: null,
        originRoomMessageId: null,
        result: { delivered: true },
        revision: 7,
        status: 'succeeded',
      },
    }),
    {
      id: 'job-actionable',
      result: { delivered: true },
      revision: 7,
    }
  );
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

  assertMatchesObject(launch?.job.selectedRuntime, {
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

    assert.equal(result.ok, true);
    assert.equal(
      submittedHeaders.get('x-dao-idempotency-key'),
      'execution-idempotency-1'
    );
    assert.deepEqual(submittedBody, {
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

  assertMatchesObject(launch, {
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

  assert.equal(launch?.job.selectionReason, 'explicit-request');
  assert.equal(launch?.receipt.selectionReason, 'explicit-request');
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

  assertMatchesObject(launch, {
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

  assert.equal(launch?.job.status, 'failed');
  assertMatchesObject(launch?.receipt, {
    blocked: false,
    status: 'queued',
  });
});
