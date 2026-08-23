import type {
  ExecutionSpecV1,
  RuntimeDescriptorV1,
} from './contracts';

export type RuntimeAttemptRefV1 = {
  jobId: string;
  attemptId: string;
  generation: number;
};

export type RuntimeArtifactRefV1 = {
  artifactId: string;
  kind: string;
  mediaType?: string;
  uri: string;
};

/**
 * A workspace location resolved by the trusted control plane. Runtime drivers
 * must reject other URI schemes instead of interpreting job-provided paths.
 */
export type RuntimeWorkspaceRefV1 = {
  /** Validated as a hostless local `file:` URL by the consuming driver. */
  uri: string;
  /** Immutable base commit SHA when the workspace is backed by Git. */
  revision?: string;
};

export type RuntimeStartAttemptV1 = RuntimeAttemptRefV1 & {
  executionSpec: ExecutionSpecV1;
  contextManifest: unknown;
  workspace?: RuntimeWorkspaceRefV1;
};

export type RuntimeHumanInputValueV1 =
  | boolean
  | number
  | string
  | null
  | readonly RuntimeHumanInputValueV1[]
  | { readonly [key: string]: RuntimeHumanInputValueV1 };

/** Immutable receipt for one accepted human answer. */
export type RuntimeHumanInputV1 = {
  requestId: string;
  responseId: string;
  response: RuntimeHumanInputValueV1;
};

export type RuntimeResumeAttemptV1 = RuntimeAttemptRefV1 & {
  runtimeAttemptId: string;
  checkpointRef?: string;
  humanInput?: RuntimeHumanInputV1;
};

export type RuntimeInterruptAttemptV1 = RuntimeAttemptRefV1 & {
  runtimeAttemptId: string;
  reason?: string;
};

export type RuntimeReconcileAttemptV1 = RuntimeAttemptRefV1 & {
  runtimeAttemptId: string;
};

export type RuntimeArchiveAttemptV1 = RuntimeAttemptRefV1 & {
  runtimeAttemptId: string;
};

export type RuntimeAttemptStatusV1 =
  | 'starting'
  | 'running'
  | 'waiting-for-human'
  | 'succeeded'
  | 'failed'
  | 'interrupted'
  | 'unknown';

export type RuntimeEventV1 =
  | {
      type: 'attempt-started';
      runtimeAttemptId: string;
    }
  | {
      type: 'text-delta';
      text: string;
    }
  | {
      type: 'progress';
      message: string;
      percent?: number;
    }
  | {
      type: 'checkpoint';
      checkpointRef: string;
    }
  | {
      type: 'artifact';
      artifact: RuntimeArtifactRefV1;
    }
  | {
      type: 'waiting-for-human';
      requestId: string;
      prompt: string;
    }
  | {
      type: 'attempt-completed';
      status: Extract<
        RuntimeAttemptStatusV1,
        'succeeded' | 'failed' | 'interrupted'
      >;
      message?: string;
    };

export type RuntimeSnapshotV1 = {
  runtimeAttemptId: string;
  status: RuntimeAttemptStatusV1;
  checkpointRef?: string;
  message?: string;
};

/**
 * Adapter boundary implemented by OpenHands, CLI runners, workflow engines,
 * and future custom runtimes.
 *
 * The driver reports runtime facts and events. It must not mutate control-plane
 * job or attempt state directly.
 */
export interface ExecutionRuntimeDriverV1 {
  describe(): Promise<RuntimeDescriptorV1>;

  start(input: RuntimeStartAttemptV1): AsyncIterable<RuntimeEventV1>;

  resume?(
    input: RuntimeResumeAttemptV1
  ): AsyncIterable<RuntimeEventV1>;

  interrupt(input: RuntimeInterruptAttemptV1): Promise<void>;

  reconcile(
    input: RuntimeReconcileAttemptV1
  ): Promise<RuntimeSnapshotV1>;

  archive(
    input: RuntimeArchiveAttemptV1
  ): Promise<readonly RuntimeArtifactRefV1[]>;
}
