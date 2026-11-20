import assert from 'node:assert/strict';
import test from 'node:test';
import { Type } from 'typebox';

import { assertMatchesObject } from '@/lib/testing/node-assert';

import {
  AgentToolConfirmationRequiredError,
  enforceGovernedAgentTool,
  isGovernedAgentTool,
  type AgentToolAuditEvent,
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

  await assert.rejects(
    tool.execute('call-1', { value: 'requested' }),
    AgentToolConfirmationRequiredError
  );
  assert.equal(executeCalls, 0);
  assert.equal(tool.getPendingConfirmation?.('call-1'), undefined);
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

  await assert.rejects(
    tool.execute('typed-call', { value: 'exact typed value' }),
    AgentToolConfirmationRequiredError
  );

  assert.deepEqual(
    authority.getPendingConfirmation('typed-call'),
    tool.getPendingConfirmation?.('typed-call')
  );
  assertMatchesObject(authority.getPendingConfirmation('typed-call'), {
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

  assert.equal(executeCalls, 1);
  assert.deepEqual(result.details, { executed: true });
  assert.deepEqual(requests, [
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

  await assert.rejects(
    denied.execute('denied', { value: 'x' }),
    AgentToolConfirmationRequiredError
  );
  await assert.rejects(
    failed.execute('failed', { value: 'x' }),
    AgentToolConfirmationRequiredError
  );
  assert.equal(executeCalls, 0);
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

  assert.deepEqual(result.details, { value: 'forwarded' });
  assert.equal(confirmationCalls, 0);
  assert.equal(receivedSignal, abortController.signal);
  assert.equal(receivedUpdate, onUpdate);
  assert.equal(updates.length, 1);
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

  await assert.rejects(
    tool.execute('corrupted', { value: 'x' }),
    AgentToolConfirmationRequiredError
  );
  assert.equal(executeCalls, 0);
});

test('automatic delegate errors remain errors', async () => {
  const delegateError = new Error('delegate failed');
  const tool = enforceGovernedAgentTool(
    createTool('automatic', async () => {
      throw delegateError;
    })
  );

  await assert.rejects(
    tool.execute('automatic-error', { value: 'x' }),
    (error: unknown) => error === delegateError
  );
});

test('confirm and privileged tools fail closed if misconfigured as automatic', async () => {
  let executeCalls = 0;
  const audits: AgentToolAuditEvent[] = [];

  for (const safetyLevel of ['confirm', 'privileged'] as const) {
    const downgraded: GovernedAgentTool<typeof PARAMETERS> = {
      ...createTool('automatic', async () => {
        executeCalls += 1;
        return { content: [], details: null };
      }),
      safetyLevel,
    };
    const tool = enforceGovernedAgentTool(
      downgraded,
      { consumeConfirmation: () => true },
      { onAudit: (event) => audits.push(event) }
    );

    await assert.rejects(
      tool.execute(`downgraded-${safetyLevel}`, { value: 'x' }),
      AgentToolConfirmationRequiredError
    );
  }

  assert.equal(executeCalls, 0);
  assert.deepEqual(audits, [
    {
      confirmationPolicy: 'automatic',
      outcome: 'confirmation_required',
      safetyLevel: 'confirm',
      toolCallId: 'downgraded-confirm',
      toolName: 'test_tool',
      writePolicy: 'organization-scoped-append',
    },
    {
      confirmationPolicy: 'automatic',
      outcome: 'confirmation_required',
      safetyLevel: 'privileged',
      toolCallId: 'downgraded-privileged',
      toolName: 'test_tool',
      writePolicy: 'organization-scoped-append',
    },
  ]);
});

test('audit observer records executed, confirmation_required, and failed outcomes without breaking execution', async () => {
  const events: AgentToolAuditEvent[] = [];

  const safeTool = enforceGovernedAgentTool(
    createTool('automatic', async (_id, params) => {
      if (params.value === 'boom') {
        throw new Error('simulated failure');
      }
      return { content: [], details: params };
    }),
    undefined,
    { onAudit: (event) => events.push(event) }
  );

  const confirmTool = enforceGovernedAgentTool(
    createTool('required', async () => ({ content: [], details: 'ok' })),
    { consumeConfirmation: () => false },
    { onAudit: (event) => events.push(event) }
  );

  const throwingObserverTool = enforceGovernedAgentTool(
    createTool('automatic', async () => ({ content: [], details: 'survived' })),
    undefined,
    {
      onAudit: () => {
        throw new Error('observer crash');
      },
    }
  );

  await safeTool.execute('call-ok', { value: 'ok' });
  await assert.rejects(
    safeTool.execute('call-fail', { value: 'boom' }),
    /simulated failure/
  );
  await assert.rejects(
    confirmTool.execute('call-denied', { value: 'x' }),
    AgentToolConfirmationRequiredError
  );
  const survived = await throwingObserverTool.execute('call-survived', {
    value: 'ok',
  });

  assert.equal(survived.details, 'survived');
  assert.deepEqual(events, [
    {
      confirmationPolicy: 'automatic',
      outcome: 'executed',
      safetyLevel: 'safe',
      toolCallId: 'call-ok',
      toolName: 'test_tool',
      writePolicy: 'organization-scoped-append',
    },
    {
      confirmationPolicy: 'automatic',
      errorMessage: 'simulated failure',
      outcome: 'failed',
      safetyLevel: 'safe',
      toolCallId: 'call-fail',
      toolName: 'test_tool',
      writePolicy: 'organization-scoped-append',
    },
    {
      confirmationPolicy: 'required',
      outcome: 'confirmation_required',
      safetyLevel: 'confirm',
      toolCallId: 'call-denied',
      toolName: 'test_tool',
      writePolicy: 'organization-scoped-append',
    },
  ]);
});

test('isGovernedAgentTool distinguishes enforced governed tools from raw tools', () => {
  const raw = {
    description: 'Raw tool',
    execute: async () => ({ content: [], details: null }),
    label: 'Raw',
    name: 'raw_tool',
    parameters: PARAMETERS,
  };
  const governed = enforceGovernedAgentTool(
    createTool('automatic', async () => ({ content: [], details: null }))
  );

  assert.equal(isGovernedAgentTool(raw), false);
  assert.equal(isGovernedAgentTool(governed), true);
});
