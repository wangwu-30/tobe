import { prisma } from '@/lib/db/prisma';
import type { AgentProfileData } from '@/types';
import { mapAgentProfile, type TaskActor } from './schema';
import {
  BUILTIN_ASSISTANT_PROFILE_V1,
  ensureBuiltinAgentProfileV1,
} from '@/objects/agent-profile';

export async function ensureBuiltinAgentProfiles(
  actor: Pick<TaskActor, 'organizationId'>
): Promise<AgentProfileData[]> {
  // Keep the legacy task-facing projection while centralizing the persisted
  // built-in definition and protection rules in the AgentProfile object.
  await ensureBuiltinAgentProfileV1(actor);
  const profiles = await prisma.agentProfile.findMany({
    where: {
      organizationId: actor.organizationId,
      handle: BUILTIN_ASSISTANT_PROFILE_V1.handle,
    },
  });
  return profiles.map(mapAgentProfile);
}

export async function listAgentProfiles(
  actor: Pick<TaskActor, 'organizationId'>
): Promise<AgentProfileData[]> {
  await ensureBuiltinAgentProfiles(actor);
  const agents = await prisma.agentProfile.findMany({
    where: {
      enabled: true,
      organizationId: actor.organizationId,
    },
    orderBy: [
      { builtin: 'desc' },
      { name: 'asc' },
    ],
  });

  return agents.map(mapAgentProfile);
}
