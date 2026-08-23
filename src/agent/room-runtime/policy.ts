import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type RoomMessageEnvelopeV1,
  type RoomPolicyV1,
} from './contracts';

export const DEFAULT_ROOM_DELEGATION_MAX_HOPS = 3;
export const DEFAULT_ROOM_DELEGATION_MAX_INVOCATIONS = 8;

export type CreateQuietHostRoomPolicyInput = {
  hostAgentId: string;
  delegationEnabled?: boolean;
  maxHops?: number;
  maxInvocations?: number;
};

export function createQuietHostRoomPolicy(
  input: CreateQuietHostRoomPolicyInput
): RoomPolicyV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    participation: {
      mode: 'quiet-host',
      hostAgentId: input.hostAgentId,
      unmentionedHostAction: 'observe',
    },
    delegation: {
      enabled: input.delegationEnabled ?? true,
      maxHops: input.maxHops ?? DEFAULT_ROOM_DELEGATION_MAX_HOPS,
      maxInvocations:
        input.maxInvocations ?? DEFAULT_ROOM_DELEGATION_MAX_INVOCATIONS,
    },
  };
}

export type RoomParticipationDecisionV1 =
  | {
      action: 'respond';
      reason: 'typed-mention';
      mentionIndexes: readonly number[];
    }
  | {
      action: 'observe';
      reason: 'quiet-host-observation';
    }
  | {
      action: 'ignore';
      reason: 'not-addressed';
    };

/**
 * Resolves participation from already validated structured mentions. Raw
 * occurrences of `@handle` in message text never activate an agent.
 */
export function resolveRoomParticipation(params: {
  agentId: string;
  message: RoomMessageEnvelopeV1;
  policy: RoomPolicyV1;
}): RoomParticipationDecisionV1 {
  const mentionIndexes: number[] = [];

  params.message.mentions.forEach((mention, index) => {
    if (mention.agentId === params.agentId) {
      mentionIndexes.push(index);
    }
  });

  if (mentionIndexes.length > 0) {
    return {
      action: 'respond',
      reason: 'typed-mention',
      mentionIndexes,
    };
  }

  if (params.policy.participation.hostAgentId === params.agentId) {
    return {
      action: params.policy.participation.unmentionedHostAction,
      reason: 'quiet-host-observation',
    };
  }

  return {
    action: 'ignore',
    reason: 'not-addressed',
  };
}
