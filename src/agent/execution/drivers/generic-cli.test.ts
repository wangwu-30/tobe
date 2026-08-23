import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { safeJsonParse } from '@/framework/resilience/safe-data';

import type { RuntimeEventV1, RuntimeStartAttemptV1 } from '../driver';
import {
  GENERIC_CLI_INVALID_WORKSPACE_MESSAGE_V1,
  GENERIC_CLI_INTERRUPTED_MESSAGE_V1,
  GENERIC_CLI_NON_ZERO_EXIT_MESSAGE_V1,
  GENERIC_CLI_START_FAILED_MESSAGE_V1,
  GENERIC_CLI_STDERR_TRUNCATED_MESSAGE_V1,
  GENERIC_CLI_STDOUT_TRUNCATED_MESSAGE_V1,
  GENERIC_CLI_SUPERVISOR_SOURCE_V1,
  GENERIC_CLI_TIMEOUT_MESSAGE_V1,
  GenericCliConfigurationErrorV1,
  GenericCliExecutionRuntimeDriverV1,
  type GenericCliExecutionRuntimeDriverConfigV1,
} from './generic-cli';

const BASE_CONFIG: GenericCliExecutionRuntimeDriverConfigV1 = {
  executable: process.execPath,
  args: ['-e', 'process.stdin.resume()'],
  cwd: process.cwd(),
  env: {},
  runtimeVersion: 'test-runtime',
};

function attempt(attemptId: string, contextManifest: unknown = {}): RuntimeStartAttemptV1 {
  return {
    jobId: `job-${attemptId}`,
    attemptId,
    generation: 1,
    executionSpec: {
      schemaVersion: 1,
      goal: `goal-${attemptId}`,
      kind: 'coding',
      requirements: {},
    },
    contextManifest,
  };
}

async function collect(
  events: AsyncIterable<RuntimeEventV1>
): Promise<RuntimeEventV1[]> {
  const collected: RuntimeEventV1[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function stdout(events: readonly RuntimeEventV1[]): string {
  return events
    .filter(
      (event): event is Extract<RuntimeEventV1, { type: 'text-delta' }> =>
        event.type === 'text-delta'
    )
    .map(({ text }) => text)
    .join('');
}

test('requires absolute executable and cwd paths', () => {
  expect(
    () =>
      new GenericCliExecutionRuntimeDriverV1({
        ...BASE_CONFIG,
        executable: 'node',
      })
  ).toThrow(GenericCliConfigurationErrorV1);
  expect(
    () =>
      new GenericCliExecutionRuntimeDriverV1({
        ...BASE_CONFIG,
        cwd: 'relative-workspace',
      })
  ).toThrow(GenericCliConfigurationErrorV1);
});

test('describes only the capabilities the host process driver implements', async () => {
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    runtimeId: 'trusted-cli',
    supportedModels: ['model-a'],
    features: ['trusted-config'],
    selectionPriority: 4,
  });

  await expect(driver.describe()).resolves.toMatchObject({
    runtimeId: 'trusted-cli',
    displayName: 'Generic CLI',
    runtimeVersion: 'test-runtime',
    selectionPriority: 4,
    capabilities: {
      kinds: ['coding'],
      nativeResume: false,
      checkpoint: false,
      streaming: 'text',
      interrupt: 'process-kill',
      workspace: 'none',
      sandbox: 'host',
      structuredArtifacts: false,
      waitingForHuman: false,
      supportedModels: ['model-a'],
      features: ['trusted-config'],
    },
  });
  expect('resume' in driver).toBe(false);
});

test('runs the configured executable without a shell and sends a versioned stdin envelope', async () => {
  const script = [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ cwd: process.cwd(), marker: process.env.ONLY_PROVIDED, path: process.env.PATH ?? null, arg: process.argv[1], input })));",
  ].join('');
  const literalArg = '$(printf shell-injection); *';
  const input = attempt('envelope', { source: 'frozen-manifest' });
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    args: ['-e', script, literalArg],
    env: { ONLY_PROVIDED: 'controlled' },
  });

  const events = await collect(driver.start(input));
  const expectedEnvelope = JSON.stringify({
    schemaVersion: 1,
    operation: 'start',
    attempt: { jobId: input.jobId, attemptId: input.attemptId, generation: 1 },
    executionSpec: input.executionSpec,
    contextManifest: input.contextManifest,
  });

  expect(stdout(events)).toBe(
    JSON.stringify({
      cwd: process.cwd(),
      marker: 'controlled',
      path: null,
      arg: literalArg,
      input: `${expectedEnvelope}\n`,
    })
  );
  expect(events[0]).toMatchObject({ type: 'attempt-started' });
  expect(events.at(-1)).toEqual({
    type: 'attempt-completed',
    status: 'succeeded',
  });
});

