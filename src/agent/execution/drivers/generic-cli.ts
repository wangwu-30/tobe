import {
  spawn,
  type ChildProcessByStdio,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  RUNTIME_CONTRACT_VERSION_V1,
  type ExecutionSpecV1,
  type RuntimeDescriptorV1,
} from '../contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeArchiveAttemptV1,
  RuntimeArtifactRefV1,
  RuntimeAttemptRefV1,
  RuntimeAttemptStatusV1,
  RuntimeEventV1,
  RuntimeInterruptAttemptV1,
  RuntimeReconcileAttemptV1,
  RuntimeSnapshotV1,
  RuntimeStartAttemptV1,
  RuntimeWorkspaceRefV1,
} from '../driver';

export const GENERIC_CLI_RUNTIME_ID_V1 = 'generic-cli';
export const GENERIC_CLI_DEFAULT_TIMEOUT_MS_V1 = 5 * 60_000;
export const GENERIC_CLI_DEFAULT_INTERRUPT_GRACE_PERIOD_MS_V1 = 5_000;
export const GENERIC_CLI_DEFAULT_MAX_STDOUT_BYTES_V1 = 1024 * 1024;
export const GENERIC_CLI_DEFAULT_MAX_STDERR_BYTES_V1 = 64 * 1024;

// These values are part of the event protocol. Consumers can recognize them
// without parsing implementation-specific prose.
export const GENERIC_CLI_STDOUT_TRUNCATED_MESSAGE_V1 =
  'generic-cli/stdout-truncated';
export const GENERIC_CLI_STDERR_TRUNCATED_MESSAGE_V1 =
  'generic-cli/stderr-truncated';
export const GENERIC_CLI_TIMEOUT_MESSAGE_V1 = 'generic-cli/timed-out';
export const GENERIC_CLI_INTERRUPTED_MESSAGE_V1 = 'generic-cli/interrupted';
export const GENERIC_CLI_START_FAILED_MESSAGE_V1 =
  'generic-cli/process-start-failed';
export const GENERIC_CLI_INPUT_FAILED_MESSAGE_V1 =
  'generic-cli/input-serialization-failed';
export const GENERIC_CLI_NON_ZERO_EXIT_MESSAGE_V1 =
  'generic-cli/non-zero-exit';
export const GENERIC_CLI_INVALID_WORKSPACE_MESSAGE_V1 =
  'generic-cli/invalid-workspace';

export const GENERIC_CLI_SUPERVISOR_SOURCE_V1 = String.raw`
const { spawn } = require('node:child_process');
const executable = process.argv[1];
const cwd = process.argv[2];
const gracePeriodMs = Number(process.argv[3]);
const args = process.argv.slice(4);
const detached = process.platform !== 'win32';
const START_FAILED_EXIT_CODE = 126;
const child = spawn(executable, args, {
  cwd,
  env: process.env,
  shell: false,
  detached,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stopping = false;
let targetClosed = false;
let killTimer;
function killTarget(signal) {
  if (!child.pid) return;
  try {
    if (detached) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
}
function stop() {
  if (stopping || targetClosed) return;
  stopping = true;
  child.stdin.destroy();
  killTarget('SIGTERM');
  killTimer = setTimeout(() => killTarget('SIGKILL'), gracePeriodMs);
  killTimer.unref();
}
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
process.stdin.on('error', () => {});
child.stdin.on('error', () => {});
const control = new (require('node:net').Socket)({
  fd: 3,
  readable: true,
  writable: false,
});
control.on('end', stop);
control.on('close', stop);
control.on('error', stop);
control.resume();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('error', () => process.exitCode = START_FAILED_EXIT_CODE);
child.on('close', (code, signal) => {
  targetClosed = true;
  if (process.exitCode !== START_FAILED_EXIT_CODE) {
    process.exitCode = stopping
      ? (signal ? 128 : (code ?? 1))
      : (code ?? (signal ? 1 : 0));
  }
  control.destroy();
  if (!stopping) {
    process.exit(process.exitCode ?? 0);
  }
});
`;

