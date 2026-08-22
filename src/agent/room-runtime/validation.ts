import type {
  RoomAgentMentionV1,
  RoomDelegationInvocationV1,
  RoomDelegationTraceV1,
  RoomMentionableAgentV1,
  RoomMessageEnvelopeV1,
  RoomPolicyV1,
} from './contracts';

export type TypedMentionValidationCodeV1 =
  | 'invalid-range'
  | 'handle-mismatch'
  | 'unknown-agent'
  | 'disabled-agent'
  | 'handle-not-owned-by-agent'
  | 'duplicate-agent';

export type TypedMentionValidationIssueV1 = {
  code: TypedMentionValidationCodeV1;
  mentionIndex: number;
  message: string;
};

export type TypedMentionValidationResultV1 =
  | {
      valid: true;
      mentions: readonly RoomAgentMentionV1[];
      issues: readonly [];
    }
  | {
      valid: false;
      mentions: readonly [];
      issues: readonly TypedMentionValidationIssueV1[];
    };

function normalizeHandle(handle: string) {
  return handle.trim().toLowerCase();
}

/**
 * Validates structured mentions against message text and an authoritative
 * agent registry. Invalid input is rejected atomically so callers never route
 * a partially valid mention set.
 */
export function validateTypedMentions(params: {
  message: Pick<RoomMessageEnvelopeV1, 'mentions' | 'text'>;
  mentionableAgents: readonly RoomMentionableAgentV1[];
}): TypedMentionValidationResultV1 {
  const agentsById = new Map(
    params.mentionableAgents.map((agent) => [agent.agentId, agent])
  );
  const seenAgentIds = new Set<string>();
  const issues: TypedMentionValidationIssueV1[] = [];

  params.message.mentions.forEach((mention, mentionIndex) => {
    const validRange =
      Number.isInteger(mention.range.start) &&
      Number.isInteger(mention.range.end) &&
      mention.range.start >= 0 &&
      mention.range.end > mention.range.start &&
      mention.range.end <= params.message.text.length;

    if (!validRange) {
      issues.push({
        code: 'invalid-range',
        mentionIndex,
        message: `Mention ${mentionIndex} has a range outside the message text.`,
      });
    } else {
      const mentionedText = params.message.text.slice(
        mention.range.start,
        mention.range.end
      );
      if (normalizeHandle(mentionedText) !== normalizeHandle(mention.handle)) {
        issues.push({
          code: 'handle-mismatch',
          mentionIndex,
          message: `Mention ${mentionIndex} does not match its text range.`,
        });
      }
    }

    const agent = agentsById.get(mention.agentId);
    if (!agent) {
      issues.push({
        code: 'unknown-agent',
        mentionIndex,
        message: `Mention ${mentionIndex} targets an unknown agent.`,
      });
    } else {
      if (!agent.enabled) {
        issues.push({
          code: 'disabled-agent',
          mentionIndex,
          message: `Mention ${mentionIndex} targets a disabled agent.`,
        });
      }
      if (normalizeHandle(agent.handle) !== normalizeHandle(mention.handle)) {
        issues.push({
          code: 'handle-not-owned-by-agent',
          mentionIndex,
          message: `Mention ${mentionIndex} uses a handle not owned by its target agent.`,
        });
      }
    }

    if (seenAgentIds.has(mention.agentId)) {
      issues.push({
        code: 'duplicate-agent',
        mentionIndex,
        message: `Mention ${mentionIndex} repeats an agent already addressed by this message.`,
      });
    }
    seenAgentIds.add(mention.agentId);
  });

  if (issues.length > 0) {
    return {
      valid: false,
      mentions: [],
      issues,
    };
  }

  return {
    valid: true,
    // Persist and emit the registry-owned spelling. Identity comparison is
    // intentionally case-insensitive for user input, but client-provided
    // casing/whitespace must never become the authoritative agent handle.
    mentions: params.message.mentions.map((mention) => ({
      ...mention,
      handle: agentsById.get(mention.agentId)!.handle,
    })),
    issues: [],
  };
}

