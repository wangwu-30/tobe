import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { expect, test } from '@playwright/test';
import { Type } from 'typebox';

import { ROOM_RUNTIME_CONTRACT_VERSION_V1 } from '../contracts';
import {
  collect,
  context,
  handleInput,
  openInput,
  policy,
  registerRoomSessionRuntimeComplianceSuiteV1,
  session,
  type RoomRuntimeComplianceBehaviorV1,
} from '../testing/compliance';
import type { RoomContextBuildResultV1 } from '@/agent/context/contracts';
import { enforceGovernedAgentTool } from '@/agent/tool-policy';
import {
  PI_ROOM_RUNTIME_ID_V1,
  PiRoomSessionRuntimeAdapterV1,
  createStaticPiRoomAgentConfigResolverV1,
  type PiRoomRuntimeIdKindV1,
} from './pi-agent-core';

const TEST_MODEL: Model<Api> = {
  id: 'deterministic-model',
  name: 'Deterministic Model',
  api: 'test-api',
  provider: 'test-provider',
  baseUrl: 'https://invalid.example.test',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 2_048,
};

const RESPONSE_TEXT = 'Deterministic response';

registerRoomSessionRuntimeComplianceSuiteV1('Pi', {
  expectedResponseText: RESPONSE_TEXT,
  expectedRuntimeId: PI_ROOM_RUNTIME_ID_V1,
  create: createHarness,
});

test('passes provider configuration through the injected Pi stream seam', async () => {
  let observed:
    | {
        context: Context;
        model: Model<Api>;
        options?: SimpleStreamOptions;
      }
    | undefined;
  const runtime = new PiRoomSessionRuntimeAdapterV1(
    {
      resolveAgentConfig: createStaticPiRoomAgentConfigResolverV1({
        model: TEST_MODEL,
        systemPrompt: 'System prompt',
        getApiKey: () => 'secret-api-key',
        streamFn: async (model, streamContext, options) => {
          observed = { model, context: streamContext, options };
          return successfulStream('Configured response');
        },
      }),
    },
    deterministicDependencies()
  );
  const opened = await runtime.open(openInput());

  await collect(runtime.handle(handleInput(opened.handle)));

  expect(observed?.model).toBe(TEST_MODEL);
  expect(observed?.context.systemPrompt).toBe('System prompt');
  expect(observed?.context.messages.map(({ role }) => role)).toEqual(['user']);
  expect(observed?.options?.apiKey).toBe('secret-api-key');
  expect(observed?.options?.sessionId).toContain('room-session-1:1:');
  expect(observed?.options?.signal).toBeInstanceOf(AbortSignal);
});

test('preserves bounded context order, provenance, and trust without replaying legacy messages', async () => {
  let observed: Context | undefined;
  const runtime = new PiRoomSessionRuntimeAdapterV1(
    {
      resolveAgentConfig: createStaticPiRoomAgentConfigResolverV1({
        model: TEST_MODEL,
        systemPrompt: 'Base system prompt',
        streamFn: async (_model, streamContext) => {
          observed = streamContext;
          return successfulStream(RESPONSE_TEXT);
        },
      }),
    },
    deterministicDependencies()
  );
  const legacy = context();
  const blocks = [
    contextBlock({
      blockId: 'control',
      category: 'summary',
      content: 'TRUSTED-CONTROL',
      origin: 'control-plane',
      usage: 'control-instruction',
      level: 'trusted',
    }),
    contextBlock({
      blockId: 'document',
      category: 'document-slice',
      content: 'UNTRUSTED-DOCUMENT-DATA',
      origin: 'workspace-document',
      usage: 'data-only',
      level: 'untrusted',
    }),
    contextBlock({
      blockId: 'current',
      category: 'current-message',
      content: 'CURRENT-USER-REQUEST',
      origin: 'room-participant',
      usage: 'user-request',
      level: 'untrusted',
      sourceId: 'message-1',
    }),
  ] as const;
  const richContext = {
    ...legacy,
    messages: [
      {
        ...legacy.messages[0],
        text: 'LEGACY-SHOULD-NOT-BE-REPLAYED',
      },
    ],
    contextType: 'room.context' as const,
    organizationId: 'org-1',
    roomId: 'room-1',
    roomSessionId: 'room-session-1',
    agentId: 'agent-1',
    blocks,
    trace: contextTrace(blocks),
  };
  const opened = await runtime.open(openInput({ context: richContext }));

  await collect(runtime.handle(handleInput(opened.handle)));

  expect(observed?.systemPrompt).toContain('TRUSTED-CONTROL');
  expect(observed?.systemPrompt).not.toContain('UNTRUSTED-DOCUMENT-DATA');
  const replayed = observed?.messages.map((entry) =>
    typeof entry.content === 'string'
      ? entry.content
      : entry.content
          .filter((block) => block.type === 'text')
          .map((block) => ('text' in block ? block.text : ''))
          .join('')
  );
  expect(replayed).toHaveLength(2);
  expect(replayed?.[0]).toContain('UNTRUSTED-DOCUMENT-DATA');
  expect(replayed?.[0]).toContain('data-only');
  expect(replayed?.[1]).toContain('CURRENT-USER-REQUEST');
  expect(replayed?.[1]).toContain('user-request');
  expect(replayed?.join('\n')).not.toContain(
    'LEGACY-SHOULD-NOT-BE-REPLAYED'
  );
});

