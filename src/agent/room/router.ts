import type {
  RoomAgentMentionV1,
  RoomAgentRefV1,
  RoomActorRefV1,
  RoomDeliveryCauseV1,
  RoomMentionableAgentV1,
} from '@/agent/room-runtime';
import { validateTypedMentions } from '@/agent/room-runtime';
import type { TypedMentionValidationIssueV1 } from '@/agent/room-runtime';

export type RoomReplyTargetV1 = {
  actor: RoomActorRefV1;
  messageId: string;
};

export type PlannedRoomDeliveryV1 = {
  cause: RoomDeliveryCauseV1;
  intent: 'observe' | 'respond';
  target: RoomAgentRefV1;
};

export type RoomRoutingResultV1 =
  | {
      accepted: true;
      deliveries: readonly PlannedRoomDeliveryV1[];
      mentions: readonly RoomAgentMentionV1[];
    }
  | {
      accepted: false;
      issues: readonly TypedMentionValidationIssueV1[];
    };

/**
 * Computes delivery targets exclusively from structured routing data. Text is
 * deliberately absent from every decision except typed-mention validation, so
 * an ordinary `@handle` substring can never activate an agent.
 */
export function planRoomDeliveriesV1(params: {
  actor: RoomActorRefV1;
  hostAgentId: string;
  mentionableAgents: readonly RoomMentionableAgentV1[];
  mentions: readonly RoomAgentMentionV1[];
  replyTo?: RoomReplyTargetV1 | null;
  text: string;
}): RoomRoutingResultV1 {
  const mentionValidation = validateTypedMentions({
    mentionableAgents: params.mentionableAgents,
    message: { mentions: params.mentions, text: params.text },
  });
  if (!mentionValidation.valid) {
    return { accepted: false, issues: mentionValidation.issues };
  }

  const enabledAgents = new Map(
    params.mentionableAgents
      .filter((agent) => agent.enabled)
      .map((agent) => [agent.agentId, agent])
  );
  const host = enabledAgents.get(params.hostAgentId);
  if (!host) {
    return {
      accepted: false,
      issues: [
        {
          code: 'unknown-agent',
          mentionIndex: -1,
          message: 'The room host agent is unavailable.',
        },
      ],
    };
  }

  const deliveries = new Map<string, PlannedRoomDeliveryV1>();
  const mentionIndexesByAgent = new Map<string, number[]>();
  mentionValidation.mentions.forEach((mention, mentionIndex) => {
    const indexes = mentionIndexesByAgent.get(mention.agentId) || [];
    indexes.push(mentionIndex);
    mentionIndexesByAgent.set(mention.agentId, indexes);
  });

  for (const [agentId, mentionIndexes] of mentionIndexesByAgent) {
    const agent = enabledAgents.get(agentId);
    // The validation above guarantees this lookup. Keeping the guard makes the
    // router total if an alternate validator is supplied in the future.
    if (!agent) continue;
    deliveries.set(agentId, {
      cause: { type: 'typed-mention', mentionIndexes },
      intent: 'respond',
      target: toAgentRef(agent),
    });
  }

  const replyAgentId =
    params.replyTo?.actor.type === 'agent'
      ? params.replyTo.actor.agentId
      : null;
  if (replyAgentId && !deliveries.has(replyAgentId)) {
    const replyAgent = enabledAgents.get(replyAgentId);
    if (!replyAgent) {
      return {
        accepted: false,
        issues: [
          {
            code: 'unknown-agent',
            mentionIndex: -1,
            message: 'The replied-to agent is unavailable.',
          },
        ],
      };
    }
    deliveries.set(replyAgentId, {
      cause: { type: 'system', reason: 'reply-to-agent' },
      intent: 'respond',
      target: toAgentRef(replyAgent),
    });
  }

  const hasExplicitRespondent = deliveries.size > 0;
  const actorIsHost =
    params.actor.type === 'agent' && params.actor.agentId === host.agentId;
  if (!deliveries.has(host.agentId) && !actorIsHost) {
    deliveries.set(host.agentId, {
      cause: hasExplicitRespondent
        ? { type: 'room-observation' }
        : { type: 'system', reason: 'unmentioned-coordinator' },
      intent: hasExplicitRespondent ? 'observe' : 'respond',
      target: toAgentRef(host),
    });
  }

  return {
    accepted: true,
    deliveries: [...deliveries.values()],
    mentions: mentionValidation.mentions,
  };
}

function toAgentRef(agent: RoomMentionableAgentV1): RoomAgentRefV1 {
  return {
    agentId: agent.agentId,
    ...(agent.displayName ? { displayName: agent.displayName } : {}),
    handle: agent.handle,
  };
}
