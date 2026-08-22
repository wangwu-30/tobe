import type { Prisma } from '@/generated/prisma/client';
import {
  RUNTIME_CONTRACT_VERSION_V1,
  matchExecutionRuntimeV1,
  type ExecutionSpecV1,
  type RuntimeCandidateV1,
  type RuntimeOrganizationPolicyV1,
  type RuntimeSelectionResultV1,
  type RuntimeSelectionStrategyV1,
} from '@/agent/execution';
import type { GitKnowledgeBaseResolver } from '@/agent/knowledge/contracts';
import { ValidationError } from '@/framework/resilience/app-error';
import type { FrozenKnowledgeBindingV1 } from '@/objects/execution-job/schema';

export type ResolveKnowledgeAdmissionInputV1 = {
  organizationId: string;
  workspaceId: string;
  agentId: string | null;
};

export type KnowledgeAdmissionBaseCommitResolverV1 = Pick<
  GitKnowledgeBaseResolver,
  'resolve'
>;

export type MatchKnowledgeAdmissionRuntimeInputV1 = {
  execution: ExecutionSpecV1;
  strategy: RuntimeSelectionStrategyV1;
  organizationPolicy: RuntimeOrganizationPolicyV1 & {
    allowedRuntimeIds: readonly string[];
  };
  candidates: readonly RuntimeCandidateV1[];
  knowledgeCommit: FrozenKnowledgeBindingV1 | null;
};

export type KnowledgeAdmissionCandidateV1 = {
  bindingId: string;
  workspaceId: string;
  agentId: string | null;
  spaceId: string;
  mountPath: string;
  access: string;
  scope: string;
  ownerAgentId: string | null;
  repoPath: string | null;
  repoUrl: string | null;
  defaultBranch: string;
};

export type ValidKnowledgeAdmissionCandidateV1 =
  KnowledgeAdmissionCandidateV1 & {
    repoPath: string;
  };

/**
 * Selects and freezes the one trusted local knowledge binding available to a
 * job at admission. An invalid candidate is ignored; ambiguity among valid
 * candidates fails closed instead of depending on database row order.
 */
export async function resolveKnowledgeAdmissionV1(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: ResolveKnowledgeAdmissionInputV1,
  resolver: KnowledgeAdmissionBaseCommitResolverV1
): Promise<FrozenKnowledgeBindingV1 | null> {
  const candidate = await selectKnowledgeAdmissionCandidateV1(db, input);
  if (!candidate) {
    return null;
  }

  let resolvedCommit: string;
  try {
    resolvedCommit = (
      await resolver.resolve({
        repoPath: candidate.repoPath,
        defaultBranch: candidate.defaultBranch,
      })
    ).toLowerCase();
  } catch {
    return null;
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(resolvedCommit)) {
    return null;
  }

  return {
    schemaVersion: 1,
    bindingId: candidate.bindingId,
    spaceId: candidate.spaceId,
    workspaceId: candidate.workspaceId,
    agentId: candidate.agentId,
    mountPath: '/',
    defaultBranch: candidate.defaultBranch,
    baseCommit: resolvedCommit,
  };
}

/**
 * Selects the authoritative database candidate without consulting Git. This
 * is deliberately separate from commit resolution so callers can revalidate
 * an already frozen admission snapshot inside a short write transaction.
 */
export async function selectKnowledgeAdmissionCandidateV1(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  input: ResolveKnowledgeAdmissionInputV1
): Promise<ValidKnowledgeAdmissionCandidateV1 | null> {
  const rows = await db.$queryRaw<KnowledgeAdmissionCandidateV1[]>`
    SELECT
      binding."id" AS "bindingId",
      binding."workspaceId" AS "workspaceId",
      binding."agentId" AS "agentId",
      binding."spaceId" AS "spaceId",
      binding."mountPath" AS "mountPath",
      binding."access" AS "access",
      space."scope" AS "scope",
      space."ownerAgentId" AS "ownerAgentId",
      space."repoPath" AS "repoPath",
      space."repoUrl" AS "repoUrl",
      space."defaultBranch" AS "defaultBranch"
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
    ORDER BY binding."id" ASC
  `;

  const candidates = rows.filter(isValidCandidate);
  const agentCandidates =
    input.agentId === null
      ? []
      : candidates.filter((candidate) => candidate.agentId === input.agentId);
  const globalCandidates = candidates.filter(
    (candidate) => candidate.agentId === null
  );
  const preferred = agentCandidates.length > 0
    ? agentCandidates
    : globalCandidates;

  if (preferred.length !== 1) {
    return null;
  }

  return preferred[0];
}

