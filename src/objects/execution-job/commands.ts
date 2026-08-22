import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma/client';

import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { isRecord, safeJsonParse } from '@/framework/resilience/safe-data';
import {
  type ExecutionSpecV1,
  type RuntimeSelectionStrategyV1,
} from '@/agent/execution';
import type { GitKnowledgeBaseResolver } from '@/agent/knowledge/contracts';
import { prisma } from '@/lib/db/prisma';
import { retrySqliteBusyV1 } from '@/lib/db/sqlite-busy-retry';
import {
  IdempotencyConflictError,
  IdempotencyInProgressError,
  withAtomicIdempotency,
} from '@/lib/platform/idempotency';
import {
  getExecutionRuntimeSelectionContextV1,
  type ExecutionRuntimeSelectionContextV1,
} from '@/objects/execution-runtime';
import { parseVersionFiles } from '@/objects/file/schema';
// Keep the execution admission boundary dependent on the pure state contract.
// Importing the state barrel also loads its Prisma-backed command module, which
// makes this domain service unusable in isolated workers and contract tests.
import { deriveWorkspaceStateSemantics } from '@/objects/state/schema';
import {
  matchKnowledgeAdmissionRuntimeV1,
  resolveKnowledgeAdmissionAgentIdV1,
  resolveKnowledgeAdmissionV1,
  selectKnowledgeAdmissionCandidateV1,
} from '@/objects/knowledge/admission';

import { getExecutionJob, type ExecutionJobActor } from './queries';
import {
  enqueueExecutionRoomProjection,
  projectExecutionStartToTeamTask,
  projectExecutionTerminalToTeamTask,
} from './room-projection';
import {
  EXECUTION_JOB_CONTRACT_VERSION_V1,
  isTerminalExecutionJobStatus,
  parseExecutionJobReceiptV1,
  parseExecutionSpecV1,
  type ContextManifestV1,
  type ExecutionJobSpecV1,
  type ExecutionJobDtoV1,
  type ExecutionJobReceiptV1,
} from './schema';

export const EXECUTION_JOB_IDEMPOTENCY_HEADER = 'x-dao-idempotency-key';

export type CreateExecutionJobInput = {
  goal: string;
  workspaceId: string;
  projectId?: string | null;
  documentVersionId?: string | null;
  conversationId?: string | null;
  spec: Omit<ExecutionSpecV1, 'goal'> & { goal?: string };
  strategy?: RuntimeSelectionStrategyV1;
  teamTaskId?: string | null;
  priority?: number;
  maxAttempts?: number;
  deadlineAt?: Date | string | null;
};

export type CreateExecutionJobOptions = {
  idempotencyKey?: string | null;
  trustedAgentId?: string | null;
  originRoomId?: string | null;
  originRoomMessageId?: string | null;
  baseCommitResolver?: Pick<GitKnowledgeBaseResolver, 'resolve'>;
};

type MaterializeContextManifestInputV1 = {
  conversationId: string | null;
  documentVersionId: string | null;
  goal: string;
  projectId: string | null;
  teamTaskId: string | null;
  trustedAgentId: string | null;
  workspaceId: string;
};

type MaterializedContextManifestV1 = {
  contextManifest: ContextManifestV1;
  resolvedAgentId: string | null;
  knowledgeRepository: {
    defaultBranch: string;
    repoPath: string;
  } | null;
  knowledgeSnapshot: {
    activeSnapshotId: string;
    commitSha: string;
    organizationId: string;
    readyAt: string;
    spaceId: string;
  } | null;
};

type ExecutionAdmissionDbV1 = Pick<
  Prisma.TransactionClient,
  'document' | 'room' | 'roomMessage' | 'session' | 'teamTask' | 'version' | '$queryRaw'
>;

export type CancelExecutionJobInput = {
  expectedRevision: number;
};

