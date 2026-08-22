import { expect, test } from '@playwright/test';
import type { RoomEventDtoV1, RoomMessageDtoV1 } from '@/objects/room';

import { deriveRoomAgentActivity } from './activity';
import type { RoomAgent } from './client';

const agents: RoomAgent[] = [
  {
    builtin: true,
    description: 'Coordinates',
    enabled: true,
    handle: '@coordinator',
    id: 'host',
    name: 'Coordinator',
    skills: [],
  },
  {
    builtin: false,
    description: 'Researches',
    enabled: true,
    handle: '@researcher',
    id: 'researcher',
    name: 'Researcher',
    skills: [],
  },
];

test('derives session activity without claiming authoritative online presence', () => {
  const event = {
    createdAt: '2026-08-21T10:00:00.000Z',
    data: {
      deliveries: [
        {
          deliverySequence: 4,
          intent: 'observe',
          roomSessionId: 'session-host',
          targetAgentId: 'host',
        },
        {
          deliverySequence: 8,
          intent: 'respond',
          roomSessionId: 'session-researcher',
          targetAgentId: 'researcher',
        },
      ],
    },
    eventId: 'event-1',
    organizationId: 'org-1',
    roomId: 'room-1',
    schemaVersion: 1,
    sequence: 1,
    type: 'message.accepted',
  } as RoomEventDtoV1;

  const activity = deriveRoomAgentActivity({
    agents,
    events: [event],
    hostAgentId: 'host',
    messages: [],
  });

  expect(activity.map((item) => item.agent.id)).toEqual(['host', 'researcher']);
  expect(activity[0]).toMatchObject({
    deliverySequence: 4,
    isCoordinator: true,
    roomSessionId: 'session-host',
    source: 'event',
    state: 'observing',
  });
  expect(activity[1]).toMatchObject({
    deliverySequence: 8,
    roomSessionId: 'session-researcher',
    state: 'responding',
  });
});

test('a later agent message replaces responding with recent activity', () => {
  const message = {
    actor: {
      agentId: 'researcher',
      displayName: 'Researcher',
      handle: '@researcher',
      type: 'agent',
    },
    attachments: [],
    createdAt: '2026-08-21T10:01:00.000Z',
    envelopeType: 'room.message',
    mentions: [],
    messageId: 'message-2',
    organizationId: 'org-1',
    roomId: 'room-1',
    schemaVersion: 1,
    sequence: 2,
    text: 'Research complete.',
  } as RoomMessageDtoV1;

  const activity = deriveRoomAgentActivity({
    agents,
    events: [],
    hostAgentId: 'host',
    messages: [message],
  });

  expect(activity.find((item) => item.agent.id === 'researcher')).toMatchObject({
    lastActivityAt: '2026-08-21T10:01:00.000Z',
    source: 'message',
    state: 'recent',
  });
});