test('rejects stale-context checkpoints', async () => {
  const harness = createHarness('success');
  const opened = await harness.runtime.open(openInput());
  const checkpoint = await harness.runtime.checkpoint({
    schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
    requestId: 'checkpoint-1',
    handle: opened.handle,
    cursor: {
      messageSequence: 5,
      deliverySequence: 1,
      eventSequence: 0,
    },
    reason: 'idle',
  });
  expect(checkpoint.status).toBe('created');
  if (checkpoint.status !== 'created') {
    throw new Error('Expected checkpoint creation.');
  }

  await expect(
    harness.runtime.resume({
      schemaVersion: ROOM_RUNTIME_CONTRACT_VERSION_V1,
      requestId: 'resume-stale',
      session: session(),
      generation: 2,
      checkpoint: checkpoint.checkpoint,
      context: context(),
      policy: policy(),
    })
  ).resolves.toMatchObject({
    status: 'unsupported',
    reason: 'Fresh replay context is older than the checkpoint cursor.',
  });
});

test('fails closed for mismatched identity and duplicate deliveries', async () => {
  const harness = createHarness('success');
  const opened = await harness.runtime.open(openInput());
  const input = handleInput(opened.handle);
  await collect(harness.runtime.handle(input));

  const duplicate = await collect(harness.runtime.handle(input));
  expect(duplicate[0]?.event).toMatchObject({
    type: 'error',
    code: 'delivery-already-completed',
    retryable: false,
  });

  const mismatched = await collect(
    harness.runtime.handle({
      ...input,
      delivery: {
        ...input.delivery,
        deliveryId: 'delivery-wrong-room',
        roomSessionId: 'another-session',
      },
    })
  );
  expect(mismatched[0]?.event).toMatchObject({
    type: 'error',
    code: 'delivery-session-mismatch',
    retryable: false,
  });
});

test('projects governed tool denial as confirmation then ignored without generic output', async () => {
  const parameters = Type.Object({
    goal: Type.String(),
    nested: Type.Object({ priority: Type.Integer() }),
  });
  const governed = enforceGovernedAgentTool(
    {
      name: 'start_execution_job',
      label: 'Start execution job',
      description: 'Test confirmation boundary.',
      parameters,
      safetyLevel: 'confirm',
      confirmationPolicy: 'required',
      writePolicy: 'organization-scoped-append',
      async execute() {
        throw new Error('Delegate must not execute without confirmation.');
      },
    },
    {
      consumeConfirmation: () => false,
      requestConfirmation: () => ({
        schemaVersion: 1,
        requestId: 'confirmation-request-1',
        expiresAt: '2026-08-21T13:00:00.000Z',
      }),
    }
  );
  const toolCallId = 'tool-call-confirmation-1';
  const typedParameters = { goal: 'Run checks', nested: { priority: 2 } };
  const runtime = new PiRoomSessionRuntimeAdapterV1(
    {
      resolveAgentConfig: createStaticPiRoomAgentConfigResolverV1({
        model: TEST_MODEL,
        streamFn: async () => successfulStream(RESPONSE_TEXT),
        systemPrompt: 'System prompt',
        tools: [governed as AgentTool],
      }),
    },
    {
      ...deterministicDependencies(),
      createAgent: () => confirmationAgent(governed, toolCallId, typedParameters),
    }
  );
  const opened = await runtime.open(openInput());

  const events = await collect(runtime.handle(handleInput(opened.handle)));

  expect(events.map(({ event }) => event.type)).toEqual([
    'room.tool_confirmation.requested',
    'delivery-completed',
  ]);
  expect(events[0]?.event).toEqual({
    type: 'room.tool_confirmation.requested',
    request: {
      schemaVersion: 1,
      requestType: 'room.tool-confirmation',
      requestId: 'confirmation-request-1',
      expiresAt: '2026-08-21T13:00:00.000Z',
      toolCallId,
      toolName: 'start_execution_job',
      parameters: typedParameters,
      safetyLevel: 'confirm',
      writePolicy: 'organization-scoped-append',
    },
  });
  expect(events[1]?.event).toEqual({
    type: 'delivery-completed',
    disposition: 'ignored',
  });
});