export async function createExecutionJob(
  actor: ExecutionJobActor,
  input: CreateExecutionJobInput,
  options: CreateExecutionJobOptions = {}
): Promise<ExecutionJobReceiptV1> {
  const goal = requiredText(input.goal, 'goal is required.');
  const workspaceId = requiredText(
    input.workspaceId,
    'workspaceId is required.'
  );
  if (input.spec.goal !== undefined && input.spec.goal.trim() !== goal) {
    throw new ValidationError('spec.goal must match the top-level goal.');
  }
  const spec = parseExecutionSpecV1({ ...input.spec, goal });
  const strategy = parseSelectionStrategy(input.strategy);
  const teamTaskId = nullableText(input.teamTaskId);
  const priority = parsePriority(input.priority);
  const maxAttempts = parseMaxAttempts(input.maxAttempts);
  const deadlineAt = parseDeadline(input.deadlineAt);
  const projectId = nullableText(input.projectId);
  const documentVersionId = nullableText(input.documentVersionId);
  if (!documentVersionId) {
    throw new ValidationError(
      'documentVersionId is required. Execution must use an aligned immutable document version.'
    );
  }
  const conversationId = nullableText(input.conversationId);
  const trustedAgentId = nullableText(options.trustedAgentId);
  const originRoomId = nullableText(options.originRoomId);
  const originRoomMessageId = nullableText(options.originRoomMessageId);
  if (Boolean(originRoomId) !== Boolean(originRoomMessageId)) {
    throw new ValidationError(
      'originRoomId and originRoomMessageId must be provided together.'
    );
  }

  const normalized = {
    conversationId,
    deadlineAt: deadlineAt?.toISOString() || null,
    documentVersionId,
    goal,
    maxAttempts,
    originRoomId,
    originRoomMessageId,
    priority,
    projectId,
    spec,
    strategy,
    teamTaskId,
    trustedAgentId,
    workspaceId,
  };
  const runtimeSelectionContext = await retrySqliteBusyV1(() =>
    getExecutionRuntimeSelectionContextV1(actor)
  );
  const requestHash = stableJsonStringify(normalized);
  const completedReceipt = await retrySqliteBusyV1(() =>
    readCompletedExecutionJobReceiptV1(
      actor,
      options.idempotencyKey,
      requestHash
    )
  );
  if (completedReceipt) return completedReceipt;
  const manifestMaterialization = await retrySqliteBusyV1(() =>
    materializeContextManifestV1(
      prisma,
      actor,
      normalized,
      options.baseCommitResolver
    )
  );

  try {
    return await retrySqliteBusyV1(() => withAtomicIdempotency({
      action: (db) =>
        createExecutionJobOnce(
          db,
          actor,
          normalized,
          runtimeSelectionContext,
          manifestMaterialization
        ),
      key: options.idempotencyKey,
      operation: 'execution-job:create:v1',
      organizationId: actor.organizationId,
      requestHash,
      resource: (receipt) => ({
        resourceId: receipt.jobId,
        resourceType: 'execution-job',
      }),
      userId: actor.userId,
    }));
  } catch (error) {
    if (error instanceof IdempotencyInProgressError) {
      throw new ConflictError('This execution job request is still in progress.');
    }
    throw error;
  }
}

async function readCompletedExecutionJobReceiptV1(
  actor: Pick<ExecutionJobActor, 'organizationId' | 'userId'>,
  idempotencyKey: string | null | undefined,
  requestHash: string
): Promise<ExecutionJobReceiptV1 | null> {
  const requestKey = idempotencyKey?.trim();
  if (!requestKey) return null;
  const rows = await prisma.$queryRaw<Array<{
    requestHash: string;
    responseJson: string | null;
    status: string;
  }>>`
    SELECT "requestHash", "responseJson", "status"
    FROM "MutationRequest"
    WHERE "organizationId" = ${actor.organizationId}
      AND "userId" = ${actor.userId}
      AND "operation" = 'execution-job:create:v1'
      AND "requestKey" = ${requestKey}
    LIMIT 1
  `;
  const existing = rows[0];
  if (!existing) return null;
  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflictError();
  }
  if (existing.status !== 'completed' || !existing.responseJson) return null;
  const invalidReceipt = Symbol('invalid-execution-job-receipt');
  const parsed = safeJsonParse<unknown | typeof invalidReceipt>(
    existing.responseJson,
    invalidReceipt
  );
  if (parsed === invalidReceipt) {
    throw new Error('Stored mutation response could not be parsed.');
  }
  try {
    return parseExecutionJobReceiptV1(parsed);
  } catch (cause) {
    throw new Error('Stored mutation response is not a valid execution job receipt.', {
      cause,
    });
  }
}

