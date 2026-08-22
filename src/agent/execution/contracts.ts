export const RUNTIME_CONTRACT_VERSION_V1 = 1 as const;

export type RuntimeContractVersionV1 =
  typeof RUNTIME_CONTRACT_VERSION_V1;

export type RuntimeExecutionKindV1 =
  | 'coding'
  | 'research'
  | 'browser'
  | 'document'
  | 'workflow';

export type RuntimeStreamingV1 = 'none' | 'text' | 'typed-events';
export type RuntimeInterruptV1 = 'none' | 'process-kill' | 'graceful';
export type RuntimeWorkspaceV1 = 'none' | 'directory' | 'git-worktree';
export type RuntimeSandboxV1 = 'host' | 'container' | 'vm' | 'remote';

/**
 * The V1 capability vocabulary shared by the control plane and runtime
 * adapters. `features` is an extension seam for exact-match capabilities that
 * do not yet justify a contract-version change.
 */
export type RuntimeCapabilitiesV1 = {
  schemaVersion: RuntimeContractVersionV1;
  kinds: readonly RuntimeExecutionKindV1[];
  nativeResume: boolean;
  checkpoint: boolean;
  streaming: RuntimeStreamingV1;
  interrupt: RuntimeInterruptV1;
  workspace: RuntimeWorkspaceV1;
  sandbox: RuntimeSandboxV1;
  structuredArtifacts: boolean;
  waitingForHuman: boolean;
  /**
   * Exact model identifiers accepted by this runtime. `"*"` means the runtime
   * can accept any model identifier supplied by the control plane.
   */
  supportedModels: readonly string[];
  features?: readonly string[];
};

/**
 * All fields are hard requirements. Omitted fields mean "not required".
 *
 * Ordered capabilities (`streaming`, `interrupt`, and `workspace`) express a
 * minimum. `sandbox` is an any-of list because sandbox kinds are alternatives,
 * not an ordering.
 */
export type ExecutionRequirementsV1 = {
  nativeResume?: true;
  checkpoint?: true;
  streaming?: RuntimeStreamingV1;
  interrupt?: RuntimeInterruptV1;
  workspace?: RuntimeWorkspaceV1;
  sandbox?: readonly RuntimeSandboxV1[];
  structuredArtifacts?: true;
  waitingForHuman?: true;
  features?: readonly string[];
};

export type ExecutionSpecV1 = {
  schemaVersion: RuntimeContractVersionV1;
  goal: string;
  kind: RuntimeExecutionKindV1;
  model?: string;
  requirements: ExecutionRequirementsV1;
};

export type RuntimeDescriptorV1 = {
  schemaVersion: RuntimeContractVersionV1;
  runtimeId: string;
  displayName: string;
  runtimeVersion: string;
  capabilities: RuntimeCapabilitiesV1;
  /**
   * A runtime-provided tie breaker. Agent preference always wins over this
   * value, while organization policy and requirements remain hard filters.
   */
  selectionPriority?: number;
};

export type RuntimeHealthStateV1 =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'offline';

export type RuntimeHealthV1 = {
  state: RuntimeHealthStateV1;
  acceptingNewAttempts: boolean;
  observedAt?: string;
  message?: string;
};

export type RuntimeCapacityV1 = {
  availableSlots: number;
  activeAttempts?: number;
  maxConcurrentAttempts?: number;
};

export type RuntimeCandidateV1 = {
  descriptor: RuntimeDescriptorV1;
  health: RuntimeHealthV1;
  capacity: RuntimeCapacityV1;
};

export type RuntimeSelectionStrategyV1 =
  | {
      mode: 'auto';
    }
  | {
      mode: 'explicit';
      runtimeId: string;
    };

export type RuntimeAgentPreferenceV1 = {
  /**
   * Soft preference in descending order. An unavailable or incompatible
   * preferred runtime is skipped without weakening execution requirements.
   */
  orderedRuntimeIds: readonly string[];
};

export type RuntimeOrganizationPolicyV1 = {
  /**
   * An explicit allowlist, or `"*"` when every registered runtime is allowed.
   * An empty list intentionally disables runtime execution for the
   * organization.
   */
  allowedRuntimeIds: readonly string[] | '*';
  /**
   * Degraded runtimes are filtered unless the organization opts into them.
   * Unhealthy and offline runtimes are never schedulable.
   */
  allowDegradedRuntimes?: boolean;
};

export type RuntimeSelectionRequestV1 = {
  schemaVersion: RuntimeContractVersionV1;
  execution: ExecutionSpecV1;
  strategy: RuntimeSelectionStrategyV1;
  agentPreference?: RuntimeAgentPreferenceV1;
  organizationPolicy: RuntimeOrganizationPolicyV1;
  candidates: readonly RuntimeCandidateV1[];
};

export type RuntimeRejectionCodeV1 =
  | 'duplicate-runtime-id'
  | 'not-explicit-runtime'
  | 'not-allowed-by-organization'
  | 'runtime-degraded'
  | 'runtime-unhealthy'
  | 'runtime-not-accepting-attempts'
  | 'runtime-at-capacity'
  | 'execution-kind-not-supported'
  | 'native-resume-required'
  | 'checkpoint-required'
  | 'streaming-capability-insufficient'
  | 'interrupt-capability-insufficient'
  | 'workspace-capability-insufficient'
  | 'sandbox-not-supported'
  | 'structured-artifacts-required'
  | 'waiting-for-human-required'
  | 'model-not-supported'
  | 'feature-not-supported';

export type RuntimeRequirementValueV1 =
  | boolean
  | number
  | string
  | readonly string[]
  | null;

export type RuntimeRejectionReasonV1 = {
  code: RuntimeRejectionCodeV1;
  message: string;
  path?: string;
  expected?: RuntimeRequirementValueV1;
  actual?: RuntimeRequirementValueV1;
};

export type RuntimeCandidateEvaluationV1 = {
  candidate: RuntimeCandidateV1;
  eligible: boolean;
  preferenceRank: number | null;
  rejectionReasons: readonly RuntimeRejectionReasonV1[];
};

export type RuntimeSelectionFailureCodeV1 =
  | 'invalid-selection-request'
  | 'requested-runtime-not-found'
  | 'requested-runtime-ineligible'
  | 'no-compatible-runtime';

export type RuntimeSelectionFailureV1 = {
  code: RuntimeSelectionFailureCodeV1;
  message: string;
  runtimeId?: string;
};

export type RuntimeSelectedByV1 =
  | 'explicit-request'
  | 'agent-preference'
  | 'automatic-ranking';

export type RuntimeSelectionResultV1 =
  | {
      schemaVersion: RuntimeContractVersionV1;
      matched: true;
      selected: RuntimeCandidateV1;
      selectedBy: RuntimeSelectedByV1;
      evaluations: readonly RuntimeCandidateEvaluationV1[];
    }
  | {
      schemaVersion: RuntimeContractVersionV1;
      matched: false;
      selected: null;
      failure: RuntimeSelectionFailureV1;
      evaluations: readonly RuntimeCandidateEvaluationV1[];
    };
