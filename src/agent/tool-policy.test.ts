import { expect, test } from '@playwright/test';
import { Type } from '@sinclair/typebox';

import {
  AgentToolConfirmationRequiredError,
  enforceGovernedAgentTool,
  type AgentToolPendingConfirmationDescriptorV1,
  type GovernedAgentTool,
} from './tool-policy';

const PARAMETERS = Type.Object({ value: Type.String() });

function createTool(
  confirmationPolicy: 'automatic' | 'required',
  execute: GovernedAgentTool<typeof PARAMETERS>['execute']
): GovernedAgentTool<typeof PARAMETERS> {
  return {
    confirmationPolicy,
    description: 'Test governed tool.',
    execute,
    label: 'Test Tool',
    name: 'test_tool',
    parameters: PARAMETERS,
    safetyLevel: confirmationPolicy === 'required' ? 'confirm' : 'safe',
    writePolicy: 'organization-scoped-append',
  };
}

test('required tools fail closed without a confirmation authority', async () => {
  let executeCalls = 0;
  const tool = enforceGovernedAgentTool(
    createTool('required', async () => {
      executeCalls += 1;
      return { content: [], details: null };
    })
  );

  await expect(tool.execute('call-1', { value: 'requested' })).rejects.toThrow(
    AgentToolConfirmationRequiredError
  );
  expect(executeCalls).toBe(0);
  expect(tool.getPendingConfirmation?.('call-1')).toBeUndefined();
});

test('denied calls synchronously expose the exact descriptor to an authority', async () => {
  const pending = new Map<string, AgentToolPendingConfirmationDescriptorV1>();
  const authority = {
    consumeConfirmation: () => false,
    requestConfirmation: () => ({
      schemaVersion: 1 as const,
      requestId: 'request-typed-call',
      expiresAt: '2026-08-21T13:00:00.000Z',
    }),
    getPendingConfirmation: (toolCallId: string) => pending.get(toolCallId),
    setPendingConfirmation(descriptor: AgentToolPendingConfirmationDescriptorV1) {
      pending.set(descriptor.request.toolCallId, descriptor);
    },
  };
  const tool = enforceGovernedAgentTool(
    createTool('required', async () => ({ content: [], details: null })),
    authority
  );

  await expect(
    tool.execute('typed-call', { value: 'exact typed value' })
  ).rejects.toBeInstanceOf(AgentToolConfirmationRequiredError);

  expect(authority.getPendingConfirmation('typed-call')).toEqual(
    tool.getPendingConfirmation?.('typed-call')
  );
  expect(authority.getPendingConfirmation('typed-call')).toMatchObject({
    schemaVersion: 1,
    request: {
      toolCallId: 'typed-call',
      parameters: { value: 'exact typed value' },
    },
    requestId: 'request-typed-call',
    expiresAt: '2026-08-21T13:00:00.000Z',
  });
});

test('required tools execute once only after an authority consumes confirmation', async () => {
  let executeCalls = 0;
  const requests: unknown[] = [];
  const tool = enforceGovernedAgentTool(
    createTool('required', async () => {
      executeCalls += 1;
      return {
        content: [{ type: 'text', text: 'executed' }],
        details: { executed: true },
      };
    }),
    {
      consumeConfirmation(request) {
        requests.push(request);
        return true;
      },
    }
  );

  const result = await tool.execute('call-2', { value: 'confirmed' });

  expect(executeCalls).toBe(1);
  expect(result.details).toEqual({ executed: true });
  expect(requests).toEqual([
    {
      parameters: { value: 'confirmed' },
      safetyLevel: 'confirm',
      toolCallId: 'call-2',
      toolName: 'test_tool',
      writePolicy: 'organization-scoped-append',
    },
  ]);
});

test('denied or failed confirmation never reaches the tool delegate', async () => {
  let executeCalls = 0;
  const rawTool = createTool('required', async () => {
    executeCalls += 1;
    return { content: [], details: null };
  });
  const denied = enforceGovernedAgentTool(rawTool, {
    consumeConfirmation: () => false,
  });
  const failed = enforceGovernedAgentTool(rawTool, {
    consumeConfirmation: () => {
      throw new Error('confirmation store unavailable');
    },
  });

  await expect(denied.execute('denied', { value: 'x' })).rejects.toThrow(
    AgentToolConfirmationRequiredError
  );
  await expect(failed.execute('failed', { value: 'x' })).rejects.toThrow(
    AgentToolConfirmationRequiredError
  );
  expect(executeCalls).toBe(0);
});

test('automatic tools preserve execution and callback arguments', async () => {
  const abortController = new AbortController();
  let confirmationCalls = 0;
  const updates: unknown[] = [];
  const onUpdate: NonNullable<
    Parameters<GovernedAgentTool<typeof PARAMETERS>['execute']>[3]
  > = (update) => {
    updates.push(update);
  };
  let receivedSignal: AbortSignal | undefined;
  let receivedUpdate: unknown;
  const tool = enforceGovernedAgentTool(
    createTool('automatic', async (_id, params, signal, update) => {
      receivedSignal = signal;
      receivedUpdate = update;
      update?.({
        content: [{ type: 'text', text: 'working' }],
        details: { value: params.value },
      });
      return {
        content: [{ type: 'text', text: 'done' }],
        details: { value: params.value },
      };
    }),
    {
      consumeConfirmation: () => {
        confirmationCalls += 1;
        throw new Error('Automatic tools must not consult confirmation.');
      },
    }
  );

  const result = await tool.execute(
    'automatic',
    { value: 'forwarded' },
    abortController.signal,
    onUpdate
  );

  expect(result.details).toEqual({ value: 'forwarded' });
  expect(confirmationCalls).toBe(0);
  expect(receivedSignal).toBe(abortController.signal);
  expect(receivedUpdate).toBe(onUpdate);
  expect(updates).toHaveLength(1);
});

test('unknown runtime policy values fail closed even with an authority', async () => {
  let executeCalls = 0;
  const corrupted = {
    ...createTool('required', async () => {
      executeCalls += 1;
      return { content: [], details: null };
    }),
    confirmationPolicy: 'corrupted',
  } as unknown as GovernedAgentTool<typeof PARAMETERS>;
  const tool = enforceGovernedAgentTool(corrupted, {
    consumeConfirmation: () => true,
  });

  await expect(tool.execute('corrupted', { value: 'x' })).rejects.toThrow(
    AgentToolConfirmationRequiredError
  );
  expect(executeCalls).toBe(0);
});

test('automatic delegate errors remain errors', async () => {
  const delegateError = new Error('delegate failed');
  const tool = enforceGovernedAgentTool(
    createTool('automatic', async () => {
      throw delegateError;
    })
  );

  await expect(tool.execute('automatic-error', { value: 'x' })).rejects.toBe(
    delegateError
  );
});