export async function cancelExecutionJob(
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  jobId: string,
  input: CancelExecutionJobInput
): Promise<ExecutionJobDtoV1> {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) {
    throw new ValidationError('expectedRevision must be a positive integer.');
  }

  const existing = await retrySqliteBusyV1(() =>
    getExecutionJob(actor, jobId)
  );
  if (!existing) {
    throw new NotFoundError('Execution job not found.');
  }
  if (existing.status === 'cancelled') {
    return existing;
  }
  if (
    existing.status === 'cancel_requested' &&
    (existing.revision === input.expectedRevision ||
      existing.revision === input.expectedRevision + 1)
  ) {
    return existing;
  }
  if (existing.revision !== input.expectedRevision) {
    throw new ConflictError('Execution job changed while cancellation was requested.');
  }
  if (isTerminalExecutionJobStatus(existing.status)) {
    throw new ConflictError(`A ${existing.status} execution job cannot be cancelled.`);
  }

  const now = new Date();
  const changed = await retrySqliteBusyV1(() => prisma.$transaction(async (db) => {
    const requestedStatus =
      existing.status === 'running' || existing.status === 'waiting_input'
        ? 'cancel_requested'
        : 'cancelled';
    const updated = await db.$executeRaw`
      UPDATE "ExecutionJob"
      SET
        "status" = ${requestedStatus},
        "cancelRequestedAt" = ${now},
        "finishedAt" = CASE
          WHEN ${requestedStatus} = 'cancelled' THEN ${now}
          ELSE NULL
        END,
        "revision" = "revision" + 1,
        "updatedAt" = ${now}
      WHERE "id" = ${jobId}
        AND "organizationId" = ${actor.organizationId}
        AND "revision" = ${input.expectedRevision}
        AND "status" = ${existing.status}
    `;

    if (updated !== 1) {
      return false;
    }

    if (existing.status === 'waiting_input') {
      await db.$executeRaw`
        UPDATE "ExecutionInputRequest"
        SET
          "status" = 'cancelled',
          "revision" = "revision" + 1,
          "updatedAt" = ${now}
        WHERE "jobId" = ${jobId}
          AND "organizationId" = ${actor.organizationId}
          AND "status" = 'pending'
      `;
    }

    if (requestedStatus === 'cancelled') {
      await db.$executeRaw`
        UPDATE "ExecutionAttempt"
        SET
          "status" = 'cancelled',
          "leaseOwnerId" = NULL,
          "leaseExpiresAt" = NULL,
          "finishedAt" = ${now},
          "updatedAt" = ${now}
        WHERE "jobId" = ${jobId}
          AND "organizationId" = ${actor.organizationId}
          AND "status" IN ('pending', 'waiting_input')
      `;
      await enqueueExecutionRoomProjection(db, {
        organizationId: actor.organizationId,
        jobId,
        type: 'execution.completed',
        occurredAt: now,
      });
      await projectExecutionTerminalToTeamTask(db, {
        organizationId: actor.organizationId,
        jobId,
        occurredAt: now,
      });
    }

    return true;
  }));

  if (!changed) {
    const latest = await retrySqliteBusyV1(() =>
      getExecutionJob(actor, jobId)
    );
    if (
      latest?.status === 'cancelled' ||
      (latest?.status === 'cancel_requested' &&
        latest.revision === input.expectedRevision + 1)
    ) {
      return latest;
    }
    throw new ConflictError('Execution job changed while cancellation was requested.');
  }

  const updated = await retrySqliteBusyV1(() =>
    getExecutionJob(actor, jobId)
  );
  if (!updated) {
    throw new NotFoundError('Execution job not found.');
  }
  return updated;
}

