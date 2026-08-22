import {
  RUNTIME_CONTRACT_VERSION_V1,
  type RuntimeCandidateEvaluationV1,
  type RuntimeCandidateV1,
  type RuntimeInterruptV1,
  type RuntimeRejectionReasonV1,
  type RuntimeSelectionRequestV1,
  type RuntimeSelectionResultV1,
  type RuntimeStreamingV1,
  type RuntimeWorkspaceV1,
} from './contracts';

const STREAMING_LEVEL: Record<RuntimeStreamingV1, number> = {
  none: 0,
  text: 1,
  'typed-events': 2,
};

const INTERRUPT_LEVEL: Record<RuntimeInterruptV1, number> = {
  none: 0,
  'process-kill': 1,
  graceful: 2,
};

const WORKSPACE_LEVEL: Record<RuntimeWorkspaceV1, number> = {
  none: 0,
  directory: 1,
  'git-worktree': 2,
};

type CandidateEvaluationContext = {
  duplicateRuntimeIds: ReadonlySet<string>;
  preferenceRanks: ReadonlyMap<string, number>;
  request: RuntimeSelectionRequestV1;
};

function rejection(
  reason: RuntimeRejectionReasonV1
): RuntimeRejectionReasonV1 {
  return reason;
}

function evaluateCandidate(
  candidate: RuntimeCandidateV1,
  context: CandidateEvaluationContext
): RuntimeCandidateEvaluationV1 {
  const { descriptor, health, capacity } = candidate;
  const { execution, organizationPolicy, strategy } = context.request;
  const { capabilities } = descriptor;
  const requirements = execution.requirements;
  const rejectionReasons: RuntimeRejectionReasonV1[] = [];

  if (context.duplicateRuntimeIds.has(descriptor.runtimeId)) {
    rejectionReasons.push(
      rejection({
        code: 'duplicate-runtime-id',
        message: `Runtime id "${descriptor.runtimeId}" is registered more than once.`,
        path: 'descriptor.runtimeId',
        expected: 'unique runtime id',
        actual: descriptor.runtimeId,
      })
    );
  }

  if (capabilities.waitingForHuman && !capabilities.nativeResume) {
    rejectionReasons.push(
      rejection({
        code: 'native-resume-required',
        message: `Runtime "${descriptor.runtimeId}" advertises waiting for human input without native resume.`,
        path: 'capabilities.nativeResume',
        expected: true,
        actual: false,
      })
    );
  }

  if (
    strategy.mode === 'explicit' &&
    descriptor.runtimeId !== strategy.runtimeId
  ) {
    rejectionReasons.push(
      rejection({
        code: 'not-explicit-runtime',
        message: `Runtime "${descriptor.runtimeId}" was not explicitly requested.`,
        path: 'strategy.runtimeId',
        expected: strategy.runtimeId,
        actual: descriptor.runtimeId,
      })
    );
  }

  if (
    organizationPolicy.allowedRuntimeIds !== '*' &&
    !organizationPolicy.allowedRuntimeIds.includes(descriptor.runtimeId)
  ) {
    rejectionReasons.push(
      rejection({
        code: 'not-allowed-by-organization',
        message: `Runtime "${descriptor.runtimeId}" is not allowed by the organization.`,
        path: 'organizationPolicy.allowedRuntimeIds',
        expected: organizationPolicy.allowedRuntimeIds,
        actual: descriptor.runtimeId,
      })
    );
  }

  if (health.state === 'degraded') {
    if (!organizationPolicy.allowDegradedRuntimes) {
      rejectionReasons.push(
        rejection({
          code: 'runtime-degraded',
          message: `Runtime "${descriptor.runtimeId}" is degraded and organization policy does not allow degraded runtimes.`,
          path: 'health.state',
          expected: 'healthy',
          actual: health.state,
        })
      );
    }
  } else if (health.state !== 'healthy') {
    rejectionReasons.push(
      rejection({
        code: 'runtime-unhealthy',
        message: `Runtime "${descriptor.runtimeId}" is ${health.state}.`,
        path: 'health.state',
        expected: 'healthy',
        actual: health.state,
      })
    );
  }

  if (!health.acceptingNewAttempts) {
    rejectionReasons.push(
      rejection({
        code: 'runtime-not-accepting-attempts',
        message: `Runtime "${descriptor.runtimeId}" is not accepting new attempts.`,
        path: 'health.acceptingNewAttempts',
        expected: true,
        actual: false,
      })
    );
  }

  if (
    !Number.isFinite(capacity.availableSlots) ||
    capacity.availableSlots <= 0
  ) {
    rejectionReasons.push(
      rejection({
        code: 'runtime-at-capacity',
        message: `Runtime "${descriptor.runtimeId}" has no available execution slots.`,
        path: 'capacity.availableSlots',
        expected: 'greater than 0',
        actual: capacity.availableSlots,
      })
    );
  }

  if (!capabilities.kinds.includes(execution.kind)) {
    rejectionReasons.push(
      rejection({
        code: 'execution-kind-not-supported',
        message: `Runtime "${descriptor.runtimeId}" does not support "${execution.kind}" execution.`,
        path: 'capabilities.kinds',
        expected: execution.kind,
        actual: capabilities.kinds,
      })
    );
  }

  if (requirements.nativeResume && !capabilities.nativeResume) {
    rejectionReasons.push(
      rejection({
        code: 'native-resume-required',
        message: `Runtime "${descriptor.runtimeId}" does not support native resume.`,
        path: 'capabilities.nativeResume',
        expected: true,
        actual: capabilities.nativeResume,
      })
    );
  }

  if (requirements.checkpoint && !capabilities.checkpoint) {
    rejectionReasons.push(
      rejection({
        code: 'checkpoint-required',
        message: `Runtime "${descriptor.runtimeId}" does not support checkpoints.`,
        path: 'capabilities.checkpoint',
        expected: true,
        actual: capabilities.checkpoint,
      })
    );
  }

  if (
    requirements.streaming &&
    STREAMING_LEVEL[capabilities.streaming] <
      STREAMING_LEVEL[requirements.streaming]
  ) {
    rejectionReasons.push(
      rejection({
        code: 'streaming-capability-insufficient',
        message: `Runtime "${descriptor.runtimeId}" provides "${capabilities.streaming}" streaming, but "${requirements.streaming}" is required.`,
        path: 'capabilities.streaming',
        expected: requirements.streaming,
        actual: capabilities.streaming,
      })
    );
  }

  if (
    requirements.interrupt &&
    INTERRUPT_LEVEL[capabilities.interrupt] <
      INTERRUPT_LEVEL[requirements.interrupt]
  ) {
    rejectionReasons.push(
      rejection({
        code: 'interrupt-capability-insufficient',
        message: `Runtime "${descriptor.runtimeId}" provides "${capabilities.interrupt}" interruption, but "${requirements.interrupt}" is required.`,
        path: 'capabilities.interrupt',
        expected: requirements.interrupt,
        actual: capabilities.interrupt,
      })
    );
  }

  if (
    requirements.workspace &&
    WORKSPACE_LEVEL[capabilities.workspace] <
      WORKSPACE_LEVEL[requirements.workspace]
  ) {
    rejectionReasons.push(
      rejection({
        code: 'workspace-capability-insufficient',
        message: `Runtime "${descriptor.runtimeId}" provides "${capabilities.workspace}" workspace support, but "${requirements.workspace}" is required.`,
        path: 'capabilities.workspace',
        expected: requirements.workspace,
        actual: capabilities.workspace,
      })
    );
  }

  if (
    requirements.sandbox &&
    !requirements.sandbox.includes(capabilities.sandbox)
  ) {
    rejectionReasons.push(
      rejection({
        code: 'sandbox-not-supported',
        message: `Runtime "${descriptor.runtimeId}" uses a "${capabilities.sandbox}" sandbox, which is not one of the accepted sandbox types.`,
        path: 'capabilities.sandbox',
        expected: requirements.sandbox,
        actual: capabilities.sandbox,
      })
    );
  }

  if (
    requirements.structuredArtifacts &&
    !capabilities.structuredArtifacts
  ) {
    rejectionReasons.push(
      rejection({
        code: 'structured-artifacts-required',
        message: `Runtime "${descriptor.runtimeId}" does not produce structured artifacts.`,
        path: 'capabilities.structuredArtifacts',
        expected: true,
        actual: capabilities.structuredArtifacts,
      })
    );
  }

  if (requirements.waitingForHuman && !capabilities.waitingForHuman) {
    rejectionReasons.push(
      rejection({
        code: 'waiting-for-human-required',
        message: `Runtime "${descriptor.runtimeId}" cannot wait for human input.`,
        path: 'capabilities.waitingForHuman',
        expected: true,
        actual: capabilities.waitingForHuman,
      })
    );
  }

  if (
    execution.model &&
    !capabilities.supportedModels.includes('*') &&
    !capabilities.supportedModels.includes(execution.model)
  ) {
    rejectionReasons.push(
      rejection({
        code: 'model-not-supported',
        message: `Runtime "${descriptor.runtimeId}" does not support model "${execution.model}".`,
        path: 'capabilities.supportedModels',
        expected: execution.model,
        actual: capabilities.supportedModels,
      })
    );
  }

  for (const feature of requirements.features || []) {
    if (!capabilities.features?.includes(feature)) {
      rejectionReasons.push(
        rejection({
          code: 'feature-not-supported',
          message: `Runtime "${descriptor.runtimeId}" does not support required feature "${feature}".`,
          path: 'capabilities.features',
          expected: feature,
          actual: capabilities.features || [],
        })
      );
    }
  }

  return {
    candidate,
    eligible: rejectionReasons.length === 0,
    preferenceRank:
      context.preferenceRanks.get(descriptor.runtimeId) ?? null,
    rejectionReasons,
  };
}

