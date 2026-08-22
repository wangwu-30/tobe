import { setTimeout as wait } from 'node:timers/promises';

import {
  claimKnowledgeMergeOperation,
  heartbeatKnowledgeMergeOperation,
  listClaimableKnowledgeMergeOperationIds,
  publishKnowledgeIndexSnapshot,
  recordKnowledgeGitMerge,
  recordKnowledgeMergeConflict,
  recordKnowledgeMergeFailure,
  type KnowledgeMergeClaimV1,
  type KnowledgeMergeWorkerActor,
} from '@/objects/knowledge/merge-worker-commands';

import type { KnowledgeIndexBuilderPortV1 } from './index-builder';
import { TrustedKnowledgeGitError, type TrustedKnowledgeGitPortV1 } from './trusted-merge';

export type TrustedKnowledgeMergeWorkerDependenciesV1 = {
  git: TrustedKnowledgeGitPortV1;
  indexBuilder: KnowledgeIndexBuilderPortV1;
  listCandidates?: typeof listClaimableKnowledgeMergeOperationIds;
  claim?: typeof claimKnowledgeMergeOperation;
  heartbeat?: typeof heartbeatKnowledgeMergeOperation;
  recordGitMerge?: typeof recordKnowledgeGitMerge;
  recordConflict?: typeof recordKnowledgeMergeConflict;
  recordFailure?: typeof recordKnowledgeMergeFailure;
  publishSnapshot?: typeof publishKnowledgeIndexSnapshot;
};

export type TrustedKnowledgeMergeWorkerOptionsV1 = {
  organizationId: string;
  workerId: string;
  leaseDurationMs?: number;
  batchSize?: number;
  maxAttempts?: number;
};

export type KnowledgeMergeProcessResultV1 =
  | { operationId: string; status: 'succeeded' }
  | { operationId: string; status: 'conflicted' | 'failed' | 'unhandled'; code: string };

/**
 * Runs privileged merge work outside the HTTP and agent runtimes. The only
 * public request-side mutation is queueing an operation; this worker alone
 * receives repository paths and can advance the default ref.
 */
export class TrustedKnowledgeMergeWorkerV1 {
  private readonly actor: KnowledgeMergeWorkerActor;
  private readonly workerId: string;
  private readonly leaseDurationMs?: number;
  private readonly batchSize?: number;
  private readonly maxAttempts: number;
  private readonly dependencies: Required<TrustedKnowledgeMergeWorkerDependenciesV1>;

  constructor(
    options: TrustedKnowledgeMergeWorkerOptionsV1,
    dependencies: TrustedKnowledgeMergeWorkerDependenciesV1
  ) {
    this.actor = {
      organizationId: requireText(options.organizationId, 'organizationId'),
      authority: 'knowledge-merge-service',
    };
    this.workerId = requireText(options.workerId, 'workerId');
    this.leaseDurationMs = options.leaseDurationMs;
    this.batchSize = options.batchSize;
    this.maxAttempts = positiveInteger(options.maxAttempts ?? 3, 'maxAttempts');
    this.dependencies = {
      ...dependencies,
      listCandidates: dependencies.listCandidates ?? listClaimableKnowledgeMergeOperationIds,
      claim: dependencies.claim ?? claimKnowledgeMergeOperation,
      heartbeat: dependencies.heartbeat ?? heartbeatKnowledgeMergeOperation,
      recordGitMerge: dependencies.recordGitMerge ?? recordKnowledgeGitMerge,
      recordConflict: dependencies.recordConflict ?? recordKnowledgeMergeConflict,
      recordFailure: dependencies.recordFailure ?? recordKnowledgeMergeFailure,
      publishSnapshot: dependencies.publishSnapshot ?? publishKnowledgeIndexSnapshot,
    };
  }

  async runOnce(): Promise<KnowledgeMergeProcessResultV1[]> {
    const ids = await this.dependencies.listCandidates(this.actor, {
      limit: this.batchSize,
      maxAttempts: this.maxAttempts,
    });
    const results: KnowledgeMergeProcessResultV1[] = [];
    for (const operationId of ids) {
      try {
        results.push(await this.process(operationId, true));
      } catch (error) {
        results.push({
          operationId,
          status: 'unhandled',
          code: errorCode(error),
        });
      }
    }
    return results;
  }

  async retryFailed(operationId: string): Promise<KnowledgeMergeProcessResultV1> {
    return this.process(operationId, true);
  }