async function createExecutionJobOnce(
  db: Prisma.TransactionClient,
  actor: ExecutionJobActor,
  input: {
    conversationId: string | null;
    deadlineAt: string | null;
    documentVersionId: string | null;
    goal: string;
    maxAttempts: number;
    originRoomId: string | null;
    originRoomMessageId: string | null;
    priority: number;
    projectId: string | null;
    spec: ExecutionSpecV1;
    strategy: RuntimeSelectionStrategyV1;
    teamTaskId: string | null;
    trustedAgentId: string | null;
    workspaceId: string;
  },
  runtimeSelectionContext: ExecutionRuntimeSelectionContextV1,
  manifestMaterialization: MaterializedContextManifestV1
): Promise<ExecutionJobReceiptV1> {
  await validateExecutionOrigin(db, actor.organizationId, {
    roomId: input.originRoomId,
    messageId: input.originRoomMessageId,
  });
  const persistedSpec: ExecutionJobSpecV1 = input.spec;
  const revalidatedMaterialization = await materializeContextManifestV1(
    db,
    actor,
    input,
    undefined,
    manifestMaterialization
  );
  const selection = matchKnowledgeAdmissionRuntimeV1({
    execution: input.spec,
    strategy: input.strategy,
    organizationPolicy: runtimeSelectionContext.organizationPolicy,
    candidates: runtimeSelectionContext.candidates,
    knowledgeCommit: revalidatedMaterialization.contextManifest.knowledgeCommit,
  });
  const selectedRuntimeId = selection.matched
    ? selection.selected.descriptor.runtimeId
    : null;
  const explicitRuntimeId =
    input.strategy.mode === 'explicit' ? input.strategy.runtimeId : null;
  const requestedRuntimeId =
    explicitRuntimeId &&
    runtimeSelectionContext.candidates.some(
      ({ descriptor }) => descriptor.runtimeId === explicitRuntimeId
    )
      ? explicitRuntimeId
      : null;
  const status = selection.matched ? 'queued' : 'blocked';
  const selectionReason = selection.matched
    ? selection.selectedBy
    : selection.failure.code;
  const jobId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const now = new Date();
  const specJson = JSON.stringify(persistedSpec);
  const requirementsJson = JSON.stringify(input.spec.requirements);
  const selectionJson = JSON.stringify(selection);
  const errorJson = selection.matched ? null : JSON.stringify(selection.failure);
  const deadlineAt = input.deadlineAt ? new Date(input.deadlineAt) : null;

  const contextManifestJson = JSON.stringify(
    revalidatedMaterialization.contextManifest
  );

  await db.$executeRaw`
    INSERT INTO "ExecutionJob" (
      "id", "organizationId", "teamTaskId",
      "originRoomId", "originRoomMessageId", "kind", "status",
      "priority", "specJson", "requirementsJson",
      "contextManifestJson", "selectionJson", "requestedRuntimeId",
      "selectedRuntimeId", "selectionReason", "selectedAt",
      "maxAttempts", "deadlineAt", "queuedAt", "errorJson",
      "revision", "createdAt", "updatedAt"
    ) VALUES (
      ${jobId}, ${actor.organizationId}, ${input.teamTaskId},
      ${input.originRoomId}, ${input.originRoomMessageId}, ${input.spec.kind},
      ${status}, ${input.priority}, ${specJson}, ${requirementsJson},
      ${contextManifestJson}, ${selectionJson}, ${requestedRuntimeId},
      ${selectedRuntimeId}, ${selectionReason},
      ${selection.matched ? now : null}, ${input.maxAttempts}, ${deadlineAt},
      ${now}, ${errorJson}, 1, ${now}, ${now}
    )
  `;

  if (selection.matched && selectedRuntimeId) {
    await db.$executeRaw`
      INSERT INTO "ExecutionAttempt" (
        "id", "organizationId", "jobId", "runtimeId", "number",
        "status", "generation", "createdAt", "updatedAt"
      ) VALUES (
        ${attemptId}, ${actor.organizationId}, ${jobId}, ${selectedRuntimeId}, 1,
        'pending', 0, ${now}, ${now}
      )
    `;
    await projectExecutionStartToTeamTask(db, {
      organizationId: actor.organizationId,
      jobId,
      occurredAt: now,
    });
  }

  return {
    schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
    jobId,
    teamTaskId: input.teamTaskId,
    status,
    revision: 1,
    selectedRuntimeId,
    selection,
    acceptedAt: now.toISOString(),
  };
}

async function validateExecutionOrigin(
  db: Prisma.TransactionClient,
  organizationId: string,
  origin: { roomId: string | null; messageId: string | null }
) {
  if (!origin.roomId && !origin.messageId) return;
  if (!origin.roomId || !origin.messageId) {
    throw new ValidationError(
      'originRoomId and originRoomMessageId must be provided together.'
    );
  }
  const message = await db.roomMessage.findFirst({
    where: {
      id: origin.messageId,
      organizationId,
      roomId: origin.roomId,
      room: { organizationId },
    },
    select: { id: true },
  });
  if (!message) {
    throw new ValidationError(
      'Execution origin message must belong to the origin Room and organization.'
    );
  }
}

