import { expect, test } from '@playwright/test';

import {
  RUNTIME_CONTRACT_VERSION_V1,
  type RuntimeCandidateV1,
  type RuntimeSelectionRequestV1,
} from './contracts';
import { matchExecutionRuntimeV1 } from './matcher';

const VERSION = RUNTIME_CONTRACT_VERSION_V1;

function candidate(
  runtimeId: string,
  overrides: {
    capabilities?: Partial<
      RuntimeCandidateV1['descriptor']['capabilities']
    >;
    availableSlots?: number;
    health?: Partial<RuntimeCandidateV1['health']>;
    selectionPriority?: number;
  } = {}
): RuntimeCandidateV1 {
  return {
    descriptor: {
      schemaVersion: VERSION,
      runtimeId,
      displayName: runtimeId,
      runtimeVersion: '1.0.0',
      selectionPriority: overrides.selectionPriority,
      capabilities: {
        schemaVersion: VERSION,
        kinds: ['coding'],
        nativeResume: true,
        checkpoint: true,
        streaming: 'typed-events',
        interrupt: 'graceful',
        workspace: 'git-worktree',
        sandbox: 'container',
        structuredArtifacts: true,
        waitingForHuman: true,
        supportedModels: ['*'],
        ...overrides.capabilities,
      },
    },
    health: {
      state: 'healthy',
      acceptingNewAttempts: true,
      ...overrides.health,
    },
    capacity: {
      availableSlots: overrides.availableSlots ?? 1,
    },
  };
}

function request(
  candidates: readonly RuntimeCandidateV1[],
  overrides: Partial<RuntimeSelectionRequestV1> = {}
): RuntimeSelectionRequestV1 {
  return {
    schemaVersion: VERSION,
    execution: {
      schemaVersion: VERSION,
      goal: 'Implement the requested repository change.',
      kind: 'coding',
      requirements: {},
    },
    strategy: { mode: 'auto' },
    organizationPolicy: {
      allowedRuntimeIds: '*',
    },
    candidates,
    ...overrides,
  };
}

function evaluationFor(
  result: ReturnType<typeof matchExecutionRuntimeV1>,
  runtimeId: string
) {
  const evaluation = result.evaluations.find(
    ({ candidate: item }) => item.descriptor.runtimeId === runtimeId
  );

  expect(evaluation, `Expected an evaluation for ${runtimeId}`).toBeDefined();
  if (!evaluation) {
    throw new Error(`Expected an evaluation for ${runtimeId}`);
  }
  return evaluation;
}

test('auto selection applies organization allowlist before agent preference', () => {
  const openhands = candidate('openhands');
  const codex = candidate('codex');
  const result = matchExecutionRuntimeV1(
    request([openhands, codex], {
      agentPreference: {
        orderedRuntimeIds: ['openhands', 'codex'],
      },
      organizationPolicy: {
        allowedRuntimeIds: ['codex'],
      },
    })
  );

  expect(result.matched).toBe(true);
  if (!result.matched) {
    return;
  }

  expect(result.selected.descriptor.runtimeId).toBe('codex');
  expect(result.selectedBy).toBe('agent-preference');
  expect(
    evaluationFor(result, 'openhands').rejectionReasons.map(
      ({ code }) => code
    )
  ).toEqual(['not-allowed-by-organization']);
});

test('auto fallback never weakens required capabilities', () => {
  const preferred = candidate('preferred-cli', {
    capabilities: {
      workspace: 'directory',
      structuredArtifacts: false,
    },
  });
  const compatible = candidate('openhands');
  const result = matchExecutionRuntimeV1(
    request([preferred, compatible], {
      agentPreference: {
        orderedRuntimeIds: ['preferred-cli', 'openhands'],
      },
      execution: {
        schemaVersion: VERSION,
        goal: 'Implement the requested repository change.',
        kind: 'coding',
        requirements: {
          workspace: 'git-worktree',
          structuredArtifacts: true,
        },
      },
    })
  );

  expect(result.matched).toBe(true);
  if (!result.matched) {
    return;
  }

  expect(result.selected.descriptor.runtimeId).toBe('openhands');
  expect(
    evaluationFor(result, 'preferred-cli').rejectionReasons.map(
      ({ code }) => code
    )
  ).toEqual(
    [
      'workspace-capability-insufficient',
      'structured-artifacts-required',
    ]
  );
});

test('malformed waiting-for-human capabilities fail closed', () => {
  const malformed = candidate('malformed-waiting-runtime', {
    capabilities: {
      nativeResume: false,
      waitingForHuman: true,
    },
  });
  const compatible = candidate('compatible-runtime');
  const result = matchExecutionRuntimeV1(
    request([malformed, compatible], {
      agentPreference: {
        orderedRuntimeIds: [
          'malformed-waiting-runtime',
          'compatible-runtime',
        ],
      },
    })
  );

  expect(result.matched).toBe(true);
  if (!result.matched) {
    return;
  }

  expect(result.selected.descriptor.runtimeId).toBe('compatible-runtime');
  expect(
    evaluationFor(
      result,
      'malformed-waiting-runtime'
    ).rejectionReasons.map(({ code }) => code)
  ).toEqual(['native-resume-required']);
});

