import { ForbiddenError } from '@/framework/resilience/app-error';
import { prisma } from '@/lib/db/prisma';

import type { AgentProfileActorV1 } from './schema';

export type AgentProfilePermissionsV1 = {
  canManage: boolean;
};

export async function getAgentProfilePermissionsV1(
  actor: AgentProfileActorV1
): Promise<AgentProfilePermissionsV1> {
  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: actor.organizationId,
        userId: actor.userId,
      },
    },
    select: { role: true },
  });
  if (!membership) {
    throw new ForbiddenError('Organization membership is required to view Agents.');
  }
  return { canManage: membership.role === 'owner' };
}

export async function requireAgentProfileOwnerV1(
  actor: AgentProfileActorV1
): Promise<void> {
  const permissions = await getAgentProfilePermissionsV1(actor);
  if (!permissions.canManage) {
    throw new ForbiddenError('Only organization owners can manage Agents.');
  }
}