async function materializeContextManifestV1(
  db: ExecutionAdmissionDbV1,
  actor: Pick<ExecutionJobActor, 'organizationId'>,
  input: MaterializeContextManifestInputV1,
  baseCommitResolver: Pick<GitKnowledgeBaseResolver, 'resolve'> | undefined,
  expected?: MaterializedContextManifestV1
): Promise<MaterializedContextManifestV1> {
  const workspace = await db.document.findFirst({
    where: {
        id: input.workspaceId,
        organizationId: actor.organizationId,
        deletedAt: null,
      },
      select: {
        id: true,
        projectId: true,
        sessionId: true,
        title: true,
        content: true,
        draftRevision: true,
        revision: true,
      },
    });
    if (!workspace) {
      throw new ValidationError(
        'Workspace must belong to the current organization.'
      );
    }

    if (
      input.projectId !== null &&
      input.projectId !== workspace.projectId
    ) {
      throw new ValidationError(
        'projectId must match the workspace project scope.'
      );
    }

    const projectScopeId = workspace.projectId || workspace.id;
    const [version, conversation, teamTask, projectRoom] = await Promise.all([
      db.version.findFirst({
        where: {
          id: input.documentVersionId!,
          documentId: workspace.id,
          organizationId: actor.organizationId,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          content: true,
          revision: true,
          labels: {
            where: {
              deletedAt: null,
              organizationId: actor.organizationId,
            },
            select: { kind: true },
          },
        },
      }),
      input.conversationId
        ? db.session.findFirst({
            where: {
              id: input.conversationId,
              organizationId: actor.organizationId,
              deletedAt: null,
            },
            select: { id: true, projectId: true, wikiId: true },
          })
        : Promise.resolve(null),
      input.teamTaskId
        ? db.teamTask.findFirst({
            where: {
              id: input.teamTaskId,
              organizationId: actor.organizationId,
            },
            select: {
              id: true,
              projectId: true,
              workspaceId: true,
              assigneeType: true,
              assigneeId: true,
            },
          })
        : Promise.resolve(null),
      db.room.findUnique({
        where: {
          organizationId_key: {
            organizationId: actor.organizationId,
            key: `project:${projectScopeId}:default`,
          },
        },
        select: { id: true },
      }),
    ]);
    const roomMessage = projectRoom
      ? await db.roomMessage.findFirst({
          where: {
            organizationId: actor.organizationId,
            roomId: projectRoom.id,
          },
          orderBy: { sequence: 'desc' },
          select: { id: true, sequence: true },
        })
      : null;

    if (!version) {
      throw new ValidationError(
        'Document version must belong to the requested workspace and organization.'
      );
    }
    const versionState = deriveWorkspaceStateSemantics(version);
    if (!versionState.visible) {
      throw new ValidationError(
        'Document version must be an immutable visible version.'
      );
    }
    if (!versionState.aligned) {
      throw new ValidationError(
        'Document version must be aligned before execution.'
      );
    }
    if (input.conversationId && !conversation) {
      throw new ValidationError(
        'Conversation must belong to the current organization.'
      );
    }
    if (conversation) {
      const primaryConversationScoped = conversation.id === workspace.sessionId;
      const projectScoped =
        workspace.projectId !== null &&
        conversation.projectId === workspace.projectId;
      let legacyWikiScoped = false;
      if (
        !primaryConversationScoped &&
        !projectScoped &&
        conversation.projectId === null &&
        conversation.wikiId
      ) {
        if (conversation.wikiId === workspace.id) {
          legacyWikiScoped = true;
        } else if (workspace.projectId !== null) {
          const legacyWiki = await db.document.findFirst({
            where: {
              id: conversation.wikiId,
              organizationId: actor.organizationId,
              deletedAt: null,
            },
            select: { id: true, projectId: true },
          });
          legacyWikiScoped = Boolean(
            legacyWiki &&
              (legacyWiki.id === workspace.projectId ||
                legacyWiki.projectId === workspace.projectId)
          );
        }
      }
      if (
        !primaryConversationScoped &&
        !projectScoped &&
        !legacyWikiScoped
      ) {
        throw new ValidationError(
          'Conversation must belong to the workspace project scope.'
        );
      }
    }
    if (input.teamTaskId && !teamTask) {
      throw new ValidationError(
        'Team task must belong to the current organization.'
      );
    }
    if (teamTask) {
      const directlyScoped = teamTask.workspaceId === workspace.id;
      const projectScoped =
        workspace.projectId !== null &&
        teamTask.projectId === workspace.projectId;
      if (teamTask.workspaceId !== null && !directlyScoped) {
        throw new ValidationError(
          'Team task must belong to the requested workspace.'
        );
      }
      if (teamTask.projectId !== null && !projectScoped) {
        throw new ValidationError(
          'Team task must belong to the workspace project scope.'
        );
      }
      if (!directlyScoped && !projectScoped) {
        throw new ValidationError(
          'Team task must belong to the requested workspace or project scope.'
        );
      }
    }
    const resolvedAgentId = resolveKnowledgeAdmissionAgentIdV1({
      trustedAgentId: input.trustedAgentId,
      teamTaskAssigneeType: teamTask?.assigneeType ?? null,
      teamTaskAssigneeId: teamTask?.assigneeId ?? null,
    });
    const knowledgeAdmissionInput = {
      organizationId: actor.organizationId,
      workspaceId: workspace.id,
      agentId: resolvedAgentId,
    };
    let resolvedKnowledgeRepository: MaterializedContextManifestV1['knowledgeRepository'] =
      null;
    let knowledgeCommit = expected?.contextManifest.knowledgeCommit ?? null;
    let knowledgeSnapshot = expected?.knowledgeSnapshot ?? null;
    if (expected) {
      await assertKnowledgeAdmissionUnchangedV1(
        db,
        knowledgeAdmissionInput,
        expected
      );
    } else {
      knowledgeCommit = await resolveKnowledgeAdmissionV1(
        db as Prisma.TransactionClient,
        knowledgeAdmissionInput,
        captureKnowledgeRepositoryResolverV1(
          baseCommitResolver ?? (await defaultKnowledgeBaseResolver()),
          (repository) => {
            resolvedKnowledgeRepository = repository;
          }
        )
      );
      if (knowledgeCommit) {
        knowledgeSnapshot = await readActiveReadyKnowledgeSnapshotV1(
          db,
          actor.organizationId,
          knowledgeCommit.spaceId,
          new Date()
        );
        assertKnowledgeSnapshotMatchesCommitV1(
          knowledgeSnapshot,
          knowledgeCommit.baseCommit
        );
      }
    }

    const sourceFiles = parseVersionFiles(version.content);
    // Version payloads are immutable and retain their canonical serialized
    // content, so a later draft edit cannot change this manifest.
    const sourceContent = version.content;
    const files = sourceFiles.map((file) => ({
      id: file.id,
      parentId: file.parentId,
      name: file.name,
      path: file.path,
      nodeType: file.nodeType,
      kind: file.kind,
      role: file.role,
      language: file.language,
      content: file.content,
      contentSha256: sha256(file.content),
      sortOrder: file.sortOrder,
      isPrimary: file.isPrimary,
      revision: file.revision,
    }));

  const materialization: MaterializedContextManifestV1 = {
    resolvedAgentId,
    contextManifest: {
      schemaVersion: EXECUTION_JOB_CONTRACT_VERSION_V1,
      goal: input.goal,
      frozenAt: new Date().toISOString(),
      source: {
        type: 'document-version',
        workspaceId: workspace.id,
        conversationId: conversation?.id ?? null,
        documentVersionId: version.id,
      },
      workspace: {
        id: workspace.id,
        projectId: workspace.projectId,
        title: workspace.title,
        draftRevision: workspace.draftRevision,
        revision: workspace.revision,
      },
      document: {
        id: workspace.id,
        title: version.title,
        versionId: version.id,
        revision: version.revision,
        content: sourceContent,
        contentSha256: sha256(sourceContent),
      },
      files,
      roomWatermark: roomMessage
        ? {
            roomId: projectRoom!.id,
            messageId: roomMessage.id,
            sequence: roomMessage.sequence,
          }
        : null,
      knowledgeCommit,
    },
    knowledgeRepository: expected
      ? expected.knowledgeRepository
      : knowledgeCommit
        ? resolvedKnowledgeRepository
        : null,
    knowledgeSnapshot,
  };
  if (!expected) {
    if (knowledgeCommit && !materialization.knowledgeRepository) {
      throw new ValidationError(
        'Knowledge binding could not be frozen during execution admission.'
      );
    }
    if (!knowledgeCommit) {
      await assertNoUnresolvedKnowledgeCandidateV1(db, knowledgeAdmissionInput);
    }
    return materialization;
  }
  assertAdmissionSnapshotUnchangedV1(expected, materialization);
  return expected;
}

