import assert from 'node:assert/strict';
import { test } from '@playwright/test';

import {
  ROOM_RUNTIME_CONTRACT_VERSION_V1,
  type RoomMessageEnvelopeV1,
} from './contracts';
import {
  createQuietHostRoomPolicy,
  resolveRoomParticipation,
} from './policy';
import {
  guardRoomDelegation,
  validateTypedMentions,
} from './validation';

const agents = [
  {
    agentId: 'host',
    displayName: 'Host',
    handle: '@host',
    enabled: true,
  },
  {
    agentId: 'researcher',
    displayName: 'Researcher',
    handle: '@researcher',
    enabled: true,
  },
  {
    agentId: 'disabled',
    displayName: 'Disabled',
    handle: '@disabled',
    enabled: false,
  },
] as const;

function message(
  overrides: Partial<RoomMessageEnvelopeV1> = {}
): RoomMessageEnvelopeV1 {
  return {
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    envelopeType: 'room.message',
    messageId: 'message-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    sequence: 1,
    createdAt: '2026-08-21T00:00:00.000Z',
    actor: {
      type: 'human',
      userId: 'user-1',
    },
    text: 'Please ask @researcher',
    mentions: [
      {
        type: 'agent',
        agentId: 'researcher',
        handle: '@researcher',
        range: {
          start: 11,
          end: 22,
        },
      },
    ],
    attachments: [],
    ...overrides,
  };
}

test('validates typed mentions against text and the agent registry', () => {
  const input = message();
  const result = validateTypedMentions({
    message: input,
    mentionableAgents: agents,
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.mentions, input.mentions);
  assert.deepEqual(result.issues, []);
});

test('rejects spoofed, disabled, duplicate, and invalid-range mentions atomically', () => {
  const input = message({
    text: '@host @disabled @researcher',
    mentions: [
      {
        type: 'agent',
        agentId: 'researcher',
        handle: '@host',
        range: { start: 0, end: 5 },
      },
      {
        type: 'agent',
        agentId: 'disabled',
        handle: '@disabled',
        range: { start: 6, end: 15 },
      },
      {
        type: 'agent',
        agentId: 'disabled',
        handle: '@disabled',
        range: { start: 100, end: 110 },
      },
    ],
  });
  const result = validateTypedMentions({
    message: input,
    mentionableAgents: agents,
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.mentions, []);
  if (result.valid) {
    assert.fail('Expected mention validation to fail.');
  }
  assert.deepEqual(
    new Set(result.issues.map((issue) => issue.code)),
    new Set([
      'handle-not-owned-by-agent',
      'disabled-agent',
      'invalid-range',
      'duplicate-agent',
    ])
  );
});

test('quiet host observes while only a typed mention causes a response', () => {
  const policy = createQuietHostRoomPolicy({ hostAgentId: 'host' });
  const rawTextOnly = message({
    text: 'Please ask @host',
    mentions: [],
  });

  assert.deepEqual(
    resolveRoomParticipation({
      agentId: 'host',
      message: rawTextOnly,
      policy,
    }),
    {
      action: 'observe',
      reason: 'quiet-host-observation',
    }
  );
  assert.deepEqual(
    resolveRoomParticipation({
      agentId: 'researcher',
      message: message(),
      policy,
    }),
    {
      action: 'respond',
      reason: 'typed-mention',
      mentionIndexes: [0],
    }
  );
  assert.deepEqual(
    resolveRoomParticipation({
      agentId: 'disabled',
      message: rawTextOnly,
      policy,
    }),
    {
      action: 'ignore',
      reason: 'not-addressed',
    }
  );
});

test('allows a delegation and returns a new immutable trace', () => {
  const policy = createQuietHostRoomPolicy({
    hostAgentId: 'host',
    maxHops: 2,
    maxInvocations: 4,
  });
  const trace = {
    rootMessageId: 'message-1',
    lineage: ['host'],
    invocations: [],
  } as const;
  const invocation = {
    invocationId: 'invocation-1',
    rootMessageId: 'message-1',
    fromAgentId: 'host',
    targetAgentId: 'researcher',
  };
  const result = guardRoomDelegation({ invocation, policy, trace });

  assert.equal(result.allowed, true);
  if (!result.allowed) {
    assert.fail('Expected delegation to be allowed.');
  }
  assert.deepEqual(result.nextTrace.lineage, ['host', 'researcher']);
  assert.deepEqual(result.nextTrace.invocations, [invocation]);
  assert.deepEqual(trace, {
    rootMessageId: 'message-1',
    lineage: ['host'],
    invocations: [],
  });
});

test('blocks cycles and enforces hop and root invocation budgets', () => {
  const invocation = {
    invocationId: 'invocation-3',
    rootMessageId: 'message-1',
    fromAgentId: 'reviewer',
    targetAgentId: 'host',
  };
  const baseTrace = {
    rootMessageId: 'message-1',
    lineage: ['host', 'researcher', 'reviewer'],
    invocations: [
      {
        invocationId: 'invocation-1',
        rootMessageId: 'message-1',
        fromAgentId: 'host',
        targetAgentId: 'researcher',
      },
      {
        invocationId: 'invocation-2',
        rootMessageId: 'message-1',
        fromAgentId: 'researcher',
        targetAgentId: 'reviewer',
      },
    ],
  } as const;

  const cycle = guardRoomDelegation({
    invocation,
    policy: createQuietHostRoomPolicy({
      hostAgentId: 'host',
      maxHops: 4,
      maxInvocations: 4,
    }),
    trace: baseTrace,
  });
  assert.equal(cycle.allowed, false);
  if (cycle.allowed) {
    assert.fail('Expected cycle detection to reject the delegation.');
  }
  assert.equal(cycle.code, 'cycle-detected');

  const maxHops = guardRoomDelegation({
    invocation: { ...invocation, targetAgentId: 'writer' },
    policy: createQuietHostRoomPolicy({
      hostAgentId: 'host',
      maxHops: 2,
      maxInvocations: 4,
    }),
    trace: baseTrace,
  });
  assert.equal(maxHops.allowed, false);
  if (maxHops.allowed) {
    assert.fail('Expected the hop budget to reject the delegation.');
  }
  assert.equal(maxHops.code, 'max-hops-reached');

  const maxInvocations = guardRoomDelegation({
    invocation: { ...invocation, targetAgentId: 'writer' },
    policy: createQuietHostRoomPolicy({
      hostAgentId: 'host',
      maxHops: 4,
      maxInvocations: 2,
    }),
    trace: baseTrace,
  });
  assert.equal(maxInvocations.allowed, false);
  if (maxInvocations.allowed) {
    assert.fail('Expected the invocation budget to reject the delegation.');
  }
  assert.equal(maxInvocations.code, 'max-invocations-reached');
});

test('rejects duplicate delegation invocation ids', () => {
  const existing = {
    invocationId: 'invocation-1',
    rootMessageId: 'message-1',
    fromAgentId: 'host',
    targetAgentId: 'researcher',
  };
  const result = guardRoomDelegation({
    invocation: {
      ...existing,
      fromAgentId: 'researcher',
      targetAgentId: 'writer',
    },
    policy: createQuietHostRoomPolicy({
      hostAgentId: 'host',
      maxHops: 3,
      maxInvocations: 4,
    }),
    trace: {
      rootMessageId: 'message-1',
      lineage: ['host', 'researcher'],
      invocations: [existing],
    },
  });

  assert.equal(result.allowed, false);
  if (result.allowed) {
    assert.fail('Expected duplicate invocation id to be rejected.');
  }
  assert.equal(result.code, 'duplicate-invocation-id');
});
