import type { ExecutionDaemonStoreV1 } from './daemon';
import type { RuntimeEventV1 } from './driver';
import {
  parseStoredWorkspaceLifecycleV1,
  parseWorkspaceLifecycleV1,
  type FrozenKnowledgeBindingV1,
  type WorkspaceLifecycleV1,
  type WorkspaceRuntimeCompletionV1,
} from './workspace-lifecycle';

import { ConflictError } from '@/framework/resilience/app-error';
import {
  retrySqliteBusyV1,
  type SqliteBusyRetryOptionsV1,
} from '@/lib/db/sqlite-busy-retry';
import type { ContextManifestV1 } from '@/objects/execution-job/schema';

export type PrismaExecutionDaemonActorV1 = {
  organizationId: string;
};

export type PrismaExecutionDaemonCommandsV1 = {
  listClaimableExecutionAttempts: typeof import('@/objects/execution-job/worker-queries').listClaimableExecutionAttempts;
  claimExecutionAttempt: typeof import('@/objects/execution-job/worker-commands').claimExecutionAttempt;
  getExecutionJob: typeof import('@/objects/execution-job/queries').getExecutionJob;
  heartbeatExecutionAttempt: typeof import('@/objects/execution-job/worker-commands').heartbeatExecutionAttempt;
  appendExecutionEvent: typeof import('@/objects/execution-job/worker-events').appendExecutionEvent;
  completeExecutionAttempt: typeof import('@/objects/execution-job/worker-commands').completeExecutionAttempt;
  loadExecutionAttemptWorkspace: typeof import('@/objects/execution-job/worker-lifecycle').loadExecutionAttemptWorkspace;
  persistExecutionWorkspaceLifecycle: typeof import('@/objects/execution-job/worker-lifecycle').persistExecutionWorkspaceLifecycle;
  persistExecutionTerminalEvent: typeof import('@/objects/execution-job/worker-lifecycle').persistExecutionTerminalEvent;
  createKnowledgeChangeRequestForAttempt: typeof import('@/objects/knowledge/worker-commands').createKnowledgeChangeRequestForAttempt;
  quarantineExecutionWorkspaceRecovery: typeof import('@/objects/execution-recovery/commands').quarantineExecutionWorkspaceRecovery;
  getRequestedExecutionRecoveryAction: typeof import('@/objects/execution-recovery/queries').getRequestedExecutionRecoveryAction;
  resolveExecutionRecovery: typeof import('@/objects/execution-recovery/commands').resolveExecutionRecovery;
};

const PRISMA_EXECUTION_DAEMON_COMMANDS_V1: PrismaExecutionDaemonCommandsV1 = {
  async listClaimableExecutionAttempts(...args) {
    const { listClaimableExecutionAttempts } = await import(
      '@/objects/execution-job/worker-queries'
    );
    return listClaimableExecutionAttempts(...args);
  },
  async claimExecutionAttempt(...args) {
    const { claimExecutionAttempt } = await import(
      '@/objects/execution-job/worker-commands'
    );
    return claimExecutionAttempt(...args);
  },
  async getExecutionJob(...args) {
    const { getExecutionJob } = await import(
      '@/objects/execution-job/queries'
    );
    return getExecutionJob(...args);
  },
  async heartbeatExecutionAttempt(...args) {
    const { heartbeatExecutionAttempt } = await import(
      '@/objects/execution-job/worker-commands'
    );
    return heartbeatExecutionAttempt(...args);
  },
  async appendExecutionEvent(...args) {
    const { appendExecutionEvent } = await import(
      '@/objects/execution-job/worker-events'
    );
    return appendExecutionEvent(...args);
  },
  async completeExecutionAttempt(...args) {
    const { completeExecutionAttempt } = await import(
      '@/objects/execution-job/worker-commands'
    );
    return completeExecutionAttempt(...args);
  },
  async loadExecutionAttemptWorkspace(...args) {
    const { loadExecutionAttemptWorkspace } = await import(
      '@/objects/execution-job/worker-lifecycle'
    );
    return loadExecutionAttemptWorkspace(...args);
  },
  async persistExecutionWorkspaceLifecycle(...args) {
    const { persistExecutionWorkspaceLifecycle } = await import(
      '@/objects/execution-job/worker-lifecycle'
    );
    return persistExecutionWorkspaceLifecycle(...args);
  },
  async persistExecutionTerminalEvent(...args) {
    const { persistExecutionTerminalEvent } = await import(
      '@/objects/execution-job/worker-lifecycle'
    );
    return persistExecutionTerminalEvent(...args);
  },
  async createKnowledgeChangeRequestForAttempt(...args) {
    const { createKnowledgeChangeRequestForAttempt } = await import(
      '@/objects/knowledge/worker-commands'
    );
    return createKnowledgeChangeRequestForAttempt(...args);
  },
  async quarantineExecutionWorkspaceRecovery(...args) {
    const { quarantineExecutionWorkspaceRecovery } = await import(
      '@/objects/execution-recovery/commands'
    );
    return quarantineExecutionWorkspaceRecovery(...args);
  },
  async getRequestedExecutionRecoveryAction(...args) {
    const { getRequestedExecutionRecoveryAction } = await import(
      '@/objects/execution-recovery/queries'
    );
    return getRequestedExecutionRecoveryAction(...args);
  },
  async resolveExecutionRecovery(...args) {
    const { resolveExecutionRecovery } = await import(
      '@/objects/execution-recovery/commands'
    );
    return resolveExecutionRecovery(...args);
  },
};