function createHarness(behavior: RoomRuntimeComplianceBehaviorV1) {
  let invocations = 0;
  let cancellations = 0;
  let idleWaits = 0;
  const runtime = new PiRoomSessionRuntimeAdapterV1(
    {
      resolveAgentConfig: createStaticPiRoomAgentConfigResolverV1({
        model: TEST_MODEL,
        systemPrompt: 'You are a deterministic test agent.',
        getApiKey: () => 'secret-api-key',
        streamFn: async (_model, _context, options) => {
          invocations += 1;
          if (behavior === 'pending') {
            const { createAssistantMessageEventStream } = await import(
              '@earendil-works/pi-ai'
            );
            const stream = createAssistantMessageEventStream();
            stream.push({ type: 'start', partial: assistantMessage('', 'stop') });
            const abort = () => {
              cancellations += 1;
              const error = assistantMessage('', 'aborted', 'Request aborted');
              stream.push({ type: 'error', reason: 'aborted', error });
            };
            if (options?.signal?.aborted) {
              abort();
            } else {
              options?.signal?.addEventListener('abort', abort, { once: true });
            }
            return stream;
          }
          return behavior === 'error'
            ? await failedStream('Provider unavailable')
            : await successfulStream(RESPONSE_TEXT);
        },
      }),
    },
    {
      ...deterministicDependencies(),
      async createAgent(options) {
        const { Agent } = await import('@earendil-works/pi-agent-core');
        const agent = new Agent(options);
        const waitForIdle = agent.waitForIdle.bind(agent);
        agent.waitForIdle = () => {
          idleWaits += 1;
          return waitForIdle();
        };
        return agent;
      },
    }
  );

  return {
    runtime,
    invocationCount: () => invocations,
    cancellationCount: () => cancellations,
    idleWaitCount: () => idleWaits,
  };
}

function deterministicDependencies() {
  const counters = new Map<PiRoomRuntimeIdKindV1, number>();
  return {
    createId(kind: PiRoomRuntimeIdKindV1) {
      const next = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, next);
      return `${kind}-${next}`;
    },
    now: () => new Date('2026-08-21T12:00:00.000Z'),
  };
}

function confirmationAgent(
  tool: AgentTool,
  toolCallId: string,
  args: { goal: string; nested: { priority: number } }
) {
  const listeners = new Set<
    (
      event: import('@earendil-works/pi-agent-core').AgentEvent,
      signal: AbortSignal
    ) => Promise<void> | void
  >();
  const controller = new AbortController();
  let aborted = false;
  const runTool = async () => {
    for (const listener of listeners) {
      await listener(
        {
          type: 'tool_execution_start',
          toolCallId,
          toolName: tool.name,
          args,
        },
        controller.signal
      );
    }
    try {
      await tool.execute(toolCallId, args);
    } catch {
      const pending = (tool as AgentTool & {
        getPendingConfirmation?: (id: string) => unknown;
      }).getPendingConfirmation?.(toolCallId);
      if (!pending) throw new Error('Governed tool did not expose confirmation.');
      for (const listener of listeners) {
        await listener(
          {
            type: 'tool_execution_end',
            toolCallId,
            toolName: tool.name,
            result: { content: [], details: {} },
            isError: true,
          },
          controller.signal
        );
      }
    }
    if (!aborted) throw new Error('Expected confirmation to abort continuation.');
  };
  return {
    state: {
      errorMessage: undefined,
      isStreaming: false,
      messages: [],
      streamingMessage: undefined,
    },
    abort() {
      aborted = true;
      controller.abort();
    },
    continue: runTool,
    prompt: runTool,
    subscribe(listener: (
      event: import('@earendil-works/pi-agent-core').AgentEvent,
      signal: AbortSignal
    ) => Promise<void> | void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async waitForIdle() {},
  };
}

async function successfulStream(text: string) {
  const { createAssistantMessageEventStream } = await import(
    '@earendil-works/pi-ai'
  );
  const stream = createAssistantMessageEventStream();
  const midpoint = Math.floor(text.length / 2);
  const first = text.slice(0, midpoint);
  const second = text.slice(midpoint);
  stream.push({ type: 'start', partial: assistantMessage('', 'stop') });
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: first,
    partial: assistantMessage(first, 'stop'),
  });
  stream.push({
    type: 'text_delta',
    contentIndex: 0,
    delta: second,
    partial: assistantMessage(text, 'stop'),
  });
  const message = assistantMessage(text, 'stop');
  stream.push({ type: 'done', reason: 'stop', message });
  return stream;
}

