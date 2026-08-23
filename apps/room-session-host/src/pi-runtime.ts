import type { Api, Model } from '@mariozechner/pi-ai';

import type { AgentTool } from '@mariozechner/pi-agent-core';
import type {
  RoomAgentDelegationSourceFenceV1,
  RoomAgentToolIdentityPortV1,
} from '@/agent/tools/room-tools';
import type { AgentToolConfirmationAuthority } from '@/agent/tool-policy';
import { PiRoomSessionRuntimeAdapterV1 } from '@/agent/room-runtime/adapters/pi-agent-core';

import type { PiRoomSessionHostRuntimeConfigV1 } from './config';

type PiRoomRuntimeDependenciesV1 = {
  confirmationAuthority?: AgentToolConfirmationAuthority;
  createConfirmationAuthority?: (input: {
    identity: RoomAgentToolIdentityPortV1;
    session: Parameters<RoomAgentToolIdentityPortV1['resolve']>[0];
  }) => AgentToolConfirmationAuthority;
  identity?: RoomAgentToolIdentityPortV1;
  resolveSourceFence?: (
    session: Parameters<RoomAgentToolIdentityPortV1['resolve']>[0]
  ) => Promise<RoomAgentDelegationSourceFenceV1>;
  resolveApiKey?: (providerId: string) => Promise<string | undefined>;
  resolveModel?: (providerId: string, modelId: string) => Model<Api>;
  createTools?: (input: {
    confirmationAuthority?: AgentToolConfirmationAuthority;
    identity: RoomAgentToolIdentityPortV1;
    session: Parameters<RoomAgentToolIdentityPortV1['resolve']>[0];
  }) => readonly AgentTool[];
};

export function createConfiguredPiRoomRuntimeV1(
  config: PiRoomSessionHostRuntimeConfigV1,
  dependencies: PiRoomRuntimeDependenciesV1 = {}
) {
  const identity =
    dependencies.identity ?? createPrismaRoomAgentToolIdentityPortV1();
  const resolveApiKey = dependencies.resolveApiKey ?? resolveProductionApiKey;
  return new PiRoomSessionRuntimeAdapterV1({
    // Only the production toolkit is known here to install the governed,
    // durable delegate_room_task command. Custom/test toolkits stay
    // conservatively false instead of advertising an unverified capability.
    delegationRequests: dependencies.createTools === undefined,
    runtimeId: config.runtimeId,
    runtimeVersion: config.runtimeVersion,
    resolveAgentConfig: async ({ session }) => {
      const model = dependencies.resolveModel
        ? dependencies.resolveModel(config.providerId, config.modelId)
        : ((await import('@mariozechner/pi-ai')).getModel(
            config.providerId as never,
            config.modelId as never
          ) as Model<Api>);
      if (model.provider !== config.providerId || model.id !== config.modelId) {
        throw new Error(
          'Configured Pi model does not match providerId and modelId.'
        );
      }
      const createTools =
        dependencies.createTools ??
        (await import('@/agent/tools/room-tools')).createRoomAgentToolsV1;
      const sourceFence = await (
        dependencies.resolveSourceFence ?? resolveRoomAgentToolSourceFenceV1
      )(session);
      const confirmationAuthority =
        dependencies.confirmationAuthority ??
        (dependencies.createConfirmationAuthority
          ? dependencies.createConfirmationAuthority({ identity, session })
          : (await import('@/objects/room-tool-confirmation'))
              .createPrismaRoomToolConfirmationAuthority({
                resolveBinding: async () => {
                  const resolved = await identity.resolve(session, sourceFence);
                  return {
                    organizationId: resolved.organizationId,
                    requestedByUserId: resolved.actorUserId,
                    roomId: session.roomId,
                    roomMessageId: resolved.originRoomMessageId,
                    roomSessionId: session.roomSessionId,
                    deliveryId: await resolveCurrentDeliveryId(
                      identity,
                      session
                    ),
                    workspaceId: resolved.workspaceId,
                    projectId: resolved.projectId,
                    originDeviceId: resolved.originDeviceId ?? null,
                  };
                },
              }));
      return {
        model,
        systemPrompt: config.systemPrompt,
        thinkingLevel: config.thinkingLevel,
        getApiKey: (provider) => resolveApiKey(provider),
        tools: createTools({
          confirmationAuthority,
          identity: bindRoomAgentToolIdentityV1(identity, sourceFence),
          session,
        }),
      };
    },
  });
}

async function resolveCurrentDeliveryId(
  identity: RoomAgentToolIdentityPortV1,
  session: Parameters<RoomAgentToolIdentityPortV1['resolve']>[0]
) {
  const resolved = await identity.resolve(session);
  const { getPrismaClient } = await import('@/lib/db/prisma');
  const delivery = await getPrismaClient().roomInboxDelivery.findFirst({
    where: {
      organizationId: resolved.organizationId,
      roomId: session.roomId,
      roomSessionId: session.roomSessionId,
      messageId: resolved.originRoomMessageId,
      status: 'claimed',
      session: { currentDeliveryId: { not: null } },
    },
    select: { id: true },
  });
  if (!delivery) throw new Error('Room confirmation delivery is no longer active.');
  return delivery.id;
}