test('uses a trusted file workspace for cwd and includes it in the envelope', async () => {
  const workspacePath = await mkdtemp(
    path.join(os.tmpdir(), 'generic-cli-workspace-')
  );
  const script = [
    "let input = '';",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', (chunk) => { input += chunk; });",
    "process.stdin.on('end', () => process.stdout.write(JSON.stringify({ cwd: process.cwd(), envelopeJson: input })));",
  ].join('');
  const input = {
    ...attempt('trusted-workspace'),
    workspace: {
      uri: pathToFileURL(workspacePath).href,
      revision: '0123456789abcdef',
    },
  } satisfies RuntimeStartAttemptV1;
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    args: ['-e', script],
  });

  try {
    const events = await collect(driver.start(input));
    const output = safeJsonParse<{ cwd?: unknown; envelopeJson?: unknown }>(
      stdout(events),
      {}
    );
    expect({
      cwd: output.cwd,
      envelope: safeJsonParse<unknown>(
        typeof output.envelopeJson === 'string' ? output.envelopeJson : null,
        null
      ),
    }).toEqual({
      cwd: workspacePath,
      envelope: {
        schemaVersion: 1,
        operation: 'start',
        attempt: {
          jobId: input.jobId,
          attemptId: input.attemptId,
          generation: input.generation,
        },
        executionSpec: input.executionSpec,
        contextManifest: input.contextManifest,
        workspace: input.workspace,
      },
    });
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('rejects non-local or decorated workspace URLs before spawning', async () => {
  const driver = new GenericCliExecutionRuntimeDriverV1(BASE_CONFIG);

  for (const uri of [
    'https://example.test/workspace',
    'file://remote-host/workspace',
    'file:///tmp/workspace?override=true',
    'file:///tmp/workspace#fragment',
  ]) {
    const events = await collect(
      driver.start({
        ...attempt(`invalid-${encodeURIComponent(uri)}`),
        workspace: { uri },
      })
    );
    expect(events.at(-1)).toEqual({
      type: 'attempt-completed',
      status: 'failed',
      message: GENERIC_CLI_INVALID_WORKSPACE_MESSAGE_V1,
    });
  }
});

test('bounds stdout and stderr while never forwarding stderr contents', async () => {
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    args: [
      '-e',
      "process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write('abcdef'); process.stderr.write('TOP-SECRET-STDERR'); });",
    ],
    maxStdoutBytes: 3,
    maxStderrBytes: 4,
  });

  const events = await collect(driver.start(attempt('limits')));
  const progress = events
    .filter(
      (event): event is Extract<RuntimeEventV1, { type: 'progress' }> =>
        event.type === 'progress'
    )
    .map(({ message }) => message);

  expect(stdout(events)).toBe('abc');
  expect(progress).toContain(GENERIC_CLI_STDOUT_TRUNCATED_MESSAGE_V1);
  expect(progress).toContain(GENERIC_CLI_STDERR_TRUNCATED_MESSAGE_V1);
  expect(JSON.stringify(events)).not.toContain('TOP-SECRET-STDERR');
  expect(events.at(-1)).toEqual({
    type: 'attempt-completed',
    status: 'succeeded',
  });
});

test('maps a non-zero process exit to a stable failed event', async () => {
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    args: ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.exit(7));"],
  });

  const events = await collect(driver.start(attempt('non-zero')));
  expect(events.at(-1)).toEqual({
    type: 'attempt-completed',
    status: 'failed',
    message: GENERIC_CLI_NON_ZERO_EXIT_MESSAGE_V1,
  });
});

test('times out with TERM followed by KILL and exposes a stable terminal result', async () => {
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    args: [
      '-e',
      "process.on('SIGTERM', () => process.stdout.write('term-received')); process.stdin.resume(); setInterval(() => {}, 1000);",
    ],
    timeoutMs: 300,
    interruptGracePeriodMs: 50,
  });

  const events = await collect(driver.start(attempt('timeout')));
  const started = events[0];
  expect(started.type).toBe('attempt-started');
  expect(stdout(events)).toContain('term-received');
  expect(events.at(-1)).toEqual({
    type: 'attempt-completed',
    status: 'failed',
    message: GENERIC_CLI_TIMEOUT_MESSAGE_V1,
  });
  if (started.type !== 'attempt-started') {
    throw new Error('Expected attempt-started event.');
  }
  await expect(
    driver.reconcile({
      jobId: 'job-timeout',
      attemptId: 'timeout',
      generation: 1,
      runtimeAttemptId: started.runtimeAttemptId,
    })
  ).resolves.toEqual({
    runtimeAttemptId: started.runtimeAttemptId,
    status: 'failed',
    message: GENERIC_CLI_TIMEOUT_MESSAGE_V1,
  });
});