async function failedStream(message: string) {
  const { createAssistantMessageEventStream } = await import(
    '@earendil-works/pi-ai'
  );
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'start', partial: assistantMessage('', 'stop') });
  const error = assistantMessage('', 'error', message);
  stream.push({ type: 'error', reason: 'error', error });
  return stream;
}

function assistantMessage(
  text: string,
  stopReason: AssistantMessage['stopReason'],
  errorMessage?: string
): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: TEST_MODEL.api,
    provider: TEST_MODEL.provider,
    model: TEST_MODEL.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.parse('2026-08-21T12:00:00.000Z'),
  };
}

function contextBlock(input: {
  blockId: string;
  category: 'current-message' | 'document-slice' | 'summary';
  content: string;
  level: 'trusted' | 'untrusted';
  origin:
    | 'control-plane'
    | 'room-participant'
    | 'workspace-document';
  sourceId?: string;
  usage: 'control-instruction' | 'data-only' | 'user-request';
}) {
  return {
    schemaVersion: 1 as const,
    blockId: input.blockId,
    category: input.category,
    contentType: 'text/plain' as const,
    content: input.content,
    contentHash: `hash-${input.blockId}`,
    source: {
      schemaVersion: 1 as const,
      sourceType: 'room-message' as const,
      sourceId: input.sourceId ?? `source-${input.blockId}`,
      organizationId: 'org-1',
      roomId: 'room-1',
      sequence: input.blockId === 'current' ? 1 : 0,
      createdAt: '2026-08-21T00:00:00.000Z',
      actor:
        input.level === 'trusted'
          ? ({ type: 'system', systemId: 'room-control' } as const)
          : ({ type: 'human', userId: 'user-1' } as const),
      contentHash: `hash-${input.blockId}`,
    },
    acl: {
      schemaVersion: 1 as const,
      decision: 'allow' as const,
      organizationId: 'org-1',
      principal: {
        type: 'room-agent-session' as const,
        agentId: 'agent-1',
        roomSessionId: 'room-session-1',
      },
      resource: { type: 'room' as const, roomId: 'room-1' },
      permission: 'context.read' as const,
      policyVersion: 'policy-1',
    },
    aclHash: `acl-${input.blockId}`,
    trust: {
      schemaVersion: 1 as const,
      level: input.level,
      origin: input.origin,
      usage: input.usage,
    },
    truncation: {
      unit: 'utf16-code-unit' as const,
      originalCharacters: input.content.length,
      includedCharacters: input.content.length,
      truncated: false,
    },
  };
}

function contextTrace(
  blocks: readonly ReturnType<typeof contextBlock>[]
): RoomContextBuildResultV1['trace'] {
  const categoryBudget = {
    maxCharacters: 10_000,
    maxBlocks: 10,
    consideredBlocks: 0,
    includedBlocks: 0,
    excludedBlocks: 0,
    truncatedBlocks: 0,
    usedCharacters: 0,
  };
  return {
    schemaVersion: 1,
    traceType: 'room.context-build',
    builderConfigVersion: 'test',
    summaryConfigVersion: 'test',
    throughMessageSequence: 1,
    selections: blocks.map((block) => ({
      category: block.category,
      blockId: block.blockId,
      sourceId: block.source.sourceId,
      sourceHash: block.source.contentHash,
      blockHash: block.contentHash,
      originalCharacters: block.truncation.originalCharacters,
      includedCharacters: block.truncation.includedCharacters,
      truncated: block.truncation.truncated,
    })),
    exclusions: [],
    budget: {
      schemaVersion: 1,
      unit: 'utf16-code-unit',
      maxTotalCharacters: 10_000,
      maxTotalBlocks: 10,
      usedCharacters: blocks.reduce(
        (total, block) => total + block.content.length,
        0
      ),
      includedBlocks: blocks.length,
      categories: {
        summary: categoryBudget,
        'room-delta': categoryBudget,
        'reply-chain': categoryBudget,
        'document-slice': categoryBudget,
        'retrieval-hit': categoryBudget,
        'current-message': categoryBudget,
      },
    },
    contextHash: 'context-hash',
    traceHash: 'trace-hash',
  };
}