function bindRoomAgentToolIdentityV1(
  identity: RoomAgentToolIdentityPortV1,
  sourceFence: { generation: number; workerId: string }
): RoomAgentToolIdentityPortV1 {
  return {
    resolve(session) {
      return identity.resolve(session, sourceFence);
    },
  };
}

async function resolveRoomAgentToolSourceFenceV1(
  session: Parameters<RoomAgentToolIdentityPortV1['resolve']>[0]
) {
  const { getPrismaClient } = await import('@/lib/db/prisma');
  const source = await getPrismaClient().roomAgentSession.findFirst({
    where: {
      id: session.roomSessionId,
      organizationId: session.organizationId,
      roomId: session.roomId,
      agentId: session.agent.agentId,
      currentDeliveryId: { not: null },
      leaseOwnerId: { not: null },
    },
    select: { generation: true, leaseOwnerId: true },
  });
  if (!source?.leaseOwnerId) {
    throw new Error('Room tool source is not an active claimed delivery.');
  }
  return { generation: source.generation, workerId: source.leaseOwnerId };
}

export function createPrismaRoomAgentToolIdentityPortV1(): RoomAgentToolIdentityPortV1 {
  return {
    async resolve(session, sourceFence) {
      const { getPrismaClient } = await import('@/lib/db/prisma');
      const prisma = getPrismaClient();
      const room = await prisma.room.findFirst({
        where: {
          id: session.roomId,
          organizationId: session.organizationId,
          sessions: {
            some: {
              id: session.roomSessionId,
              agentId: session.agent.agentId,
              currentDeliveryId: { not: null },
            },
          },
        },
        select: {
          createdByUserId: true,
          projectId: true,
          sessions: {
            where: {
              id: session.roomSessionId,
              agentId: session.agent.agentId,
            },
            select: {
              currentDeliveryId: true,
              generation: true,
              leaseExpiresAt: true,
              leaseOwnerId: true,
            },
            take: 1,
          },
        },
      });
      const currentDeliveryId = room?.sessions[0]?.currentDeliveryId;
      const currentSession = room?.sessions[0];
      if (
        !room?.createdByUserId ||
        !room.projectId ||
        !currentDeliveryId ||
        !currentSession?.leaseOwnerId ||
        !currentSession.leaseExpiresAt ||
        currentSession.leaseExpiresAt.getTime() <= Date.now() ||
        (sourceFence !== undefined &&
          (sourceFence.generation !== currentSession.generation ||
            sourceFence.workerId !== currentSession.leaseOwnerId))
      ) {
        throw new Error('Room is not bound to an acting user and workspace.');
      }
      const currentDelivery = await prisma.roomInboxDelivery.findFirst({
        where: {
          id: currentDeliveryId,
          organizationId: session.organizationId,
          roomId: session.roomId,
          roomSessionId: session.roomSessionId,
        },
        select: { messageId: true },
      });
      if (!currentDelivery) {
        throw new Error('Room current delivery is not bound to this session.');
      }
      const delegationTargets = await prisma.agentProfile.findMany({
        where: {
          enabled: true,
          organizationId: session.organizationId,
          id: { not: session.agent.agentId },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { handle: true, id: true, name: true },
      });
      const workspace = await prisma.document.findFirst({
        where: {
          id: room.projectId,
          organizationId: session.organizationId,
          deletedAt: null,
        },
        select: { id: true, originDeviceId: true, projectId: true },
      });
      if (!workspace) {
        throw new Error('Room project does not identify an exact workspace.');
      }
      return {
        actorUserId: room.createdByUserId,
        organizationId: session.organizationId,
        originRoomMessageId: currentDelivery.messageId,
        ...(workspace.originDeviceId
          ? { originDeviceId: workspace.originDeviceId }
          : {}),
        projectId: workspace.projectId ?? workspace.id,
        source: {
          deliveryId: currentDeliveryId,
          generation: currentSession.generation,
          roomSessionId: session.roomSessionId,
          workerId: currentSession.leaseOwnerId,
        },
        delegationTargets: delegationTargets.map((target) => ({
          agentId: target.id,
          handle: target.handle,
          name: target.name,
        })),
        workspaceId: workspace.id,
      };
    },
  };
}

async function resolveProductionApiKey(providerId: string) {
  const oauthProvider = asOAuthProvider(providerId);
  if (oauthProvider) {
    const { getOAuthApiKeyForProvider } = await import('@/lib/ai/auth-store');
    const oauth = await getOAuthApiKeyForProvider(oauthProvider);
    if (oauth?.apiKey) return oauth.apiKey;
  }
  const { resolveConfiguredApiKey } = await import('@/lib/ai/providers');
  return resolveConfiguredApiKey({ providerApiKeys: {} }, providerId);
}

function asOAuthProvider(providerId: string) {
  if (
    providerId === 'anthropic' ||
    providerId === 'openai-codex' ||
    providerId === 'github-copilot' ||
    providerId === 'google-gemini-cli' ||
    providerId === 'google-antigravity'
  ) {
    return providerId;
  }
  return null;
}