function collectDuplicateRuntimeIds(
  candidates: readonly RuntimeCandidateV1[]
): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const { descriptor } of candidates) {
    if (seen.has(descriptor.runtimeId)) {
      duplicates.add(descriptor.runtimeId);
    }
    seen.add(descriptor.runtimeId);
  }

  return duplicates;
}

function createPreferenceRanks(
  runtimeIds: readonly string[] | undefined
): Map<string, number> {
  const ranks = new Map<string, number>();

  for (const runtimeId of runtimeIds || []) {
    if (!ranks.has(runtimeId)) {
      ranks.set(runtimeId, ranks.size);
    }
  }

  return ranks;
}

function healthRank(candidate: RuntimeCandidateV1) {
  return candidate.health.state === 'healthy' ? 0 : 1;
}

function compareEvaluations(
  left: RuntimeCandidateEvaluationV1,
  right: RuntimeCandidateEvaluationV1
) {
  const leftPreference = left.preferenceRank ?? Number.POSITIVE_INFINITY;
  const rightPreference = right.preferenceRank ?? Number.POSITIVE_INFINITY;

  if (leftPreference !== rightPreference) {
    return leftPreference - rightPreference;
  }

  const priorityDifference =
    (right.candidate.descriptor.selectionPriority ?? 0) -
    (left.candidate.descriptor.selectionPriority ?? 0);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const healthDifference =
    healthRank(left.candidate) - healthRank(right.candidate);
  if (healthDifference !== 0) {
    return healthDifference;
  }

  const capacityDifference =
    right.candidate.capacity.availableSlots -
    left.candidate.capacity.availableSlots;
  if (capacityDifference !== 0) {
    return capacityDifference;
  }

  return left.candidate.descriptor.runtimeId.localeCompare(
    right.candidate.descriptor.runtimeId
  );
}

