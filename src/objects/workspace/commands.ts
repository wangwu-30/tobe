import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/db/prisma';
import { mapWorkspaceEditLock } from './view';

type WorkspaceActorContext = {
  deviceId: string;
  organizationId: string;
  userId: string;
};

type LockConflict = {
  expiresAt: Date;
  userId: string;
  workspaceId: string;
};

export class WorkspaceLockConflictError extends Error {
  readonly detail: LockConflict;

  constructor(detail: LockConflict) {
    super('Workspace is locked by another user.');
    this.detail = detail;
  }
}

export async function acquireWorkspaceLock(
  actor: WorkspaceActorContext,
  input: {
    lockedVersionId?: string | null;
    ttlMinutes?: number;
    workspaceId: string;
  }
) {
  const existing = await prisma.wikiEditLock.findUnique({
    where: { documentId: input.workspaceId },
  });

  const expiresAt = new Date(Date.now() + (input.ttlMinutes || 15) * 60_000);

  if (existing && existing.expiresAt > new Date() && existing.userId !== actor.userId) {
    throw new WorkspaceLockConflictError({
      expiresAt: existing.expiresAt,
      userId: existing.userId,
      workspaceId: input.workspaceId,
    });
  }

  let lock;
  if (existing) {
    lock = await prisma.wikiEditLock.update({
      where: { documentId: input.workspaceId },
      data: {
        expiresAt,
        lockedVersionId: input.lockedVersionId || null,
        originDeviceId: actor.deviceId,
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
    });
  } else {
    try {
      lock = await prisma.wikiEditLock.create({
        data: {
          organizationId: actor.organizationId,
          documentId: input.workspaceId,
          expiresAt,
          lockedVersionId: input.lockedVersionId || null,
          originDeviceId: actor.deviceId,
          userId: actor.userId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const racedLock = await prisma.wikiEditLock.findUnique({
          where: { documentId: input.workspaceId },
        });

        if (
          racedLock &&
          racedLock.expiresAt > new Date() &&
          racedLock.userId !== actor.userId
        ) {
          throw new WorkspaceLockConflictError({
            expiresAt: racedLock.expiresAt,
            userId: racedLock.userId,
            workspaceId: input.workspaceId,
          });
        }

        lock = await prisma.wikiEditLock.update({
          where: { documentId: input.workspaceId },
          data: {
            expiresAt,
            lockedVersionId: input.lockedVersionId || null,
            originDeviceId: actor.deviceId,
            organizationId: actor.organizationId,
            userId: actor.userId,
          },
        });
      } else {
        throw error;
      }
    }
  }

  return mapWorkspaceEditLock(lock);
}

export async function releaseWorkspaceLock(
  actor: WorkspaceActorContext,
  workspaceId: string
) {
  const existing = await prisma.wikiEditLock.findUnique({
    where: { documentId: workspaceId },
  });

  if (!existing) {
    return { released: false };
  }

  if (existing.userId !== actor.userId) {
    throw new WorkspaceLockConflictError({
      expiresAt: existing.expiresAt,
      userId: existing.userId,
      workspaceId,
    });
  }

  await prisma.wikiEditLock.delete({
    where: { documentId: workspaceId },
  });

  return { released: true };
}

export async function ensureWorkspaceEditable(
  actor: WorkspaceActorContext,
  workspaceId: string
) {
  const existing = await prisma.wikiEditLock.findUnique({
    where: { documentId: workspaceId },
  });

  if (!existing || existing.expiresAt <= new Date()) {
    await acquireWorkspaceLock(actor, { workspaceId });
    return;
  }

  if (existing.userId !== actor.userId) {
    throw new WorkspaceLockConflictError({
      expiresAt: existing.expiresAt,
      userId: existing.userId,
      workspaceId,
    });
  }

  if (existing.originDeviceId !== actor.deviceId) {
    await prisma.wikiEditLock.update({
      where: { documentId: workspaceId },
      data: {
        expiresAt: new Date(Date.now() + 15 * 60_000),
        originDeviceId: actor.deviceId,
      },
    });
  }
}