export type PrismaDaemonKnowledgeWorkspaceV1 = {
  binding: FrozenKnowledgeBindingV1;
  repositoryPath: string;
};

export type PrismaExecutionDaemonClaimV1 = NonNullable<Awaited<
  ReturnType<ExecutionDaemonStoreV1['claim']>
>> & {
  attemptNumber: number;
  cancelRequested: boolean;
  knowledgeWorkspace: PrismaDaemonKnowledgeWorkspaceV1 | null;
  workspaceLifecycle: WorkspaceLifecycleV1 | null;
};

export type PersistPrismaDaemonWorkspaceLifecycleInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  lifecycle: WorkspaceLifecycleV1;
};

export type PersistPrismaDaemonTerminalEventInputV1 = {
  attemptId: string;
  workerId: string;
  generation: number;
  runtimeEventId: string;
  event: Extract<RuntimeEventV1, { type: 'attempt-completed' }>;
  runtimeCompletion: WorkspaceRuntimeCompletionV1;
  occurredAt: Date;
};

export type CreatePrismaDaemonKnowledgeChangeRequestInputV1 = Parameters<
  PrismaExecutionDaemonCommandsV1['createKnowledgeChangeRequestForAttempt']
>[1];

export interface PrismaExecutionDaemonWorkspaceStoreV1 {
  claim(
    input: Parameters<ExecutionDaemonStoreV1['claim']>[0]
  ): Promise<PrismaExecutionDaemonClaimV1 | null>;
  heartbeat(
    input: Parameters<ExecutionDaemonStoreV1['heartbeat']>[0]
  ): Promise<'renewed' | 'cancel-requested' | 'fenced'>;
  persistWorkspaceLifecycle(
    input: PersistPrismaDaemonWorkspaceLifecycleInputV1
  ): Promise<'persisted' | 'fenced'>;
  persistTerminalEvent(
    input: PersistPrismaDaemonTerminalEventInputV1
  ): Promise<'appended' | 'fenced'>;
  createKnowledgeChangeRequest(
    input: CreatePrismaDaemonKnowledgeChangeRequestInputV1
  ): Promise<
    Awaited<
      ReturnType<
        PrismaExecutionDaemonCommandsV1['createKnowledgeChangeRequestForAttempt']
      >
    > | 'fenced'
  >;
}

export type PrismaExecutionDaemonStoreV1 = Omit<
  ExecutionDaemonStoreV1,
  'claim' | 'heartbeat'
> &
  PrismaExecutionDaemonWorkspaceStoreV1;

/**
 * Organization-scoped adapter from the daemon's intentionally small store
 * contract to the durable worker commands. Only ConflictError represents an
 * expected claim race or generation/lease fence; all other failures propagate.
 */
