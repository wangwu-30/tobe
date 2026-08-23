import type { RuntimeDescriptorV1 } from '../contracts';
import type {
  ExecutionRuntimeDriverV1,
  RuntimeArchiveAttemptV1,
  RuntimeArtifactRefV1,
  RuntimeEventV1,
  RuntimeInterruptAttemptV1,
  RuntimeReconcileAttemptV1,
  RuntimeResumeAttemptV1,
  RuntimeSnapshotV1,
  RuntimeStartAttemptV1,
} from '../driver';

export const GIT_WORKTREE_WORKSPACE_REQUIRED_MESSAGE_V1 =
  'git-worktree/workspace-required';

export class GitWorktreeWorkspaceRequiredErrorV1 extends Error {
  readonly code = GIT_WORKTREE_WORKSPACE_REQUIRED_MESSAGE_V1;

  constructor() {
    super(
      'A trusted workspace is required by the git-worktree runtime wrapper.'
    );
    this.name = 'GitWorktreeWorkspaceRequiredErrorV1';
  }
}

/**
 * Capability decorator for a driver whose workspace lifecycle is supplied by
 * the trusted deployment composition root.
 *
 * This wrapper does not create or remove a worktree. It advertises the
 * stronger contract only when composition has enabled that deployment
 * capability, requires a trusted workspace reference on start, and otherwise
 * delegates lifecycle behavior unchanged.
 */
export class GitWorktreeExecutionRuntimeDriverV1
  implements ExecutionRuntimeDriverV1
{
  readonly resume?: (
    input: RuntimeResumeAttemptV1
  ) => AsyncIterable<RuntimeEventV1>;

  constructor(private readonly inner: ExecutionRuntimeDriverV1) {
    this.resume = inner.resume
      ? (input) => inner.resume!(input)
      : undefined;
  }

  async describe(): Promise<RuntimeDescriptorV1> {
    const descriptor = await this.inner.describe();
    return {
      ...descriptor,
      capabilities: {
        ...descriptor.capabilities,
        workspace: 'git-worktree',
      },
    };
  }

  start(input: RuntimeStartAttemptV1): AsyncIterable<RuntimeEventV1> {
    if (!input.workspace) {
      throw new GitWorktreeWorkspaceRequiredErrorV1();
    }
    return this.inner.start(input);
  }

  interrupt(input: RuntimeInterruptAttemptV1): Promise<void> {
    return this.inner.interrupt(input);
  }

  reconcile(
    input: RuntimeReconcileAttemptV1
  ): Promise<RuntimeSnapshotV1> {
    return this.inner.reconcile(input);
  }

  archive(
    input: RuntimeArchiveAttemptV1
  ): Promise<readonly RuntimeArtifactRefV1[]> {
    return this.inner.archive(input);
  }
}
