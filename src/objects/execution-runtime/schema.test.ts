import { expect, test } from '@playwright/test';

import {
  RUNTIME_CONTRACT_VERSION_V1,
  matchExecutionRuntimeV1,
} from '@/agent/execution';

import { deriveExecutionRuntimeSelectionContextV1 } from './queries';
import {
  mapExecutionRuntimeCandidateV1,
  mapExecutionRuntimeV1,
  parseRuntimeCapabilitiesJsonV1,
  type ExecutionRuntimeRow,
} from './schema';

const VALID_CAPABILITIES = {
  schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
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
  features: ['shell'],
} as const;
const MAPPING_OPTIONS = { now: new Date('2026-08-21T10:00:20.000Z') };

function row(
  overrides: Partial<ExecutionRuntimeRow> = {}
): ExecutionRuntimeRow {
  return {
    id: 'runtime-internal-id',
    organizationId: 'organization-a',
    key: 'openhands',
    name: 'OpenHands',
    driver: 'openhands',
    version: '1.2.3',
    endpoint: 'http://runtime.invalid',
    enabled: true,
    registrationJson: '{"selectionPriority":7}',
    capabilitiesJson: JSON.stringify(VALID_CAPABILITIES),
    healthStatus: 'healthy',
    healthJson:
      '{"acceptingNewAttempts":true,"message":"ready"}',
    lastHeartbeatAt: '2026-08-21T10:00:00.000Z',
    capacityTotal: 4,
    capacityUsed: 1,
    capacityJson: '{"queueDepth":2}',
    capacityUpdatedAt: '2026-08-21T10:00:01.000Z',
    createdAt: '2026-08-20T10:00:00.000Z',
    updatedAt: '2026-08-21T10:00:02.000Z',
    ...overrides,
  };
}

test('maps the database id as runtimeId while exposing the key separately', () => {
  const runtime = mapExecutionRuntimeV1(row(), MAPPING_OPTIONS);
  const candidate = mapExecutionRuntimeCandidateV1(row(), MAPPING_OPTIONS);

  expect(runtime).toMatchObject({
    runtimeId: 'runtime-internal-id',
    organizationId: 'organization-a',
    key: 'openhands',
    enabled: true,
    registration: { selectionPriority: 7 },
    health: {
      state: 'healthy',
      acceptingNewAttempts: true,
      message: 'ready',
      observedAt: '2026-08-21T10:00:00.000Z',
    },
    capacity: {
      availableSlots: 3,
      activeAttempts: 1,
      maxConcurrentAttempts: 4,
    },
  });
  expect(candidate.descriptor).toMatchObject({
    runtimeId: 'runtime-internal-id',
    displayName: 'OpenHands',
    runtimeVersion: '1.2.3',
    selectionPriority: 7,
    capabilities: VALID_CAPABILITIES,
  });
});
test('invalid JSON and malformed capability values fail closed', () => {
  const candidate = mapExecutionRuntimeCandidateV1(
    row({
      capabilitiesJson: '{not-json',
      healthStatus: 'unknown',
      healthJson: '{not-json',
      registrationJson: '[]',
      capacityJson: 'null',
      capacityTotal: -1,
      capacityUsed: 2,
    }),
    MAPPING_OPTIONS
  );

  expect(candidate.descriptor.capabilities).toMatchObject({
    kinds: [],
    nativeResume: false,
    supportedModels: [],
  });
  expect(candidate.descriptor.selectionPriority).toBeUndefined();
  expect(candidate.health).toEqual({
    state: 'offline',
    acceptingNewAttempts: false,
    observedAt: '2026-08-21T10:00:00.000Z',
  });
  expect(candidate.capacity.availableSlots).toBe(0);
});

test('disabled runtimes are never represented as eligible snapshots', () => {
  const candidate = mapExecutionRuntimeCandidateV1(
    row({ enabled: false }),
    MAPPING_OPTIONS
  );

  expect(candidate.health).toMatchObject({
    state: 'offline',
    acceptingNewAttempts: false,
  });
  expect(candidate.capacity.availableSlots).toBe(0);
});

test('heartbeat TTL makes stale runtimes effectively offline', () => {
  const freshAt = new Date('2026-08-21T10:00:30.000Z');
  const staleAt = new Date('2026-08-21T10:00:30.001Z');

  expect(mapExecutionRuntimeCandidateV1(row(), { now: freshAt })).toMatchObject({
    health: { state: 'healthy', acceptingNewAttempts: true },
    capacity: { availableSlots: 3 },
  });
  expect(mapExecutionRuntimeCandidateV1(row(), { now: staleAt })).toMatchObject({
    health: { state: 'offline', acceptingNewAttempts: false },
    capacity: { availableSlots: 0, activeAttempts: 1 },
  });
  expect(
    mapExecutionRuntimeCandidateV1(row({ lastHeartbeatAt: null }), {
      now: freshAt,
    })
  ).toMatchObject({
    health: { state: 'offline', acceptingNewAttempts: false },
    capacity: { availableSlots: 0 },
  });
});

test('capability parser rejects partial or wrong-version JSON', () => {
  expect(parseRuntimeCapabilitiesJsonV1('{}')).toBeNull();
  expect(
    parseRuntimeCapabilitiesJsonV1(
      JSON.stringify({ ...VALID_CAPABILITIES, schemaVersion: 2 })
    )
  ).toBeNull();
  expect(
    parseRuntimeCapabilitiesJsonV1(JSON.stringify(VALID_CAPABILITIES))
  ).toEqual(VALID_CAPABILITIES);
});