export function createPrismaExecutionDaemonStore(
  actor: PrismaExecutionDaemonActorV1,
  commands: PrismaExecutionDaemonCommandsV1 =
    PRISMA_EXECUTION_DAEMON_COMMANDS_V1,
  retryOptions: SqliteBusyRetryOptionsV1 = {}
): PrismaExecutionDaemonStoreV1 {
  const organizationId = requireOrganizationId(actor.organizationId);
  const scopedActor = { organizationId };

  return {
    async listCandidates(input) {
      const attempts = await retrySqliteBusyV1(
        () => commands.listClaimableExecutionAttempts(scopedActor, input),
        retryOptions
      );
      return attempts.map((attempt) => {
        if (!attempt.runtimeId) {
          throw new Error(
            `Claimable execution attempt ${attempt.id} has no runtime id.`
          );
        }
        return { attemptId: attempt.id, runtimeId: attempt.runtimeId };
      });
    },

    async claim(input) {
      try {
        const attempt = await retrySqliteBusyV1(
          () => commands.claimExecutionAttempt(scopedActor, input),
          retryOptions
        );
        const job = await retrySqliteBusyV1(
          () => commands.getExecutionJob(scopedActor, attempt.jobId),
          retryOptions
        );
        if (!job) {
          throw new Error(
            `Claimed execution job ${attempt.jobId} could not be loaded.`
          );
        }
        if (!attempt.runtimeId) {
          throw new Error(
            `Claimed execution attempt ${attempt.id} has no runtime id.`
          );
        }
        if (attempt.runtimeId !== input.runtimeId) {
          throw new Error(
            `Claimed execution attempt ${attempt.id} changed runtime id.`
          );
        }
        const privateWorkspace = await retrySqliteBusyV1(
          () => commands.loadExecutionAttemptWorkspace(scopedActor, {
            attemptId: attempt.id,
            workerId: input.workerId,
            generation: attempt.generation,
          }),
          retryOptions
        );

        return {
          jobId: attempt.jobId,
          attemptId: attempt.id,
          runtimeId: attempt.runtimeId,
          generation: attempt.generation,
          attemptNumber: attempt.number,
          cancelRequested: attempt.cancelRequested === true,
          executionSpec: job.spec,
          contextManifest: job.contextManifest,
          knowledgeWorkspace: resolveClaimKnowledgeWorkspace(
            job.contextManifest,
            privateWorkspace.knowledgeWorkspace,
            attempt.id
          ),
          workspaceLifecycle: parseClaimWorkspaceLifecycle(
            privateWorkspace.workspaceLifecycleJson,
            attempt.id
          ),
          runtimeRunId: attempt.runtimeRunId,
          checkpointRef: readCheckpointRef(
            attempt.checkpoint,
            attempt.id
          ),
          humanInput: attempt.resumeInput
            ? {
                requestId: attempt.resumeInput.requestId,
                responseId: attempt.resumeInput.responseId,
                response: attempt.resumeInput.response,
              }
            : null,
        };
      } catch (error) {
        if (error instanceof ConflictError) {
          return null;
        }
        throw error;
      }
    },

    async heartbeat(input) {
      try {
        const attempt = await retrySqliteBusyV1(
          () => commands.heartbeatExecutionAttempt(scopedActor, {
            attemptId: input.attemptId,
            workerId: input.workerId,
            generation: input.generation,
            leaseDurationMs: input.leaseDurationMs,
            ...(input.checkpointRef === undefined
              ? {}
              : { checkpoint: input.checkpointRef }),
            ...(input.runtimeRunId === undefined
              ? {}
              : { runtimeRunId: input.runtimeRunId }),
          }),
          retryOptions
        );
        return attempt.cancelRequested === true
          ? 'cancel-requested'
          : 'renewed';
      } catch (error) {
        if (error instanceof ConflictError) {
          return 'fenced';
        }
        throw error;
      }
    },

    async appendEvent(input) {
      try {
        const result = await retrySqliteBusyV1(
          () => commands.appendExecutionEvent(scopedActor, input),
          retryOptions
        );
        return result.state;
      } catch (error) {
        if (isAttemptLeaseFence(error)) {
          return 'fenced';
        }
        throw error;
      }
    },

    async complete(input) {
      try {
        const privateWorkspace = await retrySqliteBusyV1(
          () => commands.loadExecutionAttemptWorkspace(scopedActor, {
            attemptId: input.attemptId,
            workerId: input.workerId,
            generation: input.generation,
            resolveKnowledgeWorkspace: false,
          }),
          retryOptions
        );
        const lifecycle = parseClaimWorkspaceLifecycle(
          privateWorkspace.workspaceLifecycleJson,
          input.attemptId
        );
        if (
          privateWorkspace.hasKnowledgeWorkspace &&
          ((lifecycle === null && input.status !== 'cancelled') ||
            (lifecycle !== null && lifecycle.cleanedAt === undefined))
        ) {
          throw new ConflictError(
            'Workspace lifecycle must be cleaned before attempt completion.'
          );
        }
        await retrySqliteBusyV1(
          () => commands.completeExecutionAttempt(scopedActor, input),
          retryOptions
        );
        return 'completed';
      } catch (error) {
        if (error instanceof ConflictError) {
          return 'fenced';
        }
        throw error;
      }
    },

    async persistWorkspaceLifecycle(input) {
      try {
        await retrySqliteBusyV1(
          () => commands.persistExecutionWorkspaceLifecycle(scopedActor, input),
          retryOptions
        );
        return 'persisted';
      } catch (error) {
        if (isAttemptLeaseFence(error)) {
          return 'fenced';
        }
        throw error;
      }
    },

    async persistTerminalEvent(input) {
      try {
        await retrySqliteBusyV1(
          () => commands.persistExecutionTerminalEvent(scopedActor, input),
          retryOptions
        );
        return 'appended';
      } catch (error) {
        if (isAttemptLeaseFence(error)) {
          return 'fenced';
        }
        throw error;
      }
    },

    async createKnowledgeChangeRequest(input) {
      try {
        return await retrySqliteBusyV1(
          () => commands.createKnowledgeChangeRequestForAttempt(scopedActor, input),
          retryOptions
        );
      } catch (error) {
        if (isAttemptLeaseFence(error)) {
          return 'fenced';
        }
        throw error;
      }
    },

    async quarantineWorkspaceRecovery(input) {
      try {
        await retrySqliteBusyV1(
          () => commands.quarantineExecutionWorkspaceRecovery(
            scopedActor,
            input
          ),
          retryOptions
        );
        return 'quarantined';
      } catch (error) {
        if (error instanceof ConflictError) return 'fenced';
        throw error;
      }
    },

    async getRequestedRecoveryAction(input) {
      try {
        if (!(await hasCurrentRecoveryLease(scopedActor, input))) {
          return 'fenced';
        }
        return await retrySqliteBusyV1(
          () => commands.getRequestedExecutionRecoveryAction(
            scopedActor,
            input.attemptId
          ),
          retryOptions
        );
      } catch (error) {
        if (error instanceof ConflictError) return 'fenced';
        throw error;
      }
    },

    async resolveRecoveryAction(input) {
      try {
        if (input.resolution === 'discarded') {
          return await retrySqliteBusyV1(
            () => resolveDiscardedRecoveryWithLeaseFence(
              scopedActor,
              input
            ),
            retryOptions
          );
        }
        if (!(await hasCurrentRecoveryLease(scopedActor, input))) {
          return 'fenced';
        }
        return await retrySqliteBusyV1(
          () => commands.resolveExecutionRecovery(scopedActor, {
            incidentId: input.incidentId,
            attemptId: input.attemptId,
            resolution: input.resolution,
          }),
          retryOptions
        );
      } catch (error) {
        if (error instanceof ConflictError) return 'fenced';
        throw error;
      }
    },
  };
}