test('explicit selection fails instead of falling back to another runtime', () => {
  const requested = candidate('requested', {
    availableSlots: 0,
  });
  const fallback = candidate('fallback');
  const result = matchExecutionRuntimeV1(
    request([requested, fallback], {
      strategy: {
        mode: 'explicit',
        runtimeId: 'requested',
      },
    })
  );

  expect(result.matched).toBe(false);
  if (result.matched) {
    return;
  }

  expect(result.failure.code).toBe('requested-runtime-ineligible');
  expect(
    evaluationFor(result, 'requested').rejectionReasons.map(
      ({ code }) => code
    )
  ).toEqual(['runtime-at-capacity']);
  expect(
    evaluationFor(result, 'fallback').rejectionReasons.some(
      ({ code }) => code === 'not-explicit-runtime'
    )
  ).toBe(true);
});

test('explicit selection reports a missing runtime clearly', () => {
  const result = matchExecutionRuntimeV1(
    request([candidate('registered')], {
      strategy: {
        mode: 'explicit',
        runtimeId: 'missing',
      },
    })
  );

  expect(result.matched).toBe(false);
  if (result.matched) {
    return;
  }

  expect(result.failure.code).toBe('requested-runtime-not-found');
  expect(result.failure.runtimeId).toBe('missing');
});

test('health and capacity are hard filters with explainable reasons', () => {
  const offline = candidate('offline', {
    health: {
      state: 'offline',
      acceptingNewAttempts: false,
    },
  });
  const saturated = candidate('saturated', {
    availableSlots: 0,
  });
  const result = matchExecutionRuntimeV1(request([offline, saturated]));

  expect(result.matched).toBe(false);
  if (result.matched) {
    return;
  }

  expect(result.failure.code).toBe('no-compatible-runtime');
  expect(
    evaluationFor(result, 'offline').rejectionReasons.map(
      ({ code }) => code
    )
  ).toEqual(['runtime-unhealthy', 'runtime-not-accepting-attempts']);
  expect(
    evaluationFor(result, 'saturated').rejectionReasons.map(
      ({ code }) => code
    )
  ).toEqual(['runtime-at-capacity']);
});

test('degraded runtime requires organization opt-in', () => {
  const degraded = candidate('degraded', {
    health: {
      state: 'degraded',
    },
  });
  const denied = matchExecutionRuntimeV1(request([degraded]));
  const allowed = matchExecutionRuntimeV1(
    request([degraded], {
      organizationPolicy: {
        allowedRuntimeIds: '*',
        allowDegradedRuntimes: true,
      },
    })
  );

  expect(denied.matched).toBe(false);
  expect(
    evaluationFor(denied, 'degraded').rejectionReasons.map(
      ({ code }) => code
    )
  ).toEqual(['runtime-degraded']);
  expect(allowed.matched).toBe(true);
});

test('matcher explains every unsupported execution requirement', () => {
  const limited = candidate('limited', {
    capabilities: {
      kinds: ['document'],
      nativeResume: false,
      checkpoint: false,
      streaming: 'none',
      interrupt: 'process-kill',
      workspace: 'directory',
      sandbox: 'host',
      structuredArtifacts: false,
      waitingForHuman: false,
      supportedModels: ['model-a'],
      features: ['read-files'],
    },
  });
  const result = matchExecutionRuntimeV1(
    request([limited], {
      execution: {
        schemaVersion: VERSION,
        goal: 'Implement the requested repository change.',
        kind: 'coding',
        model: 'model-b',
        requirements: {
          nativeResume: true,
          checkpoint: true,
          streaming: 'typed-events',
          interrupt: 'graceful',
          workspace: 'git-worktree',
          sandbox: ['container', 'vm'],
          structuredArtifacts: true,
          waitingForHuman: true,
          features: ['write-files'],
        },
      },
    })
  );

  expect(result.matched).toBe(false);
  expect(
    evaluationFor(result, 'limited').rejectionReasons.map(
      ({ code }) => code
    )
  ).toEqual(
    [
      'execution-kind-not-supported',
      'native-resume-required',
      'checkpoint-required',
      'streaming-capability-insufficient',
      'interrupt-capability-insufficient',
      'workspace-capability-insufficient',
      'sandbox-not-supported',
      'structured-artifacts-required',
      'waiting-for-human-required',
      'model-not-supported',
      'feature-not-supported',
    ]
  );
});

test('auto selection is deterministic after preference and priority ranking', () => {
  const result = matchExecutionRuntimeV1(
    request([
      candidate('z-runtime', {
        availableSlots: 3,
        selectionPriority: 10,
      }),
      candidate('a-runtime', {
        availableSlots: 3,
        selectionPriority: 10,
      }),
      candidate('more-capacity', {
        availableSlots: 20,
        selectionPriority: 5,
      }),
    ])
  );

  expect(result.matched).toBe(true);
  if (!result.matched) {
    return;
  }

  expect(result.selected.descriptor.runtimeId).toBe('a-runtime');
  expect(result.selectedBy).toBe('automatic-ranking');
});

test('duplicate runtime registrations invalidate the request', () => {
  const result = matchExecutionRuntimeV1(
    request([candidate('duplicate'), candidate('duplicate')])
  );

  expect(result.matched).toBe(false);
  if (result.matched) {
    return;
  }

  expect(result.failure.code).toBe('invalid-selection-request');
  expect(
    result.evaluations.every(({ rejectionReasons }) =>
      rejectionReasons.some(({ code }) => code === 'duplicate-runtime-id')
    )
  ).toBe(true);
});