export type RoomDelegationRejectionCodeV1 =
  | 'delegation-disabled'
  | 'invalid-policy-limit'
  | 'root-message-mismatch'
  | 'empty-lineage'
  | 'actor-not-lineage-tail'
  | 'self-delegation'
  | 'cycle-detected'
  | 'max-hops-reached'
  | 'max-invocations-reached'
  | 'duplicate-invocation-id'
  | 'duplicate-delegation';

export type RoomDelegationDecisionV1 =
  | {
      allowed: true;
      nextTrace: RoomDelegationTraceV1;
    }
  | {
      allowed: false;
      code: RoomDelegationRejectionCodeV1;
      message: string;
    };

function rejectDelegation(
  code: RoomDelegationRejectionCodeV1,
  message: string
): RoomDelegationDecisionV1 {
  return {
    allowed: false,
    code,
    message,
  };
}

/**
 * Applies delegation limits without side effects. Invocation count is scoped
 * to the root message, while hop count and cycle detection use this branch's
 * lineage.
 */
export function guardRoomDelegation(params: {
  invocation: RoomDelegationInvocationV1;
  policy: RoomPolicyV1;
  trace: RoomDelegationTraceV1;
}): RoomDelegationDecisionV1 {
  const { invocation, policy, trace } = params;

  if (!policy.delegation.enabled) {
    return rejectDelegation(
      'delegation-disabled',
      'Room policy does not allow agent delegation.'
    );
  }

  if (
    !Number.isInteger(policy.delegation.maxHops) ||
    policy.delegation.maxHops < 1 ||
    !Number.isInteger(policy.delegation.maxInvocations) ||
    policy.delegation.maxInvocations < 1
  ) {
    return rejectDelegation(
      'invalid-policy-limit',
      'Delegation limits must be positive integers.'
    );
  }

  if (
    trace.rootMessageId !== invocation.rootMessageId ||
    trace.invocations.some(
      (existing) => existing.rootMessageId !== trace.rootMessageId
    )
  ) {
    return rejectDelegation(
      'root-message-mismatch',
      'Delegation trace and invocation must share one root message.'
    );
  }

  if (trace.lineage.length === 0) {
    return rejectDelegation(
      'empty-lineage',
      'Delegation lineage must contain the invoking agent.'
    );
  }

  if (trace.lineage[trace.lineage.length - 1] !== invocation.fromAgentId) {
    return rejectDelegation(
      'actor-not-lineage-tail',
      'Only the current lineage tail may delegate.'
    );
  }

  if (invocation.fromAgentId === invocation.targetAgentId) {
    return rejectDelegation(
      'self-delegation',
      'An agent cannot delegate to itself.'
    );
  }

  if (trace.lineage.includes(invocation.targetAgentId)) {
    return rejectDelegation(
      'cycle-detected',
      'Delegation would revisit an agent in the current lineage.'
    );
  }

  const completedHops = trace.lineage.length - 1;
  if (completedHops >= policy.delegation.maxHops) {
    return rejectDelegation(
      'max-hops-reached',
      'Delegation would exceed the maximum hop count.'
    );
  }

  if (trace.invocations.length >= policy.delegation.maxInvocations) {
    return rejectDelegation(
      'max-invocations-reached',
      'Delegation would exceed the root message invocation budget.'
    );
  }

  if (
    trace.invocations.some(
      (existing) => existing.invocationId === invocation.invocationId
    )
  ) {
    return rejectDelegation(
      'duplicate-invocation-id',
      'Delegation invocation id has already been processed.'
    );
  }

  if (
    trace.invocations.some(
      (existing) =>
        existing.fromAgentId === invocation.fromAgentId &&
        existing.targetAgentId === invocation.targetAgentId
    )
  ) {
    return rejectDelegation(
      'duplicate-delegation',
      'The same source and target delegation has already been invoked.'
    );
  }

  return {
    allowed: true,
    nextTrace: {
      rootMessageId: trace.rootMessageId,
      lineage: [...trace.lineage, invocation.targetAgentId],
      invocations: [...trace.invocations, invocation],
    },
  };
}
