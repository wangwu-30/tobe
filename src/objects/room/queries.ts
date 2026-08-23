import { NotFoundError, ValidationError } from '@/framework/resilience/app-error';
import { prisma } from '@/lib/db/prisma';

import {
  mapRoomEventV1,
  mapRoomMessageV1,
  mapRoomV1,
  type RoomActor,
  type RoomDtoV1,
  type RoomEventDtoV1,
  type RoomMessageDtoV1,
} from './schema';
import { resolveDefaultRoomKey } from './identity';

const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;

export async function getRoom(
  actor: Pick<RoomActor, 'organizationId'>,
  roomId: string
): Promise<RoomDtoV1 | null> {
  const room = await prisma.room.findFirst({
    where: { id: requiredId(roomId, 'roomId'), organizationId: actor.organizationId },
  });
  return room ? mapRoomV1(room) : null;
}

/** Resolves the default Room without creating or mutating any persisted fact. */
export async function getDefaultRoom(
  actor: Pick<RoomActor, 'organizationId'>,
  input: { projectId?: string | null } = {}
): Promise<RoomDtoV1 | null> {
  const projectId = nullableId(input.projectId, 'projectId');
  const room = await prisma.room.findUnique({
    where: {
      organizationId_key: {
        key: resolveDefaultRoomKey(projectId),
        organizationId: actor.organizationId,
      },
    },
  });
  return room ? mapRoomV1(room) : null;
}

export async function listRoomMessages(
  actor: Pick<RoomActor, 'organizationId'>,
  roomId: string,
  options: { after?: number; limit?: number } = {}
): Promise<RoomMessageDtoV1[]> {
  const id = requiredId(roomId, 'roomId');
  await requireRoom(actor, id);
  const after = readCursor(options.after);
  const limit = readLimit(options.limit);
  const messages = await prisma.roomMessage.findMany({
    where: {
      organizationId: actor.organizationId,
      roomId: id,
      sequence: { gt: after },
    },
    include: { mentions: true },
    orderBy: { sequence: 'asc' },
    take: limit,
  });
  const agentIds = [
    ...new Set(
      messages
        .filter((message) => message.actorType === 'agent')
        .map((message) => message.actorId)
    ),
  ];
  const agents = agentIds.length
    ? await prisma.agentProfile.findMany({
        where: { id: { in: agentIds }, organizationId: actor.organizationId },
        select: { handle: true, id: true },
      })
    : [];
  const handles = new Map(agents.map((agent) => [agent.id, agent.handle]));

  return messages.map((message) =>
    mapRoomMessageV1({
      ...message,
      actorHandle: handles.get(message.actorId),
    })
  );
}

export async function listRoomEvents(
  actor: Pick<RoomActor, 'organizationId'>,
  roomId: string,
  options: { after?: number; limit?: number } = {}
): Promise<RoomEventDtoV1[]> {
  const id = requiredId(roomId, 'roomId');
  await requireRoom(actor, id);
  const events = await prisma.roomEvent.findMany({
    where: {
      organizationId: actor.organizationId,
      roomId: id,
      sequence: { gt: readCursor(options.after) },
    },
    orderBy: { sequence: 'asc' },
    take: readLimit(options.limit),
  });
  return events.map(mapRoomEventV1);
}

async function requireRoom(
  actor: Pick<RoomActor, 'organizationId'>,
  roomId: string
) {
  const room = await prisma.room.findFirst({
    where: { id: roomId, organizationId: actor.organizationId },
    select: { id: true },
  });
  if (!room) throw new NotFoundError('Room not found.');
}

function readCursor(value: number | undefined) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError('after must be a non-negative integer.');
  }
  return value;
}

function readLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_LIMIT) {
    throw new ValidationError(
      `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}.`
    );
  }
  return value;
}

function requiredId(value: string, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function nullableId(value: string | null | undefined, field: string) {
  if (value === undefined || value === null) return null;
  return requiredId(value, field);
}
