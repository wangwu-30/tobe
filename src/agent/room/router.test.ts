import { expect, test } from '@playwright/test';

import type { RoomAgentMentionV1 } from '@/agent/room-runtime';

import { planRoomDeliveriesV1 } from './router';

const host = {
  agentId: 'host',
  displayName: 'Coordinator',
  enabled: true,
  handle: '@host',
} as const;
const researcher = {
  agentId: 'researcher',
  displayName: 'Researcher',
  enabled: true,
  handle: '@researcher',
} as const;
const reviewer = {
  agentId: 'reviewer',
  displayName: 'Reviewer',
  enabled: true,
  handle: '@reviewer',
} as const;
const agents = [host, researcher, reviewer] as const;
const human = { type: 'human', userId: 'user-1' } as const;

test('routes a default unaddressed message to the coordinator without inferring raw @text', () => {
  const result = planRoomDeliveriesV1({
    actor: human,
    hostAgentId: host.agentId,
    mentionableAgents: agents,
    mentions: [],
    text: 'Please ask @researcher, but this is ordinary text.',
  });

  expect(result).toEqual({
    accepted: true,
    mentions: [],
    deliveries: [
      {
        cause: { type: 'system', reason: 'unmentioned-coordinator' },
        intent: 'respond',
        target: {
          agentId: host.agentId,
          displayName: host.displayName,
          handle: host.handle,
        },
      },
    ],
  });
});

test('routes multiple typed mentions to responders and the quiet host as observer', () => {
  const text = '@researcher please pair with @reviewer';
  const mentions: RoomAgentMentionV1[] = [
    mention(researcher, 0, 11),
    mention(reviewer, 29, 38),
  ];
  const result = planRoomDeliveriesV1({
    actor: human,
    hostAgentId: host.agentId,
    mentionableAgents: agents,
    mentions,
    text,
  });

  expect(result.accepted).toBe(true);
  if (!result.accepted) return;
  expect(result.deliveries.map(compactDelivery)).toEqual([
    ['researcher', 'respond', 'typed-mention'],
    ['reviewer', 'respond', 'typed-mention'],
    ['host', 'observe', 'room-observation'],
  ]);
});

test('does not add an observation when the host itself is explicitly mentioned', () => {
  const result = planRoomDeliveriesV1({
    actor: human,
    hostAgentId: host.agentId,
    mentionableAgents: agents,
    mentions: [mention(host, 0, 5)],
    text: '@host',
  });

  expect(result.accepted).toBe(true);
  if (!result.accepted) return;
  expect(result.deliveries.map(compactDelivery)).toEqual([
    ['host', 'respond', 'typed-mention'],
  ]);
});

test('routes a reply to its agent author and lets a different host observe', () => {
  const result = planRoomDeliveriesV1({
    actor: human,
    hostAgentId: host.agentId,
    mentionableAgents: agents,
    mentions: [],
    replyTo: {
      actor: {
        type: 'agent',
        agentId: researcher.agentId,
        displayName: researcher.displayName,
        handle: researcher.handle,
      },
      messageId: 'agent-message',
    },
    text: 'Could you expand on that?',
  });

  expect(result.accepted).toBe(true);
  if (!result.accepted) return;
  expect(result.deliveries.map(compactDelivery)).toEqual([
    ['researcher', 'respond', 'system'],
    ['host', 'observe', 'room-observation'],
  ]);
  expect(result.deliveries[0]?.cause).toEqual({
    type: 'system',
    reason: 'reply-to-agent',
  });
});

test('rejects an invalid mention set without producing partial deliveries', () => {
  const result = planRoomDeliveriesV1({
    actor: human,
    hostAgentId: host.agentId,
    mentionableAgents: agents,
    mentions: [
      mention(researcher, 0, 11),
      mention(researcher, 16, 27),
    ],
    text: '@researcher and @researcher',
  });

  expect(result.accepted).toBe(false);
  if (result.accepted) return;
  expect(result.issues.some((issue) => issue.code === 'duplicate-agent')).toBe(
    true
  );
  expect('deliveries' in result).toBe(false);
});

function mention(
  agent: { agentId: string; handle: string },
  start: number,
  end: number
): RoomAgentMentionV1 {
  return {
    type: 'agent',
    agentId: agent.agentId,
    handle: agent.handle,
    range: { start, end },
  };
}

function compactDelivery(delivery: {
  cause: { type: string };
  intent: string;
  target: { agentId: string };
}) {
  return [delivery.target.agentId, delivery.intent, delivery.cause.type];
}
