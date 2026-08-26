import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';

import type { RoomSessionRefV1 } from '@/agent/room-runtime/contracts';
import {
  type AgentToolConfirmationAuthority,
} from '@/agent/tool-policy';
import type { consumeRoomDelegationGrant } from '@/objects/room';
import { createDelegateRoomTaskToolV1 } from './room/delegate-room-task';
import { createStartExecutionJobTool } from './execution/start-execution-job';
import { createPublishTeamTaskTool } from './team-task/publish-team-task';

export type RoomAgentDelegationSourceV1 = {
  deliveryId: string;
  generation: number;
  roomSessionId: string;
  workerId: string;
};

export type RoomAgentDelegationTargetV1 = {
  agentId: string;
  handle: string;
  name: string;
};

export type RoomAgentDelegationSourceFenceV1 = Pick<
  RoomAgentDelegationSourceV1,
  'generation' | 'workerId'
>;

export type RoomAgentToolIdentityV1 = {
  actorUserId: string;
  organizationId: string;
  originRoomMessageId: string;
  originDeviceId?: string;
  projectId: string | null;
  source: RoomAgentDelegationSourceV1;
  delegationTargets?: readonly RoomAgentDelegationTargetV1[];
  workspaceId: string;
};

export interface RoomAgentToolIdentityPortV1 {
  resolve(
    session: RoomSessionRefV1,
    sourceFence?: RoomAgentDelegationSourceFenceV1
  ): Promise<RoomAgentToolIdentityV1>;
}

export type CreateRoomAgentToolsOptionsV1 = {
  confirmationAuthority?: AgentToolConfirmationAuthority;
  consumeDelegation?: typeof consumeRoomDelegationGrant;
  identity: RoomAgentToolIdentityPortV1;
  session: RoomSessionRefV1;
};

/**
 * The deliberately narrow Room toolkit. Identity is resolved at execution
 * time from trusted control-plane state; model-authored parameters can never
 * select an organization, actor, project, or workspace.
 */
export function createRoomAgentToolsV1(
  options: CreateRoomAgentToolsOptionsV1
): readonly [AgentTool, AgentTool, AgentTool] {
  const publishTemplate = createPublishTeamTaskTool({
    actorUserId: 'unresolved',
    organizationId: 'unresolved',
    rememberSummary: () => undefined,
    resolveProjectId: async () => null,
    workspaceId: 'unresolved',
  });
  const executionTemplate = createStartExecutionJobTool({
    actorUserId: 'unresolved',
    conversationId: null,
    idempotencyScope: 'unresolved',
    organizationId: 'unresolved',
    rememberSummary: () => undefined,
    workspaceId: 'unresolved',
  });
  const delegationTemplate = createDelegateRoomTaskToolV1({
    actorUserId: 'unresolved',
    consumeDelegation: options.consumeDelegation,
    organizationId: 'unresolved',
    roomId: options.session.roomId,
    source: {
      deliveryId: 'unresolved',
      generation: 0,
      roomSessionId: options.session.roomSessionId,
      workerId: 'unresolved',
    },
  });
  return [
    deferredTool(
      publishTemplate,
      async () => {
        const identity = await resolveBoundIdentity(options);
        return createPublishTeamTaskTool({
          actorUserId: identity.actorUserId,
          organizationId: identity.organizationId,
          originDeviceId: identity.originDeviceId,
          rememberSummary: () => undefined,
          resolveProjectId: async () => identity.projectId,
          workspaceId: identity.workspaceId,
        });
      }
    ) as unknown as AgentTool,
    deferredTool(
      executionTemplate,
      async () => {
        const identity = await resolveBoundIdentity(options);
        return createStartExecutionJobTool({
          actorUserId: identity.actorUserId,
          confirmationAuthority: options.confirmationAuthority,
          conversationId: null,
          idempotencyScope: options.session.roomSessionId,
          organizationId: identity.organizationId,
          originDeviceId: identity.originDeviceId,
          originRoomId: options.session.roomId,
          originRoomMessageId: identity.originRoomMessageId,
          rememberSummary: () => undefined,
          workspaceId: identity.workspaceId,
        });
      }
    ) as unknown as AgentTool,
    deferredTool(delegationTemplate, async () => {
      const identity = await resolveBoundIdentity(options);
      return createDelegateRoomTaskToolV1({
        actorUserId: identity.actorUserId,
        consumeDelegation: options.consumeDelegation,
        organizationId: identity.organizationId,
        roomId: options.session.roomId,
        source: identity.source,
      });
    }) as unknown as AgentTool,
  ];
}

function deferredTool<TParameters extends TSchema, TDetails>(
  template: AgentTool<TParameters, TDetails>,
  resolve: () => Promise<AgentTool<TParameters, TDetails>>
): AgentTool<TParameters, TDetails> {
  return {
    ...template,
    async execute(toolCallId, params, signal, onUpdate) {
      const tool = await resolve();
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

async function resolveBoundIdentity(
  options: CreateRoomAgentToolsOptionsV1
): Promise<RoomAgentToolIdentityV1> {
  const identity = await options.identity.resolve(options.session);
  if (
    identity.organizationId !== options.session.organizationId ||
    identity.source.roomSessionId !== options.session.roomSessionId ||
    identity.source.deliveryId.trim().length === 0 ||
    identity.source.workerId.trim().length === 0 ||
    !Number.isSafeInteger(identity.source.generation) ||
    identity.source.generation < 0
  ) {
    throw new Error('Room tool identity is outside the active session fence.');
  }
  return identity;
}