/**
 * This configuration is a trusted composition-root input. The driver takes a
 * defensive copy and never augments it with process-global or job-provided
 * command, directory, or environment values.
 */
export type GenericCliExecutionRuntimeDriverConfigV1 = {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  runtimeVersion: string;
  runtimeId?: string;
  timeoutMs?: number;
  interruptGracePeriodMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  supportedModels?: readonly string[];
  features?: readonly string[];
  selectionPriority?: number;
};

export type GenericCliStartEnvelopeV1 = {
  schemaVersion: typeof RUNTIME_CONTRACT_VERSION_V1;
  operation: 'start';
  attempt: RuntimeAttemptRefV1;
  executionSpec: ExecutionSpecV1;
  contextManifest: unknown;
  workspace?: RuntimeWorkspaceRefV1;
};

export type GenericCliConfigurationFieldV1 =
  | 'executable'
  | 'args'
  | 'cwd'
  | 'env'
  | 'runtimeVersion'
  | 'timeoutMs'
  | 'interruptGracePeriodMs'
  | 'maxStdoutBytes'
  | 'maxStderrBytes';

export class GenericCliConfigurationErrorV1 extends Error {
  readonly code = 'invalid-generic-cli-configuration' as const;
  readonly field: GenericCliConfigurationFieldV1;

  constructor(field: GenericCliConfigurationFieldV1, message: string) {
    super(message);
    this.name = 'GenericCliConfigurationErrorV1';
    this.field = field;
  }
}

type NormalizedConfig = {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  interruptGracePeriodMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
};

type TerminationReason = 'interrupt' | 'timeout';
type TerminalStatus = Extract<
  RuntimeAttemptStatusV1,
  'succeeded' | 'failed' | 'interrupted'
>;

type AttemptRecord = RuntimeAttemptRefV1 & {
  runtimeAttemptId: string;
  status: RuntimeAttemptStatusV1;
  message?: string;
  child?: ChildProcessByStdio<Writable, Readable, Readable>;
  parentDeathControl?: Writable;
  terminationReason?: TerminationReason;
  terminal: boolean;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdoutDecoder: StringDecoder;
  stdoutDecoderEnded: boolean;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  events: AsyncEventQueue<RuntimeEventV1>;
  done: Promise<void>;
  resolveDone: () => void;
};

