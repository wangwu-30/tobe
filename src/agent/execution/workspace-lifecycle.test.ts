import assert from 'node:assert/strict';
import test from 'node:test';

import { assertErrorMatches } from '@/lib/testing/node-assert';

import {
  WorkspaceLifecycleErrorV1,
  assertWorkspaceLifecycleAdvanceV1,
  isWorkspaceLifecycleAdvanceV1,
  parseStoredWorkspaceLifecycleV1,
  parseWorkspaceLifecycleV1,
  serializeWorkspaceLifecycleV1,
  type WorkspaceLifecycleV1,
} from './workspace-lifecycle';

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const PATCH = '3'.repeat(64);

function lifecycle(): WorkspaceLifecycleV1 {
  return {
    schemaVersion: 1,
    kind: 'git-worktree',
    binding: {
      schemaVersion: 1,
      bindingId: 'binding-1',
      spaceId: 'space-1',
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      mountPath: '/',
      defaultBranch: 'main',
      baseCommit: BASE,
    },
    prepared: {
      schemaVersion: 1,
      spaceId: 'space-1',
      mountPath: '/',
      repositoryPath: '/srv/repos/knowledge',
      worktreePath: '/srv/worktrees/attempt-1',
      defaultBranch: 'main',
      branch: 'agent/agent-1/job/job-1/attempt/1',
      baseCommit: BASE,
      jobId: 'job-1',
      attemptId: 'attempt-1',
      attemptNumber: 1,
      agentId: 'agent-1',
    },
  };
}

function withCompletion(
  value = lifecycle(),
  status: 'succeeded' | 'failed' | 'cancelled' = 'succeeded'
): WorkspaceLifecycleV1 {
  return {
    ...value,
    runtimeCompletion: {
      status,
      result: { z: 1, a: { second: true, first: false } },
      runtimeRunId: 'runtime-run-1',
    },
  };
}

function withFinalized(value = withCompletion()): WorkspaceLifecycleV1 {
  return {
    ...value,
    finalized: {
      schemaVersion: 1,
      spaceId: 'space-1',
      jobId: 'job-1',
      attemptId: 'attempt-1',
      agentId: 'agent-1',
      changed: true,
      baseCommit: BASE,
      headCommit: HEAD,
      branch: 'agent/agent-1/job/job-1/attempt/1',
      files: ['README.md'],
      diffSummary: {
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
        shortStat: '1 file changed, 1 insertion(+)',
      },
      patchSha256: PATCH,
    },
  };
}

test('strictly parses, deep-copies, and stably serializes a private receipt', () => {
  const input = withFinalized();
  const parsed = parseWorkspaceLifecycleV1(input);

  assert.deepEqual(parsed, input);
  assert.notEqual(parsed, input);
  assert.notEqual(parsed.binding, input.binding);
  assert.notEqual(parsed.prepared, input.prepared);
  assert.notEqual(
    parsed.runtimeCompletion?.result,
    input.runtimeCompletion?.result
  );
  assert.equal(
    serializeWorkspaceLifecycleV1(input),
    serializeWorkspaceLifecycleV1(parsed)
  );
  assert.ok(
    serializeWorkspaceLifecycleV1(input).includes(
      '"result":{"a":{"first":false,"second":true},"z":1}'
    )
  );
  assert.equal(parsed.prepared.repositoryPath, '/srv/repos/knowledge');
  assert.equal('repositoryPath' in parsed.binding, false);
  assert.equal('worktreePath' in parsed.binding, false);
});

test('stored values fail closed on invalid JSON, unknown fields, and misalignment', () => {
  assert.equal(parseStoredWorkspaceLifecycleV1(null), null);
  expectLifecycleError(
    () => parseStoredWorkspaceLifecycleV1('{'),
    'invalid-json'
  );
  expectLifecycleError(
    () => parseWorkspaceLifecycleV1({ ...lifecycle(), secret: 'no' }),
    'invalid-lifecycle',
    'lifecycle.secret'
  );
  expectLifecycleError(
    () =>
      parseWorkspaceLifecycleV1({
        ...lifecycle(),
        prepared: { ...lifecycle().prepared, baseCommit: HEAD },
      }),
    'invalid-lifecycle',
    'lifecycle.prepared.baseCommit'
  );
  expectLifecycleError(
    () => parseWorkspaceLifecycleV1(withFinalized(withCompletion(lifecycle(), 'failed'))),
    'invalid-lifecycle',
    'lifecycle.finalized'
  );
  expectLifecycleError(
    () => parseWorkspaceLifecycleV1({ ...lifecycle(), changeRequestId: 'cr-1' }),
    'invalid-lifecycle',
    'lifecycle.changeRequestId'
  );
});

test('allows exact replay and exactly one valid durable stage per advance', () => {
  const prepared = lifecycle();
  const completed = withCompletion(prepared);
  const finalized = withFinalized(completed);
  const proposed = { ...finalized, changeRequestId: 'change-1' };
  const cleaned = { ...proposed, cleanedAt: '2026-08-21T04:00:00.000Z' };

  assert.equal(isWorkspaceLifecycleAdvanceV1(null, prepared), true);
  assert.equal(isWorkspaceLifecycleAdvanceV1(prepared, prepared), true);
  assert.equal(isWorkspaceLifecycleAdvanceV1(prepared, completed), true);
  assert.equal(isWorkspaceLifecycleAdvanceV1(completed, finalized), true);
  assert.equal(isWorkspaceLifecycleAdvanceV1(finalized, proposed), true);
  assert.equal(isWorkspaceLifecycleAdvanceV1(proposed, cleaned), true);

  assert.equal(isWorkspaceLifecycleAdvanceV1(null, completed), false);
  assert.equal(isWorkspaceLifecycleAdvanceV1(prepared, finalized), false);
  assert.equal(
    isWorkspaceLifecycleAdvanceV1(completed, {
      ...completed,
      prepared: { ...completed.prepared, worktreePath: '/tmp/replaced' },
    }),
    false
  );
  assert.equal(isWorkspaceLifecycleAdvanceV1(cleaned, proposed), false);
  assert.throws(
    () => assertWorkspaceLifecycleAdvanceV1(prepared, finalized),
    WorkspaceLifecycleErrorV1
  );
});

test('failed or unchanged runs skip inapplicable stages and advance to cleanup', () => {
  const failed = withCompletion(lifecycle(), 'failed');
  assert.equal(
    isWorkspaceLifecycleAdvanceV1(failed, {
      ...failed,
      cleanedAt: '2026-08-21T04:00:00Z',
    }),
    true
  );

  const finalized = withFinalized();
  const unchanged: WorkspaceLifecycleV1 = {
    ...finalized,
    finalized: {
      ...finalized.finalized!,
      changed: false,
      headCommit: BASE,
      files: [],
      diffSummary: {
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        shortStat: '',
      },
    },
  };
  assert.equal(
    isWorkspaceLifecycleAdvanceV1(unchanged, {
      ...unchanged,
      cleanedAt: '2026-08-21T04:00:00.000Z',
    }),
    true
  );
  assert.equal(
    isWorkspaceLifecycleAdvanceV1(unchanged, {
      ...unchanged,
      changeRequestId: 'must-not-exist',
    }),
    false
  );
});

function expectLifecycleError(
  action: () => unknown,
  code: WorkspaceLifecycleErrorV1['code'],
  path?: string
): void {
  assert.throws(action, (error: unknown) =>
    assertErrorMatches(
      error,
      { code, ...(path ? { path } : {}) },
      WorkspaceLifecycleErrorV1
    )
  );
}