async function hasCurrentRecoveryLease(
  actor: PrismaExecutionDaemonActorV1,
  input: { attemptId: string; workerId: string; generation: number }
): Promise<boolean> {
  const { getPrismaClient } = await import('@/lib/db/prisma');
  const now = new Date();
  const rows = await getPrismaClient().$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ExecutionAttempt"
    WHERE "id" = ${input.attemptId}
      AND "organizationId" = ${actor.organizationId}
      AND "status" = 'running'
      AND "generation" = ${input.generation}
      AND "leaseOwnerId" = ${input.workerId}
      AND "leaseExpiresAt" IS NOT NULL
      AND "leaseExpiresAt" > ${now}
      AND "capacityReserved" = TRUE
    LIMIT 1
  `;
  return rows.length === 1;
}

async function resolveDiscardedRecoveryWithLeaseFence(
  actor: PrismaExecutionDaemonActorV1,
  input: {
    incidentId: string;
    attemptId: string;
    workerId: string;
    generation: number;
  }
): Promise<'resolved' | 'fenced'> {
  const { getPrismaClient } = await import('@/lib/db/prisma');
  const now = new Date();
  try {
    return await getPrismaClient().$transaction(async (db) => {
      const reset = await db.$executeRaw`
        UPDATE "ExecutionAttempt"
        SET "workspaceLifecycleJson" = NULL,
          "runtimeRunId" = NULL, "checkpointJson" = NULL,
          "updatedAt" = ${now}
        WHERE "id" = ${input.attemptId}
          AND "organizationId" = ${actor.organizationId}
          AND "status" = 'running'
          AND "generation" = ${input.generation}
          AND "leaseOwnerId" = ${input.workerId}
          AND "leaseExpiresAt" IS NOT NULL
          AND "leaseExpiresAt" > ${now}
          AND "capacityReserved" = TRUE
          AND EXISTS (
            SELECT 1 FROM "ExecutionRecoveryIncident" AS incident
            WHERE incident."id" = ${input.incidentId}
              AND incident."attemptId" = "ExecutionAttempt"."id"
              AND incident."organizationId" = "ExecutionAttempt"."organizationId"
              AND incident."status" = 'action_requested'
              AND incident."requestedAction" = 'discard'
          )
      `;
      if (reset !== 1) throw new ConflictError(RECOVERY_LEASE_FENCE);
      const resolved = await db.$executeRaw`
        UPDATE "ExecutionRecoveryIncident"
        SET "status" = 'resolved', "resolution" = 'discarded',
          "resolvedAt" = ${now}, "revision" = "revision" + 1,
          "updatedAt" = ${now}
        WHERE "id" = ${input.incidentId}
          AND "attemptId" = ${input.attemptId}
          AND "organizationId" = ${actor.organizationId}
          AND "status" = 'action_requested'
          AND "requestedAction" = 'discard'
      `;
      if (resolved !== 1) throw new ConflictError(RECOVERY_LEASE_FENCE);
      return 'resolved' as const;
    });
  } catch (error) {
    if (error instanceof ConflictError) return 'fenced';
    throw error;
  }
}

const RECOVERY_LEASE_FENCE =
  'Execution recovery action was fenced by a stale attempt lease.';

function isAttemptLeaseFence(error: unknown): boolean {
  return (
    error instanceof ConflictError &&
    error.message ===
      'Execution attempt lease is stale, expired, or owned by another worker.'
  );
}

function requireOrganizationId(value: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('organizationId is required for the execution daemon.');
  }
  return value.trim();
}

function readCheckpointRef(
  value: unknown,
  attemptId: string
): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  throw new Error(
    `Execution attempt ${attemptId} has an invalid checkpoint reference.`
  );
}

function resolveClaimKnowledgeWorkspace(
  manifest: ContextManifestV1,
  privateWorkspace: PrismaDaemonKnowledgeWorkspaceV1 | null,
  attemptId: string
): PrismaDaemonKnowledgeWorkspaceV1 | null {
  const frozen = manifest.knowledgeCommit;
  if (frozen === null) {
    if (privateWorkspace !== null) {
      throw new Error(
        `Execution attempt ${attemptId} unexpectedly resolved a knowledge workspace.`
      );
    }
    return null;
  }
  if (privateWorkspace === null) {
    throw new ConflictError(
      'Knowledge binding is no longer authorized for this attempt.'
    );
  }
  const binding = parseWorkspaceLifecycleV1({
    schemaVersion: 1,
    kind: 'git-worktree',
    binding: privateWorkspace.binding,
    prepared: placeholderPrepared(privateWorkspace.binding),
  }).binding;
  if (!sameFrozenBinding(binding, frozen)) {
    throw new ConflictError(
      'Knowledge binding no longer matches the Job context manifest.'
    );
  }
  if (
    typeof privateWorkspace.repositoryPath !== 'string' ||
    !privateWorkspace.repositoryPath.trim()
  ) {
    throw new Error(
      `Execution attempt ${attemptId} has no trusted repository path.`
    );
  }
  return {
    binding,
    repositoryPath: privateWorkspace.repositoryPath,
  };
}

function sameFrozenBinding(
  left: FrozenKnowledgeBindingV1,
  right: FrozenKnowledgeBindingV1
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.bindingId === right.bindingId &&
    left.spaceId === right.spaceId &&
    left.workspaceId === right.workspaceId &&
    left.agentId === right.agentId &&
    left.mountPath === right.mountPath &&
    left.defaultBranch === right.defaultBranch &&
    left.baseCommit === right.baseCommit
  );
}

function parseClaimWorkspaceLifecycle(
  raw: string | null,
  attemptId: string
): WorkspaceLifecycleV1 | null {
  try {
    return parseStoredWorkspaceLifecycleV1(raw);
  } catch (error) {
    throw new Error(
      `Execution attempt ${attemptId} has an invalid workspace lifecycle.`,
      { cause: error }
    );
  }
}

function placeholderPrepared(binding: FrozenKnowledgeBindingV1) {
  return {
    schemaVersion: 1 as const,
    spaceId: binding.spaceId,
    mountPath: '/' as const,
    repositoryPath: '/private-binding-validation/repository',
    worktreePath: '/private-binding-validation/worktree',
    defaultBranch: binding.defaultBranch,
    branch: 'private-binding-validation',
    baseCommit: binding.baseCommit,
    jobId: 'private-binding-validation-job',
    attemptId: 'private-binding-validation-attempt',
    attemptNumber: 1,
    ...(binding.agentId === null ? {} : { agentId: binding.agentId }),
  };
}