export class GenericCliExecutionRuntimeDriverV1
  implements ExecutionRuntimeDriverV1
{
  private readonly config: NormalizedConfig;
  private readonly descriptor: RuntimeDescriptorV1;
  private readonly attempts = new Map<string, AttemptRecord>();

  constructor(config: GenericCliExecutionRuntimeDriverConfigV1) {
    this.config = normalizeConfig(config);
    this.descriptor = {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      runtimeId: config.runtimeId ?? GENERIC_CLI_RUNTIME_ID_V1,
      displayName: 'Generic CLI',
      runtimeVersion: config.runtimeVersion,
      selectionPriority: config.selectionPriority,
      capabilities: {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        kinds: ['coding'],
        nativeResume: false,
        checkpoint: false,
        streaming: 'text',
        interrupt: 'process-kill',
        workspace: 'none',
        sandbox: 'host',
        structuredArtifacts: false,
        waitingForHuman: false,
        supportedModels: [...(config.supportedModels ?? [])],
        features: config.features ? [...config.features] : undefined,
      },
    };
  }

  async describe(): Promise<RuntimeDescriptorV1> {
    return this.descriptor;
  }

  start(input: RuntimeStartAttemptV1): AsyncIterable<RuntimeEventV1> {
    return this.execute(input);
  }

  async interrupt(input: RuntimeInterruptAttemptV1): Promise<void> {
    const record = this.findAttempt(input);
    if (!record || record.terminal) {
      return;
    }

    if (!record.terminationReason) {
      record.terminationReason = 'interrupt';
      this.signalTermination(record);
    }
    await record.done;
  }

  async reconcile(
    input: RuntimeReconcileAttemptV1
  ): Promise<RuntimeSnapshotV1> {
    const record = this.findAttempt(input);
    if (!record) {
      return { runtimeAttemptId: input.runtimeAttemptId, status: 'unknown' };
    }

    return {
      runtimeAttemptId: record.runtimeAttemptId,
      status: record.status,
      ...(record.message ? { message: record.message } : {}),
    };
  }

  async archive(
    input: RuntimeArchiveAttemptV1
  ): Promise<readonly RuntimeArtifactRefV1[]> {
    const record = this.findAttempt(input);
    // This driver does not produce artifacts. Archiving a matching terminal
    // attempt releases its process-local snapshot; active and stale refs are
    // deliberately idempotent no-ops.
    if (record?.terminal) {
      this.attempts.delete(record.runtimeAttemptId);
    }
    return [];
  }

  private async *execute(
    input: RuntimeStartAttemptV1
  ): AsyncIterable<RuntimeEventV1> {
    const record = createAttemptRecord(input, this.descriptor.runtimeId);
    this.attempts.set(record.runtimeAttemptId, record);
    record.events.push({
      type: 'attempt-started',
      runtimeAttemptId: record.runtimeAttemptId,
    });

    const envelope: GenericCliStartEnvelopeV1 = {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      operation: 'start',
      attempt: {
        jobId: input.jobId,
        attemptId: input.attemptId,
        generation: input.generation,
      },
      executionSpec: input.executionSpec,
      contextManifest: input.contextManifest,
      ...(input.workspace ? { workspace: input.workspace } : {}),
    };

    let executionCwd: string;
    try {
      executionCwd = input.workspace
        ? resolveTrustedWorkspacePath(input.workspace)
        : this.config.cwd;
    } catch {
      this.finish(record, 'failed', GENERIC_CLI_INVALID_WORKSPACE_MESSAGE_V1);
      yield* record.events;
      return;
    }

    let serializedEnvelope: string;
    try {
      serializedEnvelope = JSON.stringify(envelope);
    } catch {
      this.finish(record, 'failed', GENERIC_CLI_INPUT_FAILED_MESSAGE_V1);
      yield* record.events;
      return;
    }

    try {
      const child = spawn(
        process.execPath,
        [
          '--eval',
          GENERIC_CLI_SUPERVISOR_SOURCE_V1,
          '--',
          this.config.executable,
          executionCwd,
          String(this.config.interruptGracePeriodMs),
          ...this.config.args,
        ],
        {
          cwd: executionCwd,
          env: this.config.env as NodeJS.ProcessEnv,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        }
      ) as ChildProcessByStdio<Writable, Readable, Readable>;
      record.child = child;
      record.parentDeathControl = child.stdio[3] as Writable;
      record.status = 'running';
      this.attachProcess(record);
      child.stdin.on('error', () => {
        // A child may exit before consuming stdin. Its close/error event is the
        // authoritative lifecycle result; do not expose a path-bearing error.
      });
      child.stdin.end(`${serializedEnvelope}\n`, 'utf8');
      record.timeoutHandle = setTimeout(
        () => this.timeout(record),
        this.config.timeoutMs
      );
    } catch {
      this.finish(record, 'failed', GENERIC_CLI_START_FAILED_MESSAGE_V1);
    }

    yield* record.events;
  }

  private attachProcess(record: AttemptRecord): void {
    const child = record.child;
    if (!child) {
      return;
    }

    child.stdout.on('data', (chunk: Buffer) => {
      this.consumeStdout(record, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      this.consumeStderr(record, chunk);
    });
    child.once('error', () => {
      this.finish(record, 'failed', GENERIC_CLI_START_FAILED_MESSAGE_V1);
    });
    child.once('close', (code) => {
      if (record.terminationReason === 'interrupt') {
        this.finish(record, 'interrupted', GENERIC_CLI_INTERRUPTED_MESSAGE_V1);
      } else if (record.terminationReason === 'timeout') {
        this.finish(record, 'failed', GENERIC_CLI_TIMEOUT_MESSAGE_V1);
      } else if (code === 126) {
        this.finish(record, 'failed', GENERIC_CLI_START_FAILED_MESSAGE_V1);
      } else if (code === 0) {
        this.finish(record, 'succeeded');
      } else {
        this.finish(record, 'failed', GENERIC_CLI_NON_ZERO_EXIT_MESSAGE_V1);
      }
    });
  }

  private consumeStdout(record: AttemptRecord, chunk: Buffer): void {
    const remaining = this.config.maxStdoutBytes - record.stdoutBytes;
    if (remaining > 0) {
      const accepted = chunk.subarray(0, remaining);
      record.stdoutBytes += accepted.byteLength;
      this.pushDecodedStdout(record, record.stdoutDecoder.write(accepted));
    }

    if (chunk.byteLength > Math.max(remaining, 0) && !record.stdoutTruncated) {
      record.stdoutTruncated = true;
      this.endStdoutDecoder(record);
      record.events.push({
        type: 'progress',
        message: GENERIC_CLI_STDOUT_TRUNCATED_MESSAGE_V1,
      });
    }
  }

  private consumeStderr(record: AttemptRecord, chunk: Buffer): void {
    const remaining = this.config.maxStderrBytes - record.stderrBytes;
    record.stderrBytes += Math.min(chunk.byteLength, Math.max(remaining, 0));
    if (chunk.byteLength > Math.max(remaining, 0) && !record.stderrTruncated) {
      record.stderrTruncated = true;
      record.events.push({
        type: 'progress',
        message: GENERIC_CLI_STDERR_TRUNCATED_MESSAGE_V1,
      });
    }
  }

  private pushDecodedStdout(record: AttemptRecord, text: string): void {
    if (text) {
      record.events.push({ type: 'text-delta', text });
    }
  }

  private endStdoutDecoder(record: AttemptRecord): void {
    if (record.stdoutDecoderEnded) {
      return;
    }
    record.stdoutDecoderEnded = true;
    this.pushDecodedStdout(record, record.stdoutDecoder.end());
  }

  private timeout(record: AttemptRecord): void {
    if (record.terminal || record.terminationReason) {
      return;
    }
    record.terminationReason = 'timeout';
    this.signalTermination(record);
  }

  private signalTermination(record: AttemptRecord): void {
    if (!record.child || record.terminal) {
      return;
    }
    try {
      record.parentDeathControl?.end();
    } catch {
      try {
        // The supervisor handles SIGTERM by terminating and reaping the actual
        // CLI process group. It deliberately does not exit on the signal.
        record.child.kill('SIGTERM');
      } catch {
        // Lifecycle completion remains tied to the supervisor close/error event.
      }
    }
  }

  private finish(
    record: AttemptRecord,
    status: TerminalStatus,
    message?: string
  ): void {
    if (record.terminal) {
      return;
    }
    record.terminal = true;
    record.status = status;
    record.message = message;
    if (record.timeoutHandle) {
      clearTimeout(record.timeoutHandle);
    }
    record.parentDeathControl?.destroy();
    this.endStdoutDecoder(record);
    record.events.push({
      type: 'attempt-completed',
      status,
      ...(message ? { message } : {}),
    });
    record.events.close();
    record.resolveDone();
  }

  private findAttempt(
    input:
      | RuntimeArchiveAttemptV1
      | RuntimeInterruptAttemptV1
      | RuntimeReconcileAttemptV1
  ): AttemptRecord | undefined {
    const record = this.attempts.get(input.runtimeAttemptId);
    return record &&
      record.jobId === input.jobId &&
      record.attemptId === input.attemptId &&
      record.generation === input.generation
      ? record
      : undefined;
  }
}

function createAttemptRecord(
  input: RuntimeStartAttemptV1,
  runtimeId: string
): AttemptRecord {
  let resolveDone = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  return {
    jobId: input.jobId,
    attemptId: input.attemptId,
    generation: input.generation,
    runtimeAttemptId: `${runtimeId}-${randomUUID()}`,
    status: 'starting',
    terminal: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    stdoutDecoder: new StringDecoder('utf8'),
    stdoutDecoderEnded: false,
    events: new AsyncEventQueue<RuntimeEventV1>(),
    done,
    resolveDone,
  };
}

function resolveTrustedWorkspacePath(workspace: RuntimeWorkspaceRefV1): string {
  let parsed: URL;
  try {
    parsed = new URL(workspace.uri);
  } catch {
    throw new Error('Invalid workspace URI.');
  }
  if (
    parsed.protocol !== 'file:' ||
    parsed.host ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Workspace must be a local file URL without metadata.');
  }

  const workspacePath = fileURLToPath(parsed);
  if (!path.isAbsolute(workspacePath)) {
    throw new Error('Workspace file URL must resolve to an absolute path.');
  }
  return workspacePath;
}

function normalizeConfig(
  config: GenericCliExecutionRuntimeDriverConfigV1
): NormalizedConfig {
  requireNonEmptyString(config.executable, 'executable');
  requireNonEmptyString(config.cwd, 'cwd');
  requireNonEmptyString(config.runtimeVersion, 'runtimeVersion');
  if (!path.isAbsolute(config.executable)) {
    throw new GenericCliConfigurationErrorV1(
      'executable',
      'Generic CLI executable must be an absolute path.'
    );
  }
  if (!path.isAbsolute(config.cwd)) {
    throw new GenericCliConfigurationErrorV1(
      'cwd',
      'Generic CLI cwd must be an absolute path.'
    );
  }
  if (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== 'string')) {
    throw new GenericCliConfigurationErrorV1(
      'args',
      'Generic CLI args must be an array of strings.'
    );
  }
  const env = { ...config.env };
  if (Object.entries(env).some(([key, value]) => !key || typeof value !== 'string')) {
    throw new GenericCliConfigurationErrorV1(
      'env',
      'Generic CLI env must be a complete string-to-string mapping.'
    );
  }

  return {
    executable: config.executable,
    args: [...config.args],
    cwd: config.cwd,
    env,
    timeoutMs: positiveInteger(
      config.timeoutMs ?? GENERIC_CLI_DEFAULT_TIMEOUT_MS_V1,
      'timeoutMs'
    ),
    interruptGracePeriodMs: positiveInteger(
      config.interruptGracePeriodMs ??
        GENERIC_CLI_DEFAULT_INTERRUPT_GRACE_PERIOD_MS_V1,
      'interruptGracePeriodMs'
    ),
    maxStdoutBytes: positiveInteger(
      config.maxStdoutBytes ?? GENERIC_CLI_DEFAULT_MAX_STDOUT_BYTES_V1,
      'maxStdoutBytes'
    ),
    maxStderrBytes: positiveInteger(
      config.maxStderrBytes ?? GENERIC_CLI_DEFAULT_MAX_STDERR_BYTES_V1,
      'maxStderrBytes'
    ),
  };
}

function requireNonEmptyString(
  value: string,
  field: Extract<
    GenericCliConfigurationFieldV1,
    'executable' | 'cwd' | 'runtimeVersion'
  >
): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new GenericCliConfigurationErrorV1(
      field,
      `Generic CLI ${field} must be a non-empty string.`
    );
  }
}

function positiveInteger(
  value: number,
  field: Extract<
    GenericCliConfigurationFieldV1,
    | 'timeoutMs'
    | 'interruptGracePeriodMs'
    | 'maxStdoutBytes'
    | 'maxStderrBytes'
  >
): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GenericCliConfigurationErrorV1(
      field,
      `Generic CLI ${field} must be a positive safe integer.`
    );
  }
  return value;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value });
    } else {
      this.values.push(value);
    }
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ done: false, value });
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}
