import { Type } from 'typebox';

import {
  enforceGovernedAgentTool,
  type GovernedAgentTool,
} from '@/agent/tool-policy';
import { createTeamTask, ensureBuiltinAgentProfiles } from '@/objects/task';

const PUBLISH_TEAM_TASK_PARAMETERS = Type.Object({
  description: Type.String({ minLength: 1 }),
  kind: Type.Optional(
    Type.Union([Type.Literal('execution'), Type.Literal('help')])
  ),
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
  title: Type.String({ minLength: 1 }),
});

type CreatePublishTeamTaskToolParams = {
  actorUserId: string;
  organizationId: string;
  originDeviceId?: string;
  resolveProjectId: () => Promise<string | null>;
  rememberSummary: (summary: string) => void;
  workspaceId: string;
};

export function createPublishTeamTaskTool({
  actorUserId,
  organizationId,
  originDeviceId,
  rememberSummary,
  resolveProjectId,
  workspaceId,
}: CreatePublishTeamTaskToolParams): GovernedAgentTool<
  typeof PUBLISH_TEAM_TASK_PARAMETERS
> {
  const tool: GovernedAgentTool<typeof PUBLISH_TEAM_TASK_PARAMETERS> = {
    name: 'publish_team_task',
    label: 'Publish Team Task',
    description:
      'Publish a centralized team task linked to the current project and document. Use kind help when progress is blocked or another teammate or agent should take over.',
    safetyLevel: 'safe',
    confirmationPolicy: 'automatic',
    writePolicy: 'organization-scoped-append',
    parameters: PUBLISH_TEAM_TASK_PARAMETERS,
    async execute(_toolCallId, params) {
      const [projectId, profiles] = await Promise.all([
        resolveProjectId(),
        ensureBuiltinAgentProfiles({ organizationId }),
      ]);
      const assistant = profiles.find((profile) => profile.handle === '@assistant');
      if (!assistant) {
        throw new Error('The built-in assistant profile is unavailable.');
      }

      const task = await createTeamTask(
        {
          deviceId: originDeviceId,
          organizationId,
          userId: actorUserId,
        },
        {
          createdById: assistant.id,
          createdByType: 'agent',
          description: params.description,
          kind: params.kind || 'help',
          priority: params.priority ?? 2,
          projectId,
          title: params.title,
          workspaceId,
        }
      );
      const summary =
        'Published team ' + task.kind + ' task "' + task.title + '".';
      rememberSummary(summary);

      return {
        content: [{ type: 'text', text: summary }],
        details: task,
      };
    },
  };

  return enforceGovernedAgentTool(tool);
}