function captureKnowledgeRepositoryResolverV1(
  resolver: Pick<GitKnowledgeBaseResolver, 'resolve'>,
  capture: (repository: { repoPath: string; defaultBranch: string }) => void
): Pick<GitKnowledgeBaseResolver, 'resolve'> {
  return {
    async resolve(input) {
      const commit = await resolver.resolve(input);
      capture({
        repoPath: input.repoPath,
        defaultBranch: input.defaultBranch,
      });
      return commit;
    },
  };
}

export const executionAdmissionTestApiV1 = {
  materializeContextManifestV1,
  revalidateContextManifestV1(
    db: ExecutionAdmissionDbV1,
    actor: Pick<ExecutionJobActor, 'organizationId'>,
    input: MaterializeContextManifestInputV1,
    expected: MaterializedContextManifestV1
  ) {
    return materializeContextManifestV1(
      db,
      actor,
      input,
      undefined,
      expected
    );
  },
};

async function assertKnowledgeAdmissionUnchangedV1(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: { organizationId: string; workspaceId: string; agentId: string | null },
  expected: MaterializedContextManifestV1
): Promise<void> {
  const expectedBinding = expected.contextManifest.knowledgeCommit;
  const expectedRepository = expected.knowledgeRepository;

  if (expectedBinding === null) {
    if (expectedRepository !== null || expected.knowledgeSnapshot !== null) {
      throw new ValidationError(
        'Knowledge binding changed during execution admission.'
      );
    }
    await assertNoUnresolvedKnowledgeCandidateV1(db, input);
    return;
  }
  const candidate = await selectKnowledgeAdmissionCandidateV1(db, input);
  if (
    candidate === null ||
    expectedRepository === null ||
    candidate.bindingId !== expectedBinding.bindingId ||
    candidate.spaceId !== expectedBinding.spaceId ||
    candidate.workspaceId !== expectedBinding.workspaceId ||
    candidate.agentId !== expectedBinding.agentId ||
    candidate.mountPath !== expectedBinding.mountPath ||
    candidate.repoPath !== expectedRepository.repoPath ||
    candidate.defaultBranch !== expectedRepository.defaultBranch ||
    candidate.defaultBranch !== expectedBinding.defaultBranch
  ) {
    throw new ValidationError(
      'Knowledge binding changed during execution admission.'
    );
  }

  const actualSnapshot = await readActiveReadyKnowledgeSnapshotV1(
    db,
    input.organizationId,
    expectedBinding.spaceId,
    new Date()
  );
  assertKnowledgeSnapshotMatchesCommitV1(
    actualSnapshot,
    expectedBinding.baseCommit
  );
  if (
    stableJsonStringify(actualSnapshot) !==
    stableJsonStringify(expected.knowledgeSnapshot)
  ) {
    throw new ValidationError(
      'Knowledge active snapshot changed during execution admission.'
    );
  }
}

