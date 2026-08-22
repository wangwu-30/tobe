import { Type, type Static } from '@sinclair/typebox';

import {
  enforceGovernedAgentTool,
  type GovernedAgentTool,
} from '@/agent/tool-policy';
import { ConflictError } from '@/framework/resilience/app-error';
import { withIdempotency } from '@/lib/platform/idempotency';
import { canonicalJson, createStagedChangeSet, sha256 } from '@/lib/workspace/planning';

const DOCUMENT_CHANGE_OPERATION_V1 = Type.Object(
  {
    operation: Type.Union([
      Type.Literal('create'),
      Type.Literal('update'),
      Type.Literal('delete'),
    ]),
    fileId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    kind: Type.Union([
      Type.Literal('richtext'),
      Type.Literal('markdown'),
      Type.Literal('text'),
      Type.Literal('code'),
    ]),
    name: Type.String({ minLength: 1 }),
    nextContent: Type.Union([Type.String(), Type.Null()]),
    preimage: Type.Union([
      Type.Object(
        {
          content: Type.String(),
          revision: Type.Integer({ minimum: 1 }),
        },
        { additionalProperties: false }
      ),
      Type.Null(),
    ]),
    summary: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false }
);

export const PROPOSE_DOCUMENT_CHANGE_PARAMETERS_V1 = Type.Object(
  {
    baseDraftRevision: Type.Integer({ minimum: 0 }),
    baseVersionId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    operations: Type.Array(DOCUMENT_CHANGE_OPERATION_V1, {
      minItems: 1,
      maxItems: 50,
    }),
    summary: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false }
);

export type ProposeDocumentChangeParametersV1 = Static<
  typeof PROPOSE_DOCUMENT_CHANGE_PARAMETERS_V1
>;

export type CreateProposeDocumentChangeToolParamsV1 = {
  actorUserId: string;
  organizationId: string;
  originDeviceId: string;
  rememberSummary: (summary: string) => void;
  sessionId: string;
  sourceType?: string;
  workspaceId: string;
};

/**
 * Appends a reviewable document proposal without mutating the live draft.
 * Authority and target fields are trusted constructor inputs, never model args.
 */
export function createProposeDocumentChangeTool(
  options: CreateProposeDocumentChangeToolParamsV1
): GovernedAgentTool<typeof PROPOSE_DOCUMENT_CHANGE_PARAMETERS_V1> {
  const tool: GovernedAgentTool<
    typeof PROPOSE_DOCUMENT_CHANGE_PARAMETERS_V1
  > = {
    name: 'propose_document_change',
    label: 'Propose Document Change',
    description:
      'Append a reviewable change proposal for the current document without changing the live draft. Supply the exact base version, draft revision, and current content/revision preimage for every existing file; use a null preimage only for a new file.',
    safetyLevel: 'safe',
    confirmationPolicy: 'automatic',
    writePolicy: 'workspace-write',
    parameters: PROPOSE_DOCUMENT_CHANGE_PARAMETERS_V1,
    async execute(toolCallId, parameters) {
      assertProposalOperationShape(parameters);
      const requestHash = hashProposalRequest({
        actorUserId: options.actorUserId,
        organizationId: options.organizationId,
        parameters,
        sessionId: options.sessionId,
        workspaceId: options.workspaceId,
      });
      const proposal = await withIdempotency({
        action: async () => {
          return createStagedChangeSet(
            {
              deviceId: options.originDeviceId,
              organizationId: options.organizationId,
              userId: options.actorUserId,
            },
            {
              baseDraftRevision: parameters.baseDraftRevision,
              baseVersionId: parameters.baseVersionId,
              changes: parameters.operations.map((operation) => ({
                operation: operation.operation,
                fileId: operation.fileId,
                kind: operation.kind,
                name: operation.name.trim(),
                nextContent: operation.nextContent,
                preimage: operation.preimage,
                summary: operation.summary.trim(),
              })),
              conversationId: options.sessionId,
              sourceType: options.sourceType ?? 'ai-proposal',
              summary: parameters.summary.trim(),
              title: parameters.title.trim(),
              workspaceId: options.workspaceId,
            }
          );
        },
        key: `pi-tool:${options.sessionId}:${toolCallId}`,
        operation: `agent-tool:propose-document-change:v1:${options.workspaceId}`,
        organizationId: options.organizationId,
        requestHash,
        resource: (result) => ({
          resourceId: result.id,
          resourceType: 'staged-change-set',
        }),
        userId: options.actorUserId,
      });
      const summary = `Proposed document change \"${proposal.title}\" for review.`;
      options.rememberSummary(summary);
      return {
        content: [{ type: 'text', text: summary }],
        details: proposal,
      };
    },
  };

  return enforceGovernedAgentTool(tool);
}

export function assertProposalOperationShape(
  parameters: ProposeDocumentChangeParametersV1
) {
  const fileIds = parameters.operations.flatMap((operation) =>
    operation.fileId ? [operation.fileId] : []
  );
  if (new Set(fileIds).size !== fileIds.length) {
    throw new ConflictError('A proposal may contain only one operation per existing file.');
  }
  for (const operation of parameters.operations) {
    if (operation.operation === 'create') {
      if (operation.fileId !== null || operation.preimage !== null || operation.nextContent === null) {
        throw new ConflictError('A create proposal requires null file/preimage and new content.');
      }
    } else if (!operation.fileId || !operation.preimage) {
      throw new ConflictError('Update and delete proposals require an existing-file preimage.');
    } else if (operation.operation === 'update' && operation.nextContent === null) {
      throw new ConflictError('An update proposal requires new content.');
    } else if (operation.operation === 'delete' && operation.nextContent !== null) {
      throw new ConflictError('A delete proposal cannot include new content.');
    }
  }
}

function hashProposalRequest(value: unknown) {
  return sha256(canonicalJson(value));
}