test('interrupts the requested concurrent attempt and archive releases its snapshot', async () => {
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    args: ['-e', "process.stdin.resume(); setInterval(() => {}, 1000);"],
    interruptGracePeriodMs: 50,
  });
  const firstIterator = driver.start(attempt('first'))[Symbol.asyncIterator]();
  const secondIterator = driver.start(attempt('second'))[Symbol.asyncIterator]();
  const firstStarted = await firstIterator.next();
  const secondStarted = await secondIterator.next();
  expect(firstStarted.value?.type).toBe('attempt-started');
  expect(secondStarted.value?.type).toBe('attempt-started');
  if (
    firstStarted.value?.type !== 'attempt-started' ||
    secondStarted.value?.type !== 'attempt-started'
  ) {
    throw new Error('Expected both attempts to start.');
  }

  const firstRef = {
    jobId: 'job-first',
    attemptId: 'first',
    generation: 1,
    runtimeAttemptId: firstStarted.value.runtimeAttemptId,
  };
  const secondRef = {
    jobId: 'job-second',
    attemptId: 'second',
    generation: 1,
    runtimeAttemptId: secondStarted.value.runtimeAttemptId,
  };
  await driver.interrupt({ ...firstRef, generation: 2 });
  await expect(driver.archive(firstRef)).resolves.toEqual([]);
  await expect(driver.reconcile(firstRef)).resolves.toMatchObject({
    status: 'running',
  });
  await expect(driver.reconcile(secondRef)).resolves.toMatchObject({
    status: 'running',
  });

  await driver.interrupt(firstRef);

  await expect(driver.reconcile(firstRef)).resolves.toMatchObject({
    status: 'interrupted',
    message: GENERIC_CLI_INTERRUPTED_MESSAGE_V1,
  });
  await expect(driver.reconcile(secondRef)).resolves.toMatchObject({
    status: 'running',
  });
  const remainingFirst = await collect({
    [Symbol.asyncIterator]: () => firstIterator,
  });
  expect(remainingFirst.at(-1)).toEqual({
    type: 'attempt-completed',
    status: 'interrupted',
    message: GENERIC_CLI_INTERRUPTED_MESSAGE_V1,
  });
  await expect(driver.interrupt(firstRef)).resolves.toBeUndefined();

  await expect(driver.archive(firstRef)).resolves.toEqual([]);
  await expect(driver.reconcile(firstRef)).resolves.toEqual({
    runtimeAttemptId: firstRef.runtimeAttemptId,
    status: 'unknown',
  });

  await driver.interrupt(secondRef);
  await collect({ [Symbol.asyncIterator]: () => secondIterator });
});

test('sanitizes process startup failures instead of exposing trusted config', async () => {
  const secret = 'secret-from-composition-root';
  const driver = new GenericCliExecutionRuntimeDriverV1({
    ...BASE_CONFIG,
    executable: `/definitely-missing/${secret}`,
    env: { TOKEN: secret },
  });

  const events = await collect(driver.start(attempt('spawn-failure')));
  expect(events.at(-1)).toEqual({
    type: 'attempt-completed',
    status: 'failed',
    message: GENERIC_CLI_START_FAILED_MESSAGE_V1,
  });
  expect(JSON.stringify(events)).not.toContain(secret);
});

test('supervisor terminates its CLI ownership when the parent-death pipe closes', async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), 'generic-cli-parent-death-')
  );
  const markerPath = path.join(temporaryRoot, 'child.pid');
  const targetScript = [
    "require('node:fs').writeFileSync(process.argv[1], String(process.pid));",
    "process.on('SIGTERM', () => process.exit(0));",
    'setInterval(() => {}, 1000);',
  ].join('');
  const supervisor = spawn(
    process.execPath,
    [
      '--eval',
      GENERIC_CLI_SUPERVISOR_SOURCE_V1,
      '--',
      process.execPath,
      temporaryRoot,
      '100',
      '-e',
      targetScript,
      markerPath,
    ],
    {
      cwd: temporaryRoot,
      env: {} as NodeJS.ProcessEnv,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    }
  ) as ChildProcess;

  try {
    const childPid = await readPidEventually(markerPath);
    const parentDeathPipe = supervisor.stdio[3];
    if (!parentDeathPipe || !('end' in parentDeathPipe)) {
      throw new Error('Expected supervisor parent-death pipe.');
    }
    parentDeathPipe.end();
    await waitForExit(supervisor);
    await expectProcessToExit(childPid);
  } finally {
    supervisor.kill('SIGKILL');
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function readPidEventually(markerPath: string): Promise<number> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      return Number(await readFile(markerPath, 'utf8'));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error('Timed out waiting for supervised child pid.');
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    child.once('close', () => resolve());
    child.once('error', reject);
  });
}

async function expectProcessToExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Supervised process ${pid} survived parent-death cleanup.`);
}
