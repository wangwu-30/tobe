import { Type, type Static } from 'typebox';

import {
  enforceGovernedAgentTool,
  type GovernedAgentTool,
} from '@/agent/tool-policy';
import { consumeRoomDelegationGrant } from '@/objects/room';

export const DELEGATE_ROOM_TASK_PARAMETERS_V1 = Type.Object(
  {
    instruction: Type.String({ minLength: 1, maxLength: 8_000, pattern: '\\S' }),
    targetAgentId: Type.String({ minLength: 1, maxLength: 512, pattern: '\\S' }),
  },
  { additionalProperties: false }
);

export type DelegateRoomTaskParametersV1 = Static<
  typeof DELEGATE_ROOM_TASK_PARAMETERS_V1
>;

export type CreateDelegateRoomTaskToolOptionsV1 = {
  actorUserId: string;
  consumeDelegation?: typeof consumeRoomDelegationGrant;
  organizationId: string;
  roomId: string;
  source: {
    deliveryId: string;
    generation: number;
    roomSessionId: string;
    workerId: string;
  };
};

/**
 * A safe, durable Room-to-Room dispatch. The model chooses only a target and
 * instruction. All source identity, lease fencing, lineage and budgets remain
 * server-owned inputs to the Room control plane.
 */
export function createDelegateRoomTaskToolV1(
  options: CreateDelegateRoomTaskToolOptionsV1
): GovernedAgentTool<typeof DELEGATE_ROOM_TASK_PARAMETERS_V1> {
  return enforceGovernedAgentTool({
    name: 'delegate_room_task',
    label: 'Delegate Room Task',
    description:
      'Delegate a bounded part of the current Room request to another enabled Agent. Use the exact AgentProfile id present in trusted Room context. The server binds the source session, delivery, lease generation, root message, lineage, grant, and invocation budget.',
    confirmationPolicy: 'automatic',
    parameters: DELEGATE_ROOM_TASK_PARAMETERS_V1,
    safetyLevel: 'safe',
    writePolicy: 'organization-scoped-append',
    async execute(toolCallId, params) {
      const result = await (
        options.consumeDelegation ?? consumeRoomDelegationGrant
      )(
        {
          organizationId: options.organizationId,
          userId: options.actorUserId,
        },
        options.roomId,
        {
          instruction: params.instruction,
          invocationId: toolCallId,
          source: options.source,
          targetAgentId: params.targetAgentId,
        }
      );
      const summary =
        result.status === 'accepted'
          ? `Delegation ${result.invocationId} was accepted for Agent ${params.targetAgentId}.`
          : `Delegation ${result.invocationId} was blocked (${result.code}): ${result.message}`;
      return {
        content: [{ type: 'text', text: summary }],
        details: result,
      };
    },
  });
}
