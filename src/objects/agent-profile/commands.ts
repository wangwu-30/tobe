import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/framework/resilience/app-error';
import { isRecord } from '@/framework/resilience/safe-data';
import { prisma } from '@/lib/db/prisma';

import { requireAgentProfileOwnerV1 } from './authorization';
import {
  BUILTIN_ASSISTANT_PROFILE_V1,
  DEFAULT_AGENT_PROFILE_CONFIG_V1,
  builtinAssistantProfileIdV1,
  mapAgentProfileV1,
  normalizeAgentHandleV1,
  serializeAgentCapabilitiesV1,
  serializeAgentConfigV1,
  type AgentProfileActorV1,
  type AgentProfileDtoV1,
  type CreateAgentProfileInputV1,
  type UpdateAgentProfileInputV1,
} from './schema';

export async function ensureBuiltinAgentProfileV1(
  actor: Pick<AgentProfileActorV1, 'organizationId'>
): Promise<AgentProfileDtoV1> {
  const definition = BUILTIN_ASSISTANT_PROFILE_V1;
  const id = builtinAssistantProfileIdV1(actor.organizationId);
  const byId = await prisma.agentProfile.findUnique({ where: { id } });
  if (byId && byId.organizationId !== actor.organizationId) {
    throw new ConflictError('The built-in Agent identity belongs to another organization.');
  }
  if (!byId) {
    const reservedHandle = await prisma.agentProfile.findUnique({
      where: {
        organizationId_handle: {
          organizationId: actor.organizationId,
          handle: definition.handle,
        },
      },
      select: { id: true },
    });
    if (reservedHandle) {
      throw new ConflictError(
        `Agent handle ${definition.handle} is reserved for the built-in Agent.`
      );
    }
    try {
      return mapAgentProfileV1(
        await prisma.agentProfile.create({
          data: {
            id,
            organizationId: actor.organizationId,
            handle: definition.handle,
            name: definition.name,
            description: definition.description,
            skillsJson: JSON.stringify(definition.capabilities.skills),
            capabilitiesJson: serializeAgentCapabilitiesV1(definition.capabilities),
            configJson: serializeAgentConfigV1(definition.config),
            enabled: true,
            builtin: true,
          },
        })
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        // Another request may have installed the same canonical built-in.
        return ensureBuiltinAgentProfileV1(actor);
      }
      throw error;
    }
  }

  if (byId.handle === definition.handle && byId.builtin && byId.enabled) {
    return mapAgentProfileV1(byId);
  }

  const reservedHandle = await prisma.agentProfile.findUnique({
    where: {
      organizationId_handle: {
        organizationId: actor.organizationId,
        handle: definition.handle,
      },
    },
    select: { id: true },
  });
  if (reservedHandle && reservedHandle.id !== id) {
    throw new ConflictError(
      `Agent handle ${definition.handle} is reserved for the built-in Agent.`
    );
  }
  const repaired = await prisma.agentProfile.updateMany({
    where: {
      id,
      organizationId: actor.organizationId,
      revision: byId.revision,
    },
    data: {
      builtin: true,
      enabled: true,
      handle: definition.handle,
      revision: { increment: 1 },
    },
  });
  if (repaired.count !== 1) {
    return ensureBuiltinAgentProfileV1(actor);
  }
  return mapAgentProfileV1(
    await prisma.agentProfile.findFirstOrThrow({
      where: { id, organizationId: actor.organizationId },
    })
  );
}

export async function createAgentProfileV1(
  actor: AgentProfileActorV1,
  input: CreateAgentProfileInputV1
): Promise<AgentProfileDtoV1> {
  await requireAgentProfileOwnerV1(actor);
  await ensureBuiltinAgentProfileV1(actor);
  const handle = normalizeAgentHandleV1(input.handle);
  if (handle === BUILTIN_ASSISTANT_PROFILE_V1.handle) {
    throw new ConflictError(
      `Agent handle ${handle} is reserved for the built-in Agent.`
    );
  }
  await rejectDuplicateHandle(actor.organizationId, handle);
  const capabilities = input.capabilities ?? { schemaVersion: 1, skills: [] };
  const config = input.config ?? DEFAULT_AGENT_PROFILE_CONFIG_V1;

  try {
    const agent = await prisma.agentProfile.create({
      data: {
        organizationId: actor.organizationId,
        handle,
        name: input.name,
        description: input.description ?? '',
        skillsJson: JSON.stringify(capabilities.skills),
        capabilitiesJson: serializeAgentCapabilitiesV1(capabilities),
        configJson: serializeAgentConfigV1(config),
        enabled: input.enabled ?? true,
        builtin: false,
      },
    });
    return mapAgentProfileV1(agent);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError(`Agent handle ${handle} is already in use.`);
    }
    throw error;
  }
}

export async function updateAgentProfileV1(
  actor: AgentProfileActorV1,
  agentId: string,
  input: UpdateAgentProfileInputV1
): Promise<AgentProfileDtoV1> {
  await requireAgentProfileOwnerV1(actor);
  await ensureBuiltinAgentProfileV1(actor);
  const id = requireId(agentId);
  const existing = await prisma.agentProfile.findFirst({
    where: { id, organizationId: actor.organizationId },
  });
  if (!existing) throw new NotFoundError('Agent not found.');

  const handle = input.handle ?? existing.handle;
  if (existing.builtin && handle !== existing.handle) {
    throw new ValidationError('A built-in Agent handle cannot be changed.');
  }
  if (existing.builtin && input.enabled === false) {
    throw new ValidationError('A built-in Agent cannot be disabled.');
  }
  if (handle !== existing.handle) {
    await rejectDuplicateHandle(actor.organizationId, handle, existing.id);
  }

  const data = {
    ...(input.handle === undefined ? {} : { handle }),
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined
      ? {}
      : { description: input.description }),
    ...(input.capabilities === undefined
      ? {}
      : {
          capabilitiesJson: serializeAgentCapabilitiesV1(input.capabilities),
          skillsJson: JSON.stringify(input.capabilities.skills),
        }),
    ...(input.config === undefined
      ? {}
      : { configJson: serializeAgentConfigV1(input.config) }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    revision: { increment: 1 },
  };

  try {
    const changed = await prisma.agentProfile.updateMany({
      where: {
        id: existing.id,
        builtin: existing.builtin,
        organizationId: actor.organizationId,
        revision: input.expectedRevision,
      },
      data,
    });
    if (changed.count !== 1) {
      throw new ConflictError('Agent changed while it was being updated.');
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError(`Agent handle ${handle} is already in use.`);
    }
    throw error;
  }

  return mapAgentProfileV1(
    await prisma.agentProfile.findFirstOrThrow({
      where: { id: existing.id, organizationId: actor.organizationId },
    })
  );
}

async function rejectDuplicateHandle(
  organizationId: string,
  handle: string,
  exceptId?: string
) {
  const profiles = await prisma.agentProfile.findMany({
    where: { organizationId },
    select: { id: true, handle: true },
  });
  const normalized = handle.toLocaleLowerCase('en-US');
  const duplicate = profiles.some(
    (profile) =>
      profile.id !== exceptId &&
      profile.handle.toLocaleLowerCase('en-US') === normalized
  );
  if (duplicate) {
    throw new ConflictError(`Agent handle ${handle} is already in use.`);
  }
}

function requireId(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw new ValidationError('agentId is required.');
  }
  return value.trim();
}

function isUniqueConstraintError(value: unknown) {
  return isRecord(value) && value.code === 'P2002';
}
