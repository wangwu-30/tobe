import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import {
  enforceGovernedAgentTool,
  type AgentToolConfirmationAuthority,
  type GovernedAgentTool,
} from '@/agent/tool-policy';
import {
  RUNTIME_CONTRACT_VERSION_V1,
  type ExecutionRequirementsV1,
} from '@/agent/execution';
import { createExecutionJob } from '@/objects/execution-job';

const EXECUTION_REQUIREMENTS_PARAMETERS = Type.Object(
  {
    checkpoint: Type.Optional(Type.Literal(true)),
    features: Type.Optional(
      Type.Array(Type.String({ minLength: 1, pattern: '\\S' }), {
        uniqueItems: true,
      })
    ),
    interrupt: Type.Optional(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('process-kill'),
        Type.Literal('graceful'),
      ])
    ),
    nativeResume: Type.Optional(Type.Literal(true)),
    sandbox: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal('host'),
          Type.Literal('container'),
          Type.Literal('vm'),
          Type.Literal('remote'),
        ]),
        { minItems: 1, uniqueItems: true }
      )
    ),
    streaming: Type.Optional(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('text'),
        Type.Literal('typed-events'),
      ])
    ),
    structuredArtifacts: Type.Optional(Type.Literal(true)),
    waitingForHuman: Type.Optional(Type.Literal(true)),
    workspace: Type.Optional(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('directory'),
        Type.Literal('git-worktree'),
      ])
    ),
  },
  { additionalProperties: false }
);

export const START_EXECUTION_JOB_PARAMETERS_V1 = Type.Object(
  {
    documentVersionId: Type.String({ minLength: 1, pattern: '\\S' }),
    goal: Type.String({ minLength: 1, pattern: '\\S' }),
    kind: Type.Union([
      Type.Literal('coding'),
      Type.Literal('research'),
      Type.Literal('browser'),
      Type.Literal('document'),
      Type.Literal('workflow'),
    ]),
    requirements: Type.Optional(EXECUTION_REQUIREMENTS_PARAMETERS),
    runtimeId: Type.Optional(
      Type.String({ minLength: 1, pattern: '\\S' })
    ),
    teamTaskId: Type.Optional(
      Type.String({ minLength: 1, pattern: '\\S' })
    ),
  },
  { additionalProperties: false }
);

type CreateStartExecutionJobToolParams = {
  actorUserId: string;
  confirmationAuthority?: AgentToolConfirmationAuthority;
  conversationId?: string | null;
  idempotencyScope?: string;
  organizationId: string;
  originDeviceId?: string;
  originRoomId?: string | null;
  originRoomMessageId?: string | null;
  rememberSummary: (summary: string) => void;
  workspaceId: string;
};

export function createStartExecutionJobTool({
  actorUserId,
  confirmationAuthority,
  conversationId,
  idempotencyScope,
  organizationId,
  originDeviceId,
  originRoomId,
  originRoomMessageId,
  rememberSummary,
  workspaceId,
}: CreateStartExecutionJobToolParams): GovernedAgentTool<
  typeof START_EXECUTION_JOB_PARAMETERS_V1
> {
  const toolIdempotencyScope = requireNonWhitespace(
    idempotencyScope ?? conversationId ?? '',
    'idempotencyScope'
  );
  const tool: GovernedAgentTool<typeof START_EXECUTION_JOB_PARAMETERS_V1> = {
    name: 'start_execution_job',
    label: 'Start Execution Job',
    description:
      'Persist an independent execution job for the requested goal and queue it for a compatible runtime after explicit human confirmation. This returns a job receipt only; it does not run or wait for the work in this request.',
    safetyLevel: 'confirm',
    confirmationPolicy: 'required',
    writePolicy: 'organization-scoped-append',
    parameters: START_EXECUTION_JOB_PARAMETERS_V1,
    async execute(toolCallId, params) {
      const goal = requireNonWhitespace(params.goal, 'goal');
      const runtimeId = normalizeOptionalIdentifier(
        params.runtimeId,
        'runtimeId'
      );
      const teamTaskId = normalizeOptionalIdentifier(
        params.teamTaskId,
        'teamTaskId'
      );
      const requirements = normalizeRequirements(params.requirements);
      const receipt = await createExecutionJob(
        {
          deviceId: originDeviceId,
          organizationId,
          userId: actorUserId,
        },
        {
          conversationId,
          documentVersionId: requireNonWhitespace(
            params.documentVersionId,
            'documentVersionId'
          ),
          goal,
          spec: {
            schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
            kind: params.kind,
            requirements,
          },
          strategy: runtimeId
            ? { mode: 'explicit', runtimeId }
            : { mode: 'auto' },
          teamTaskId: teamTaskId || null,
          workspaceId,
        },
        {
          idempotencyKey: `pi-tool:${toolIdempotencyScope}:${toolCallId}`,
          originRoomId,
          originRoomMessageId,
        }
      );

      const runtimeSummary = receipt.selectedRuntimeId
        ? ` Runtime: ${receipt.selectedRuntimeId}.`
        : '';
      const blockedReason = receipt.selection.matched
        ? 'No compatible runtime is currently available.'
        : receipt.selection.failure.message;
      const summary =
        receipt.status === 'queued'
          ? `Execution job ${receipt.jobId} was queued.${runtimeSummary}`
          : `Execution job ${receipt.jobId} was recorded but is blocked. ${blockedReason}${runtimeSummary}`;
      rememberSummary(summary);

      return {
        content: [{ type: 'text', text: summary }],
        details: receipt,
      };
    },
  };

  return enforceGovernedAgentTool(tool, confirmationAuthority);
}

export type StartExecutionJobParametersV1 = Static<
  typeof START_EXECUTION_JOB_PARAMETERS_V1
>;

/** Revalidates the persisted request before an owner approval can create a job. */
export function parseStartExecutionJobParametersV1(
  value: unknown
): StartExecutionJobParametersV1 {
  if (!Value.Check(START_EXECUTION_JOB_PARAMETERS_V1, value)) {
    throw new Error('Persisted start_execution_job parameters are invalid.');
  }
  return value;
}

function requireNonWhitespace(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} must not be blank.`);
  }
  return normalized;
}

function normalizeOptionalIdentifier(
  value: string | undefined,
  field: string
) {
  return value === undefined ? undefined : requireNonWhitespace(value, field);
}

function normalizeRequirements(
  requirements: ExecutionRequirementsV1 | undefined
): ExecutionRequirementsV1 {
  if (!requirements?.features) {
    return requirements || {};
  }

  const features = requirements.features.map((feature) =>
    requireNonWhitespace(feature, 'requirements.features[]')
  );
  if (new Set(features).size !== features.length) {
    throw new Error('requirements.features must not contain duplicates.');
  }

  return { ...requirements, features };
}
