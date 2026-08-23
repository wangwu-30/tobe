import type { RoomEventDtoV1, RoomMessageDtoV1 } from '@/objects/room';
import { isRecord } from '@/framework/resilience';

import type { RoomAgent } from './client';

export type RoomAgentActivityState =
  | 'idle'
  | 'observing'
  | 'recent'
  | 'responding';

export type RoomAgentActivity = {
  agent: RoomAgent;
  deliverySequence: number | null;
  isCoordinator: boolean;
  lastActivityAt: string | null;
  roomSessionId: string | null;
  source: 'event' | 'message' | 'none';
  state: RoomAgentActivityState;
};

/**
 * Presence is intentionally inferred from public durable data. The Room API
 * does not expose host leases, so this never labels an agent as online.
 */
export function deriveRoomAgentActivity(input: {
  agents: readonly RoomAgent[];
  events: readonly RoomEventDtoV1[];
  hostAgentId: string | null;
  messages: readonly RoomMessageDtoV1[];
}): RoomAgentActivity[] {
  const activity = new Map<string, RoomAgentActivity>();
  input.agents.forEach((agent) => {
    activity.set(agent.id, {
      agent,
      deliverySequence: null,
      isCoordinator: agent.id === input.hostAgentId,
      lastActivityAt: null,
      roomSessionId: null,
      source: 'none',
      state: 'idle',
    });
  });

  [...input.events]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((event) => {
      if (event.type !== 'message.accepted' || !isRecord(event.data)) return;
      const deliveries = Array.isArray(event.data.deliveries)
        ? event.data.deliveries
        : [];
      deliveries.forEach((delivery) => {
        if (!isRecord(delivery)) return;
        const target = isRecord(delivery.target) ? delivery.target : null;
        const agentId =
          readString(delivery.targetAgentId) ||
          (target ? readString(target.agentId) : null);
        if (!agentId) return;
        const current = activity.get(agentId);
        if (!current) return;

        activity.set(agentId, {
          ...current,
          deliverySequence: readInteger(delivery.deliverySequence),
          lastActivityAt: event.createdAt,
          roomSessionId: readString(delivery.roomSessionId),
          source: 'event',
          state: delivery.intent === 'respond' ? 'responding' : 'observing',
        });
      });
    });

  [...input.messages]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((message) => {
      if (message.actor.type !== 'agent') return;
      const current = activity.get(message.actor.agentId);
      if (!current || isAfter(current.lastActivityAt, message.createdAt)) return;
      activity.set(message.actor.agentId, {
        ...current,
        lastActivityAt: message.createdAt,
        source: 'message',
        state: 'recent',
      });
    });

  return [...activity.values()].sort((left, right) => {
    if (left.isCoordinator !== right.isCoordinator) {
      return left.isCoordinator ? -1 : 1;
    }
    const leftTime = Date.parse(left.lastActivityAt || '') || 0;
    const rightTime = Date.parse(right.lastActivityAt || '') || 0;
    return rightTime - leftTime || left.agent.name.localeCompare(right.agent.name);
  });
}

function readString(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

function readInteger(value: unknown) {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function isAfter(current: string | null, candidate: string) {
  if (!current) return false;
  return Date.parse(current) > Date.parse(candidate);
}