async function readActiveReadyKnowledgeSnapshotV1(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  organizationId: string,
  spaceId: string,
  now: Date
): Promise<MaterializedContextManifestV1['knowledgeSnapshot']> {
  const rows = await db.$queryRaw<Array<{
    activeSnapshotId: string | null;
    commitSha: string | null;
    organizationId: string | null;
    readyAt: Date | string | null;
    snapshotId: string | null;
    spaceId: string | null;
  }>>`
    SELECT
      space."activeSnapshotId" AS "activeSnapshotId",
      snapshot."id" AS "snapshotId",
      snapshot."organizationId" AS "organizationId",
      snapshot."spaceId" AS "spaceId",
      snapshot."commitSha" AS "commitSha",
      snapshot."readyAt" AS "readyAt"
    FROM "KnowledgeSpace" AS space
    LEFT JOIN "KnowledgeSnapshot" AS snapshot
      ON snapshot."id" = space."activeSnapshotId"
      AND snapshot."organizationId" = space."organizationId"
      AND snapshot."spaceId" = space."id"
    WHERE space."id" = ${spaceId}
      AND space."organizationId" = ${organizationId}
    LIMIT 1
  `;
  const snapshot = rows[0];
  if (!snapshot) {
    throw new ValidationError(
      'Knowledge space changed during execution admission.'
    );
  }
  if (snapshot.activeSnapshotId === null) return null;
  if (
    snapshot.snapshotId !== snapshot.activeSnapshotId ||
    snapshot.organizationId !== organizationId ||
    snapshot.spaceId !== spaceId ||
    snapshot.commitSha === null ||
    snapshot.readyAt === null
  ) {
    throw new ValidationError(
      'Knowledge active snapshot does not match its space and active pointer.'
    );
  }
  const readyAt = toIsoDateV1(snapshot.readyAt, 'Knowledge snapshot readyAt');
  if (new Date(readyAt).valueOf() > now.valueOf()) {
    throw new ValidationError(
      'Knowledge active snapshot must be ready before execution admission.'
    );
  }
  if (
    !snapshot.activeSnapshotId.trim() ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(snapshot.commitSha)
  ) {
    throw new ValidationError('Knowledge active snapshot is invalid.');
  }
  return {
    activeSnapshotId: snapshot.activeSnapshotId,
    organizationId: snapshot.organizationId,
    spaceId: snapshot.spaceId,
    commitSha: snapshot.commitSha,
    readyAt,
  };
}

