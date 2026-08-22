import { expect, test } from '@playwright/test';

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

  await expect(inner.driver.describe()).resolves.toMatchObject({
    capabilities: { workspace: 'none' },
  });
  await expect(wrapper.describe()).resolves.toMatchObject({
    runtimeId: 'generic-cli',
    capabilities: {
      workspace: 'git-worktree',
      streaming: 'text',
      interrupt: 'process-kill',
    },
  });
  expect(wrapper.resume).toBeUndefined();
});

test('fails closed before delegation when workspace is missing', () => {
  const inner = innerDriver();
  const wrapper = new GitWorktreeExecutionRuntimeDriverV1(inner.driver);

  expect(() => wrapper.start(startInput(false))).toThrow(
    GitWorktreeWorkspaceRequiredErrorV1
  );
  expect(inner.starts).toEqual([]);
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

  expect(wrapper.start(input)).toBeDefined();
  expect(inner.starts).toEqual([input]);
  await wrapper.interrupt(attemptRef);
  await wrapper.reconcile(attemptRef);
  await wrapper.archive(attemptRef);
  expect(inner.interrupts).toEqual([attemptRef]);
  expect(inner.reconciles).toEqual([attemptRef]);
  expect(inner.archives).toEqual([attemptRef]);
});
