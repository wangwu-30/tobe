import type { AgentOptions } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';
import { Type } from '@sinclair/typebox';
import { expect, test } from '@playwright/test';

import { openInput } from '@/agent/room-runtime/testing/compliance';
import type { AgentToolConfirmationAuthority } from '@/agent/tool-policy';
import { createConfiguredPiRoomRuntimeV1 } from './pi-runtime';

const MODEL: Model<Api> = {
  id: 'model-1',
  name: 'Model 1',
  api: 'test-api',
  provider: 'provider-1',
  baseUrl: 'https://invalid.example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 2_048,
};

test('production Pi composition resolves credentials and attaches only Room tools', async () => {
  let sourceFenceSession: ReturnType<typeof openInput>['session'] | undefined;
  const runtime = createConfiguredPiRoomRuntimeV1(
    {
      driver: 'pi-agent-core',
      runtimeId: 'pi-agent-core',
      runtimeVersion: '0.57.1',
      providerId: MODEL.provider,
      modelId: MODEL.id,
      systemPrompt: 'Room system prompt',
      thinkingLevel: 'medium',
    },
    {
      identity: {
        async resolve(session) {
          return {
            actorUserId: 'user-1',
            organizationId: session.organizationId,
            originRoomMessageId: 'message-1',
            projectId: 'project-1',
            source: {
              deliveryId: 'delivery-1',
              generation: 1,
              roomSessionId: session.roomSessionId,
              workerId: 'worker-1',
            },
            workspaceId: 'workspace-1',
          };
        },
      },
      resolveApiKey: async (provider) => `key-for-${provider}`,
      resolveModel: () => MODEL,
      resolveSourceFence: async (session) => {
        sourceFenceSession = session;
        return { generation: 1, workerId: 'worker-1' };
      },
      createConfirmationAuthority: () => ({
        consumeConfirmation: () => false,
      }),
      createTools: () => [
        fakeTool('publish_team_task'),
        fakeTool('start_execution_job', true),
      ],
    }
  );
  let options: AgentOptions | undefined;
  const injectable = runtime as unknown as {
    dependencies: { createAgent(options: AgentOptions): unknown };
  };
  injectable.dependencies.createAgent = (agentOptions) => {
    options = agentOptions;
    return fakeAgent();
  };

  await runtime.open(openInput());

  expect(sourceFenceSession).toEqual(openInput().session);
  const initialState = options?.initialState;
  expect(initialState).toBeDefined();
  if (!initialState) throw new Error('Expected Pi initial state.');
  expect(initialState.model).toBe(MODEL);
  expect(initialState.systemPrompt).toBe('Room system prompt');
  expect(initialState.thinkingLevel).toBe('medium');
  expect(initialState.tools?.map(({ name }) => name)).toEqual([
    'publish_team_task',
    'start_execution_job',
  ]);
  await expect(options?.getApiKey?.('provider-1')).resolves.toBe(
    'key-for-provider-1'
  );
  const start = initialState.tools?.find(
    ({ name }) => name === 'start_execution_job'
  );
  await expect(
    start?.execute('call-1', { goal: 'Do work', kind: 'coding' })
  ).rejects.toThrow(/requires explicit human confirmation/);
});

test('production Pi composition creates a confirmation authority from trusted session state', async () => {
  let capturedAuthority: AgentToolConfirmationAuthority | undefined;
  let factoryInput:
    | { identity: unknown; session: ReturnType<typeof openInput>['session'] }
    | undefined;
  const runtime = createConfiguredPiRoomRuntimeV1(
    {
      driver: 'pi-agent-core',
      runtimeId: 'pi-agent-core',
      runtimeVersion: '0.57.1',
      providerId: MODEL.provider,
      modelId: MODEL.id,
      systemPrompt: 'Room system prompt',
    },
    {
      identity: {
        async resolve(session) {
          return {
            actorUserId: 'user-1',
            organizationId: session.organizationId,
            originRoomMessageId: 'message-1',
            projectId: 'project-1',
            source: {
              deliveryId: 'delivery-1',
              generation: 1,
              roomSessionId: session.roomSessionId,
              workerId: 'worker-1',
            },
            workspaceId: 'workspace-1',
          };
        },
      },
      resolveApiKey: async () => 'test-key',
      resolveModel: () => MODEL,
      resolveSourceFence: async () => ({
        generation: 1,
        workerId: 'worker-1',
      }),
      createConfirmationAuthority(input) {
        factoryInput = input;
        return { consumeConfirmation: () => true };
      },
      createTools(input) {
        capturedAuthority = input.confirmationAuthority;
        return [fakeTool('publish_team_task'), fakeTool('start_execution_job')];
      },
    }
  );
  const injectable = runtime as unknown as {
    dependencies: { createAgent(options: AgentOptions): unknown };
  };
  injectable.dependencies.createAgent = () => fakeAgent();

  await runtime.open(openInput());

  expect(factoryInput?.session).toEqual(openInput().session);
  expect(factoryInput?.identity).toBeDefined();
  expect(capturedAuthority).toBeDefined();
  expect(
    await capturedAuthority?.consumeConfirmation({
      parameters: { goal: 'Do work', kind: 'coding' },
      safetyLevel: 'confirm',
      toolCallId: 'call-1',
      toolName: 'start_execution_job',
      writePolicy: 'organization-scoped-append',
    })
  ).toBe(true);
});

test('production Pi composition rejects a mismatched model resolver', async () => {
  const runtime = createConfiguredPiRoomRuntimeV1(
    {
      driver: 'pi-agent-core',
      runtimeId: 'pi-agent-core',
      runtimeVersion: '0.57.1',
      providerId: 'different-provider',
      modelId: MODEL.id,
      systemPrompt: 'Room system prompt',
    },
    { resolveModel: () => MODEL }
  );
  await expect(runtime.open(openInput())).rejects.toThrow(
    /does not match providerId and modelId/
  );
});

function fakeAgent() {
  return {
    state: {
      error: undefined,
      isStreaming: false,
      messages: [],
      streamMessage: null,
    },
    abort() {},
    appendMessage() {},
    async continue() {},
    async prompt() {},
    subscribe() {
      return () => undefined;
    },
    async waitForIdle() {},
  };
}

function fakeTool(name: string, failClosed = false) {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    async execute() {
      if (failClosed) {
        throw new Error(
          'Tool start_execution_job requires explicit human confirmation before it can run.'
        );
      }
      return { content: [], details: null };
    },
  };
}