  private async process(
    operationId: string,
    allowFailedRetry = false
  ): Promise<KnowledgeMergeProcessResultV1> {
    const claim = await this.dependencies.claim(this.actor, {
      operationId,
      workerId: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
      allowFailedRetry,
    });
    const lease = {
      operationId,
      workerId: this.workerId,
      attemptCount: claim.operation.attemptCount,
    };

    if (!isApprovedRevisionOrReplay(claim)) {
      await this.dependencies.recordConflict(this.actor, {
        ...lease,
        code: 'approved-revision-changed',
        message: 'The approved change request revision no longer matches the queued merge.',
      });
      return { operationId, status: 'conflicted', code: 'approved-revision-changed' };
    }

    try {
      if (claim.operation.mergedCommit !== claim.operation.expectedHeadCommit) {
        const merged = await this.withLeaseHeartbeat(lease, () =>
          this.dependencies.git.merge({
            repositoryPath: claim.repositoryPath,
            defaultBranch: claim.defaultBranch,
            proposalBranch: claim.changeRequest.branchName,
            baseCommit: claim.operation.expectedBaseCommit,
            headCommit: claim.operation.expectedHeadCommit,
            expectedPatchSha256: claim.expectedPatchSha256,
          })
        );
        await this.dependencies.recordGitMerge(this.actor, {
          ...lease,
          mergedCommit: merged.mergedCommit,
        });
      }

      const artifact = await this.withLeaseHeartbeat(lease, () =>
        this.dependencies.indexBuilder.build({
          repositoryPath: claim.repositoryPath,
          spaceId: claim.changeRequest.spaceId,
          commitSha: claim.operation.expectedHeadCommit,
          indexVersion: claim.operation.indexVersion,
        })
      );
      await this.dependencies.publishSnapshot(this.actor, {
        ...lease,
        artifactPath: artifact.artifactPath,
        artifactSha256: artifact.artifactSha256,
        readyAt: artifact.readyAt,
      });
      return { operationId, status: 'succeeded' };
    } catch (error) {
      if (error instanceof TrustedKnowledgeGitError && error.conflict) {
        await this.dependencies.recordConflict(this.actor, {
          ...lease,
          code: error.code,
          message: error.message,
        });
        return { operationId, status: 'conflicted', code: error.code };
      }
      const code = errorCode(error);
      await this.dependencies.recordFailure(this.actor, {
        ...lease,
        code,
        message: safeMessage(error),
      });
      return { operationId, status: 'failed', code };
    }
  }

  private async withLeaseHeartbeat<T>(
    lease: { operationId: string; workerId: string; attemptCount: number },
    action: () => Promise<T>
  ): Promise<T> {
    const controller = new AbortController();
    const heartbeat = this.heartbeatLoop(lease, controller.signal)
      .then(() => null)
      .catch((error: unknown) => error);
    let result: T;
    let actionError: unknown;
    try {
      result = await action();
    } catch (error) {
      actionError = error;
    } finally {
      controller.abort();
    }
    const heartbeatError = await heartbeat;
    if (actionError !== undefined) throw actionError;
    if (heartbeatError !== null) throw heartbeatError;
    return result!;
  }

  private async heartbeatLoop(
    lease: { operationId: string; workerId: string; attemptCount: number },
    signal: AbortSignal
  ): Promise<void> {
    const leaseDurationMs = this.leaseDurationMs ?? 30_000;
    const heartbeatIntervalMs = Math.max(100, Math.floor(leaseDurationMs / 3));
    while (!signal.aborted) {
      try {
        await wait(heartbeatIntervalMs, undefined, { signal });
      } catch (error) {
        if (signal.aborted) return;
        throw error;
      }
      if (signal.aborted) return;
      await this.dependencies.heartbeat(this.actor, {
        ...lease,
        leaseDurationMs,
      });
    }
  }
}

function isApprovedRevisionOrReplay(claim: KnowledgeMergeClaimV1): boolean {
  const change = claim.changeRequest;
  const operation = claim.operation;
  return (
    (change.status === 'approved' &&
      change.revision === operation.expectedRevision &&
      change.baseCommit === operation.expectedBaseCommit &&
      change.headCommit === operation.expectedHeadCommit) ||
    (change.status === 'merged' &&
      change.revision === operation.expectedRevision + 1 &&
      change.mergedCommit === operation.expectedHeadCommit)
  );
}

function errorCode(error: unknown): string {
  if (
    error && typeof error === 'object' && 'code' in error &&
    typeof error.code === 'string' && error.code.trim()
  ) {
    return error.code.slice(0, 120);
  }
  return 'merge-worker-failed';
}

function safeMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.slice(0, 1_000)
    : 'Trusted knowledge merge failed.';
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value as number;
}
