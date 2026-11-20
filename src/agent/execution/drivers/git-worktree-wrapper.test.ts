import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMatchesObject } from '@/lib/testing/node-assert';

import { RUNTIME_CONTRACT_VERSION_V1 } from '../contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeEventV1,
  RuntimeStartAttemptV1,
} from '../driver';
import {
  GitWorktreeExecutionRuntimeDriverV1,
  GitWorktreeWorkspaceRequiredErrorV1,
} from './git-worktree-wrapper';

const VERSION = RUNTIME_CONTRACT_VERSION_V1;

function startInput(workspace = true): RuntimeStartAttemptV1 {
  return {
    jobId: 'job-1',
    attemptId: 'attempt-1',
    generation: 1,
    executionSpec: {
      schemaVersion: VERSION,
      goal: 'Implement the requested change.',
      kind: 'coding',
      requirements: { workspace: 'git-worktree' },
    },
    contextManifest: { frozen: true },
    ...(workspace
      ? {
          workspace: {
            uri: 'file:///trusted/worktrees/attempt-1',
            revision: '0123456789abcdef',
          },
        }
      : {}),
  };
}

function innerDriver() {
  const starts: RuntimeStartAttemptV1[] = [];
  const interrupts: unknown[] = [];
  const reconciles: unknown[] = [];
  const archives: unknown[] = [];
  const driver: ExecutionRuntimeDriverV1 = {
    async describe() {
      return {
        schemaVersion: VERSION,
        runtimeId: 'generic-cli',
        displayName: 'Generic CLI',
        runtimeVersion: 'test',
        capabilities: {
          schemaVersion: VERSION,
          kinds: ['coding'],
          nativeResume: false,
          checkpoint: false,
          streaming: 'text',
          interrupt: 'process-kill',
          workspace: 'none',
          sandbox: 'host',
          structuredArtifacts: false,
          waitingForHuman: false,
          supportedModels: [],
        },
      };
    },
    start(input) {
      starts.push(input);
      return noEvents();
    },
    async interrupt(input) {
      interrupts.push(input);
    },
    async reconcile(input) {
      reconciles.push(input);
      return {
        runtimeAttemptId: input.runtimeAttemptId,
        status: 'running',
      };
    },
    async archive(input) {
      archives.push(input);
      return [];
    },
  };
  return { archives, driver, interrupts, reconciles, starts };
}

async function* noEvents(): AsyncIterable<RuntimeEventV1> {}

test('upgrades only workspace capability and preserves base descriptor fields', async () => {
  const inner = innerDriver();
  const wrapper = new GitWorktreeExecutionRuntimeDriverV1(inner.driver);

  assertMatchesObject(await inner.driver.describe(), {
    capabilities: { workspace: 'none' },
  });
  assertMatchesObject(await wrapper.describe(), {
    runtimeId: 'generic-cli',
    capabilities: {
      workspace: 'git-worktree',
      streaming: 'text',
      interrupt: 'process-kill',
    },
  });
  assert.equal(wrapper.resume, undefined);
});

test('fails closed before delegation when workspace is missing', () => {
  const inner = innerDriver();
  const wrapper = new GitWorktreeExecutionRuntimeDriverV1(inner.driver);

  assert.throws(
    () => wrapper.start(startInput(false)),
    GitWorktreeWorkspaceRequiredErrorV1
  );
  assert.deepEqual(inner.starts, []);
});

test('passes workspace and all lifecycle calls through unchanged', async () => {
  const inner = innerDriver();
  const wrapper = new GitWorktreeExecutionRuntimeDriverV1(inner.driver);
  const input = startInput();
  const attemptRef = {
    jobId: input.jobId,
    attemptId: input.attemptId,
    generation: input.generation,
    runtimeAttemptId: 'runtime-attempt-1',
  };

  assert.notEqual(wrapper.start(input), undefined);
  assert.deepEqual(inner.starts, [input]);
  await wrapper.interrupt(attemptRef);
  await wrapper.reconcile(attemptRef);
  await wrapper.archive(attemptRef);
  assert.deepEqual(inner.interrupts, [attemptRef]);
  assert.deepEqual(inner.reconciles, [attemptRef]);
  assert.deepEqual(inner.archives, [attemptRef]);
});