test('capability parser rejects waiting-for-human without native resume', () => {
  expect(
    parseRuntimeCapabilitiesJsonV1(
      JSON.stringify({
        ...VALID_CAPABILITIES,
        nativeResume: false,
        waitingForHuman: true,
      })
    )
  ).toBeNull();
  expect(
    parseRuntimeCapabilitiesJsonV1(
      JSON.stringify({
        ...VALID_CAPABILITIES,
        nativeResume: false,
        waitingForHuman: false,
      })
    )
  ).not.toBeNull();
});

const POLICY_ORGANIZATION = 'runtime-policy-org';
const EMPTY_POLICY_ORGANIZATION = 'runtime-policy-empty-org';
const DEGRADED_POLICY_ORGANIZATION = 'runtime-policy-degraded-org';
const OTHER_ORGANIZATION = 'runtime-policy-other-org';
const ENABLED_RUNTIME_ID = 'runtime-policy-enabled';
const DISABLED_RUNTIME_ID = 'runtime-policy-disabled';
const DEGRADED_RUNTIME_ID = 'runtime-policy-degraded';

test.describe('server-owned runtime selection policy', () => {
  test('allows only enabled rows in the actor organization and keeps disabled candidates', () => {
    const context = deriveExecutionRuntimeSelectionContextV1(
      { organizationId: POLICY_ORGANIZATION },
      [
        policyRow(ENABLED_RUNTIME_ID, POLICY_ORGANIZATION, true),
        policyRow(DISABLED_RUNTIME_ID, POLICY_ORGANIZATION, false),
        policyRow('runtime-policy-other-enabled', OTHER_ORGANIZATION, true),
      ],
      MAPPING_OPTIONS
    );
    const candidateIds = context.candidates
      .map(({ descriptor }) => descriptor.runtimeId)
      .sort();

    expect(context.organizationPolicy).toEqual({
      allowedRuntimeIds: [ENABLED_RUNTIME_ID],
      allowDegradedRuntimes: false,
    });
    expect(candidateIds).toContain(ENABLED_RUNTIME_ID);
    expect(candidateIds).toContain(DISABLED_RUNTIME_ID);
    expect(candidateIds).not.toContain('runtime-policy-other-enabled');

    const selection = matchExecutionRuntimeV1({
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      execution: executionSpec(),
      strategy: { mode: 'explicit', runtimeId: DISABLED_RUNTIME_ID },
      ...context,
    });

    expect(selection.matched).toBe(false);
    expect(selection.evaluations).toHaveLength(context.candidates.length);
    expect(
      selection.evaluations
        .find(
          ({ candidate }) =>
            candidate.descriptor.runtimeId === DISABLED_RUNTIME_ID
        )
        ?.rejectionReasons.map(({ code }) => code)
    ).toContain('not-allowed-by-organization');
  });

  test('an empty enabled-row allowlist fails closed', () => {
    const context = deriveExecutionRuntimeSelectionContextV1(
      { organizationId: EMPTY_POLICY_ORGANIZATION },
      [policyRow('runtime-policy-disabled-only', EMPTY_POLICY_ORGANIZATION, false)],
      MAPPING_OPTIONS
    );
    const selection = matchExecutionRuntimeV1({
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      execution: executionSpec(),
      strategy: { mode: 'auto' },
      ...context,
    });

    expect(context.organizationPolicy.allowedRuntimeIds).toEqual([]);
    expect(context.candidates.length).toBeGreaterThan(0);
    expect(selection).toMatchObject({
      matched: false,
      failure: { code: 'no-compatible-runtime' },
    });
    expect(
      selection.evaluations.every(({ rejectionReasons }) =>
        rejectionReasons.some(
          ({ code }) => code === 'not-allowed-by-organization'
        )
      )
    ).toBe(true);
  });

  test('enabled degraded runtimes remain disallowed by MVP policy', () => {
    const context = deriveExecutionRuntimeSelectionContextV1(
      { organizationId: DEGRADED_POLICY_ORGANIZATION },
      [
        policyRow(
          DEGRADED_RUNTIME_ID,
          DEGRADED_POLICY_ORGANIZATION,
          true,
          'degraded'
        ),
      ],
      MAPPING_OPTIONS
    );
    const selection = matchExecutionRuntimeV1({
      schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
      execution: executionSpec(),
      strategy: { mode: 'explicit', runtimeId: DEGRADED_RUNTIME_ID },
      ...context,
    });

    expect(context.organizationPolicy).toEqual({
      allowedRuntimeIds: [DEGRADED_RUNTIME_ID],
      allowDegradedRuntimes: false,
    });
    expect(selection).toMatchObject({
      matched: false,
      failure: {
        code: 'requested-runtime-ineligible',
        runtimeId: DEGRADED_RUNTIME_ID,
      },
    });
    expect(
      selection.evaluations
        .find(
          ({ candidate }) =>
            candidate.descriptor.runtimeId === DEGRADED_RUNTIME_ID
        )
        ?.rejectionReasons.map(({ code }) => code)
    ).toContain('runtime-degraded');
  });
});

function policyRow(
  id: string,
  organizationId: string,
  enabled: boolean,
  healthStatus: 'degraded' | 'healthy' = 'healthy'
): ExecutionRuntimeRow {
  return row({
    id,
    organizationId,
    key: id,
    name: id,
    enabled,
    healthStatus,
    healthJson: '{"acceptingNewAttempts":true}',
    capacityTotal: 1,
    capacityUsed: 0,
  });
}

function executionSpec() {
  return {
    schemaVersion: RUNTIME_CONTRACT_VERSION_V1,
    goal: 'Exercise the server-owned runtime policy.',
    kind: 'coding' as const,
    requirements: {},
  };
}
