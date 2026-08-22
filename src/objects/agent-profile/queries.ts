import { NotFoundError, ValidationError } from '@/framework/resilience/app-error';
import { prisma } from '@/lib/db/prisma';

import { getAgentProfilePermissionsV1 } from './authorization';
import {
  mapAgentProfileV1,
  type AgentProfileActorV1,
  type AgentProfileDtoV1,
} from './schema';

export type ListAgentProfilesOptionsV1 = {
  includeDisabled?: boolean;
};

export async function listAgentProfilesV1(
  actor: AgentProfileActorV1,
  options: ListAgentProfilesOptionsV1 = {}
): Promise<{ agents: AgentProfileDtoV1[]; permissions: { canManage: boolean } }> {
  const permissions = await getAgentProfilePermissionsV1(actor);
  const agents = await prisma.agentProfile.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(options.includeDisabled ? {} : { enabled: true }),
    },
    orderBy: [{ builtin: 'desc' }, { name: 'asc' }, { handle: 'asc' }],
  });
  return { agents: agents.map(mapAgentProfileV1), permissions };
}

export async function getAgentProfileV1(
  actor: AgentProfileActorV1,
  agentId: string
): Promise<{ agent: AgentProfileDtoV1; permissions: { canManage: boolean } }> {
  const permissions = await getAgentProfilePermissionsV1(actor);
  const id = readId(agentId);
  const agent = await prisma.agentProfile.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (!agent) throw new NotFoundError('Agent not found.');
  return { agent: mapAgentProfileV1(agent), permissions };
}

function readId(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new ValidationError('agentId is required.');
  }
  return value.trim();
}