/**
 * Selects a runtime without reading mutable state or changing its inputs.
 *
 * Registry, health, and capacity snapshots must be supplied by the caller.
 * Every requirement and organization policy is applied before preference or
 * fallback ranking, so auto selection can never weaken a required capability.
 */
export function matchExecutionRuntimeV1(
  request: RuntimeSelectionRequestV1
): RuntimeSelectionResultV1 {
  const duplicateRuntimeIds = collectDuplicateRuntimeIds(request.candidates);
  const preferenceRanks = createPreferenceRanks(
    request.agentPreference?.orderedRuntimeIds
  );
  const context: CandidateEvaluationContext = {
    duplicateRuntimeIds,
    preferenceRanks,
    request,
  };
  const evaluations = request.candidates.map((candidate) =>
    evaluateCandidate(candidate, context)
  );

  if (duplicateRuntimeIds.size > 0) {
    return {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      matched: false,
      selected: null,
      failure: {
        code: 'invalid-selection-request',
        message: `Runtime registry contains duplicate ids: ${[
          ...duplicateRuntimeIds,
        ]
          .sort()
          .join(', ')}.`,
      },
      evaluations,
    };
  }

  if (request.strategy.mode === 'explicit') {
    const requestedRuntimeId = request.strategy.runtimeId;
    const requestedEvaluation = evaluations.find(
      ({ candidate }) =>
        candidate.descriptor.runtimeId === requestedRuntimeId
    );

    if (!requestedEvaluation) {
      return {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        matched: false,
        selected: null,
        failure: {
          code: 'requested-runtime-not-found',
          message: `Explicitly requested runtime "${requestedRuntimeId}" is not registered.`,
          runtimeId: requestedRuntimeId,
        },
        evaluations,
      };
    }

    if (!requestedEvaluation.eligible) {
      return {
        schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
        matched: false,
        selected: null,
        failure: {
          code: 'requested-runtime-ineligible',
          message: `Explicitly requested runtime "${requestedRuntimeId}" does not satisfy the selection constraints.`,
          runtimeId: requestedRuntimeId,
        },
        evaluations,
      };
    }

    return {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      matched: true,
      selected: requestedEvaluation.candidate,
      selectedBy: 'explicit-request',
      evaluations,
    };
  }

  const eligible = evaluations
    .filter((evaluation) => evaluation.eligible)
    .sort(compareEvaluations);
  const selectedEvaluation = eligible[0];

  if (!selectedEvaluation) {
    return {
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      matched: false,
      selected: null,
      failure: {
        code: 'no-compatible-runtime',
        message:
          'No allowed, healthy runtime with available capacity satisfies every execution requirement.',
      },
      evaluations,
    };
  }

  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    matched: true,
    selected: selectedEvaluation.candidate,
    selectedBy:
      selectedEvaluation.preferenceRank === null
        ? 'automatic-ranking'
        : 'agent-preference',
    evaluations,
  };
}