export function resolveKnowledgeAdmissionAgentIdV1(input: {
  trustedAgentId: string | null;
  teamTaskAssigneeType: string | null;
  teamTaskAssigneeId: string | null;
}): string | null {
  const assignedAgentId =
    input.teamTaskAssigneeType === 'agent'
      ? normalizedText(input.teamTaskAssigneeId)
      : null;
  if (input.teamTaskAssigneeType === 'agent' && assignedAgentId === null) {
    throw new ValidationError(
      'Agent-assigned TeamTask must identify its assignee.'
    );
  }
  if (
    input.trustedAgentId !== null &&
    assignedAgentId !== null &&
    input.trustedAgentId !== assignedAgentId
  ) {
    throw new ValidationError(
      'Trusted agent identity conflicts with the TeamTask assignee.'
    );
  }
  return input.trustedAgentId ?? assignedAgentId;
}

/**
 * Applies the trusted-workspace admission rule without mutating the caller's
 * execution requirements. Auto selection cannot see git-worktree deployments
 * without a frozen binding; explicit selection keeps an explainable,
 * ineligible evaluation for the requested deployment.
 */
export function matchKnowledgeAdmissionRuntimeV1(
  input: MatchKnowledgeAdmissionRuntimeInputV1
): RuntimeSelectionResultV1 {
  const hasKnowledgeBinding = input.knowledgeCommit !== null;
  const candidates =
    hasKnowledgeBinding || input.strategy.mode === 'explicit'
      ? input.candidates
      : input.candidates.filter(
          ({ descriptor }) =>
            descriptor.capabilities.workspace !== 'git-worktree'
        );
  const explicitRuntimeId =
    input.strategy.mode === 'explicit' ? input.strategy.runtimeId : null;
  let organizationPolicy = input.organizationPolicy;
  if (!hasKnowledgeBinding && explicitRuntimeId !== null) {
    const requestedRuntime = input.candidates.find(
      ({ descriptor }) =>
        descriptor.runtimeId === explicitRuntimeId
    );
    if (
      requestedRuntime?.descriptor.capabilities.workspace === 'git-worktree'
    ) {
      organizationPolicy = {
        ...organizationPolicy,
        allowedRuntimeIds: organizationPolicy.allowedRuntimeIds.filter(
          (runtimeId) => runtimeId !== explicitRuntimeId
        ),
      };
    }
  }

  const selection = matchExecutionRuntimeV1({
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    execution: input.execution,
    strategy: input.strategy,
    organizationPolicy,
    candidates,
  });
  const requestedGitWorkspaceUnavailable =
    !hasKnowledgeBinding &&
    explicitRuntimeId !== null &&
    input.candidates.some(
      ({ descriptor }) =>
        descriptor.runtimeId === explicitRuntimeId &&
        descriptor.capabilities.workspace === 'git-worktree'
    );
  const requiredGitWorkspaceUnavailable =
    !hasKnowledgeBinding &&
    input.execution.requirements.workspace === 'git-worktree';
  if (
    !requestedGitWorkspaceUnavailable &&
    (!requiredGitWorkspaceUnavailable ||
      (selection.matched === false &&
        selection.failure.code === 'requested-runtime-not-found'))
  ) {
    return selection;
  }

  return {
    ...selection,
    matched: false,
    selected: null,
    failure:
      input.strategy.mode === 'explicit'
        ? {
            code: 'requested-runtime-ineligible',
            message:
              'The explicitly requested runtime requires a unique trusted Git knowledge binding, but none is available.',
            runtimeId: input.strategy.runtimeId,
          }
        : {
            code: 'no-compatible-runtime',
            message:
              'Git worktree execution requires a unique trusted Git knowledge binding, but none is available.',
          },
  };
}

function isValidCandidate(
  candidate: KnowledgeAdmissionCandidateV1
): candidate is ValidKnowledgeAdmissionCandidateV1 {
  if (
    !candidate.bindingId.trim() ||
    !candidate.spaceId.trim() ||
    !candidate.workspaceId.trim() ||
    candidate.mountPath !== '/' ||
    candidate.access !== 'propose' ||
    typeof candidate.repoPath !== 'string' ||
    !candidate.repoPath.trim() ||
    candidate.repoUrl !== null ||
    !candidate.defaultBranch.trim()
  ) {
    return false;
  }
  if (candidate.agentId === null) {
    return candidate.scope === 'team' && candidate.ownerAgentId === null;
  }
  return (
    candidate.scope === 'agent' &&
    candidate.ownerAgentId === candidate.agentId
  );
}

function normalizedText(value: string | null): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