function assertKnowledgeSnapshotMatchesCommitV1(
  snapshot: MaterializedContextManifestV1['knowledgeSnapshot'],
  baseCommit: string
): void {
  if (snapshot !== null && snapshot.commitSha !== baseCommit) {
    throw new ValidationError(
      'Knowledge active snapshot commit must match the admitted repository commit.'
    );
  }
}

async function assertNoUnresolvedKnowledgeCandidateV1(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: { organizationId: string; workspaceId: string; agentId: string | null }
): Promise<null> {
  const rows = await db.$queryRaw<Array<{ bindingId: string }>>`
    SELECT binding."id" AS "bindingId"
    FROM "KnowledgeBinding" AS binding
    INNER JOIN "KnowledgeSpace" AS space
      ON space."id" = binding."spaceId"
      AND space."organizationId" = binding."organizationId"
    WHERE binding."organizationId" = ${input.organizationId}
      AND binding."workspaceId" = ${input.workspaceId}
      AND binding."access" = 'propose'
      AND binding."mountPath" = '/'
      AND space."repoPath" IS NOT NULL
      AND space."repoUrl" IS NULL
      AND (
        (
          ${input.agentId} IS NOT NULL
          AND binding."agentId" = ${input.agentId}
          AND space."scope" = 'agent'
          AND space."ownerAgentId" = ${input.agentId}
        )
        OR (
          binding."agentId" IS NULL
          AND space."scope" = 'team'
          AND space."ownerAgentId" IS NULL
        )
      )
    LIMIT 1
  `;
  if (rows.length > 0) {
    throw new ValidationError(
      'Knowledge binding could not be frozen during execution admission.'
    );
  }
  return null;
}

function assertAdmissionSnapshotUnchangedV1(
  expected: MaterializedContextManifestV1,
  actual: MaterializedContextManifestV1
) {
  const expectedComparable = {
    resolvedAgentId: expected.resolvedAgentId,
    contextManifest: {
      ...expected.contextManifest,
      frozenAt: '',
    },
    knowledgeRepository: expected.knowledgeRepository,
    knowledgeSnapshot: expected.knowledgeSnapshot,
  };
  const actualComparable = {
    resolvedAgentId: actual.resolvedAgentId,
    contextManifest: {
      ...actual.contextManifest,
      frozenAt: '',
    },
    knowledgeRepository: actual.knowledgeRepository,
    knowledgeSnapshot: actual.knowledgeSnapshot,
  };
  if (
    stableJsonStringify(expectedComparable) !==
    stableJsonStringify(actualComparable)
  ) {
    throw new ValidationError(
      'Execution context changed during admission. Please retry.'
    );
  }
}

async function defaultKnowledgeBaseResolver(): Promise<
  Pick<GitKnowledgeBaseResolver, 'resolve'>
> {
  const { LocalGitKnowledgeBaseResolver } = await import(
    '@/agent/knowledge/git-worktree'
  );
  return new LocalGitKnowledgeBaseResolver();
}

function parseSelectionStrategy(
  strategy: RuntimeSelectionStrategyV1 | undefined
): RuntimeSelectionStrategyV1 {
  if (strategy === undefined) {
    return { mode: 'auto' };
  }
  if (strategy.mode === 'auto') {
    return { mode: 'auto' };
  }
  if (
    strategy.mode === 'explicit' &&
    typeof strategy.runtimeId === 'string' &&
    strategy.runtimeId.trim()
  ) {
    return { mode: 'explicit', runtimeId: strategy.runtimeId.trim() };
  }
  throw new ValidationError('Invalid runtime selection strategy.');
}

function parsePriority(value: number | undefined) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < -100 || value > 100) {
    throw new ValidationError('priority must be an integer from -100 to 100.');
  }
  return value;
}

function parseMaxAttempts(value: number | undefined) {
  if (value === undefined) return 1;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ValidationError('maxAttempts must be an integer from 1 to 100.');
  }
  return value;
}

function parseDeadline(value: Date | string | null | undefined) {
  if (value === undefined || value === null || value === '') return null;
  const deadline = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(deadline.valueOf())) {
    throw new ValidationError('deadlineAt must be a valid date.');
  }
  return deadline;
}

function nullableText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredText(value: string, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message);
  }
  return value.trim();
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function toIsoDateV1(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new ValidationError(`${field} must be a valid date.`);
  }
  return date.toISOString();
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  );
}
