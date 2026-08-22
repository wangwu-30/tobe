import { createHash } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  mapExecutionAttempt,
  mapExecutionJob,
  parseContextManifestV1,
  parseExecutionJobReceiptV1,
  parseFrozenKnowledgeBindingV1,
  type ExecutionAttemptRecord,
  type ExecutionJobRecord,
} from './schema';

const NOW = '2026-08-21T12:00:00.000Z';
const CONTENT = 'Frozen execution context';
const CONTENT_SHA256 = createHash('sha256').update(CONTENT).digest('hex');

test('accepts a context manifest with a truly nullable project id', () => {
  const manifest = parseContextManifestV1(contextManifest(null));

  expect(manifest.workspace.projectId).toBeNull();
});

test('accepts an exact frozen knowledge binding with a full commit', () => {
  const baseCommit = 'a'.repeat(40);
  const manifest = parseContextManifestV1({
    ...contextManifest(null),
    knowledgeCommit: {
      schemaVersion: 1,
      bindingId: 'binding-a',
      spaceId: 'space-a',
      workspaceId: 'workspace-a',
      agentId: 'agent-a',
      mountPath: '/',
      defaultBranch: 'main',
      baseCommit,
    },
  });

  expect(manifest.knowledgeCommit).toEqual({
    schemaVersion: 1,
    bindingId: 'binding-a',
    spaceId: 'space-a',
    workspaceId: 'workspace-a',
    agentId: 'agent-a',
    mountPath: '/',
    defaultBranch: 'main',
    baseCommit,
  });
});

test('rejects unsafe or incomplete frozen knowledge bindings', () => {
  const binding = {
    schemaVersion: 1,
    bindingId: 'binding-a',
    spaceId: 'space-a',
    workspaceId: 'workspace-a',
    agentId: null,
    mountPath: '/',
    defaultBranch: 'main',
    baseCommit: 'a'.repeat(40),
  };

  expect(() =>
    parseFrozenKnowledgeBindingV1({ ...binding, baseCommit: 'a'.repeat(12) })
  ).toThrow('must be a full lowercase Git object id');
  expect(() =>
    parseFrozenKnowledgeBindingV1({ ...binding, mountPath: '/nested' })
  ).toThrow('mountPath must be "/"');
  expect(() =>
    parseFrozenKnowledgeBindingV1({ ...binding, repoPath: '/secret/repo' })
  ).toThrow('contains unsupported fields: repoPath');
  expect(() =>
    parseContextManifestV1({
      ...contextManifest(null),
      knowledgeCommit: { ...binding, workspaceId: 'workspace-b' },
    })
  ).toThrow('knowledge binding workspace must match');
});

test('rejects malformed stored execution job kind and status', () => {
  expect(() => mapExecutionJob(jobRecord({ kind: 'mystery' }))).toThrow(
    'Stored execution job kind is invalid.'
  );
  expect(() => mapExecutionJob(jobRecord({ status: 'mystery' }))).toThrow(
    'Stored execution job status is invalid.'
  );
});

test('rejects a malformed stored execution attempt status', () => {
  expect(() =>
    mapExecutionAttempt(attemptRecord({ status: 'mystery' }))
  ).toThrow('Stored execution job attempt status is invalid.');
});

test('maps the quarantined attempt status produced by recovery', () => {
  expect(mapExecutionAttempt(attemptRecord({ status: 'quarantined' })).status).toBe(
    'quarantined'
  );
});

test('strictly parses a blocked execution job receipt', () => {
  const receipt = parseExecutionJobReceiptV1(blockedReceipt());

  expect(receipt).toEqual(blockedReceipt());
});

test('rejects malformed receipt fields, extra fields, and invalid dates', () => {
  expect(() =>
    parseExecutionJobReceiptV1({ ...blockedReceipt(), revision: 0 })
  ).toThrow('revision must be positive');
  expect(() =>
    parseExecutionJobReceiptV1({ ...blockedReceipt(), acceptedAt: 'not-a-date' })
  ).toThrow('acceptedAt must be an ISO date string');
  expect(() =>
    parseExecutionJobReceiptV1({ ...blockedReceipt(), extra: true })
  ).toThrow('contains unsupported fields: extra');
});

test('rejects receipt status and selection inconsistencies', () => {
  expect(() =>
    parseExecutionJobReceiptV1({
      ...blockedReceipt(),
      status: 'queued',
      selectedRuntimeId: 'runtime-a',
    })
  ).toThrow('queued execution job receipt requires a matched');
  expect(() =>
    parseExecutionJobReceiptV1({
      ...blockedReceipt(),
      selectedRuntimeId: 'runtime-a',
    })
  ).toThrow('blocked execution job receipt requires an unmatched');
});

test('rejects malformed nested runtime selections in receipts', () => {
  expect(() =>
    parseExecutionJobReceiptV1({
      ...blockedReceipt(),
      selection: {
        ...blockedReceipt().selection,
        failure: { code: 'invented', message: 'not allowed' },
      },
    })
  ).toThrow('Runtime selection failure code is invalid');
  expect(() =>
    parseExecutionJobReceiptV1({
      ...blockedReceipt(),
      selection: {
        ...blockedReceipt().selection,
        selectedBy: 'automatic-ranking',
      },
    })
  ).toThrow('contains unsupported fields: selectedBy');
});

function blockedReceipt() {
  return {
    schemaVersion: 1 as const,
    jobId: 'job-a',
    teamTaskId: null,
    status: 'blocked' as const,
    revision: 1,
    selectedRuntimeId: null,
    selection: {
      schemaVersion: 1 as const,
      matched: false as const,
      selected: null,
      evaluations: [],
      failure: {
        code: 'no-compatible-runtime' as const,
        message: 'No compatible runtime is registered.',
      },
    },
    acceptedAt: NOW,
  };
}

function contextManifest(projectId: string | null) {
  return {
    schemaVersion: 1,
    goal: 'Preserve the manifest contract',
    frozenAt: NOW,
    source: {
      type: 'workspace-draft',
      workspaceId: 'workspace-a',
      conversationId: null,
      documentVersionId: null,
    },
    workspace: {
      id: 'workspace-a',
      projectId,
      title: 'Workspace A',
      draftRevision: 2,
      revision: 3,
    },
    document: {
      id: 'workspace-a',
      title: 'Workspace A',
      versionId: null,
      revision: 2,
      content: CONTENT,
      contentSha256: CONTENT_SHA256,
    },
    files: [],
    roomWatermark: null,
    knowledgeCommit: null,
  };
}

function jobRecord(
  overrides: Partial<ExecutionJobRecord> = {}
): ExecutionJobRecord {
  return {
    id: 'job-a',
    organizationId: 'organization-a',
    teamTaskId: null,
    originRoomId: null,
    originRoomMessageId: null,
    kind: 'coding',
    status: 'queued',
    priority: 0,
    specJson: JSON.stringify({
      schemaVersion: 1,
      goal: 'Preserve the manifest contract',
      kind: 'coding',
      requirements: {},
    }),
    requirementsJson: '{}',
    contextManifestJson: JSON.stringify(contextManifest(null)),
    selectionJson: JSON.stringify({
      schemaVersion: 1,
      matched: false,
      evaluations: [],
      failure: {
        code: 'no-compatible-runtime',
        message: 'No compatible runtime is registered.',
      },
    }),
    requestedRuntimeId: null,
    selectedRuntimeId: null,
    selectionReason: 'no-compatible-runtime',
    selectedAt: null,
    maxAttempts: 1,
    deadlineAt: null,
    queuedAt: NOW,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    resultJson: null,
    errorJson: null,
    revision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function attemptRecord(
  overrides: Partial<ExecutionAttemptRecord> = {}
): ExecutionAttemptRecord {
  return {
    id: 'attempt-a',
    jobId: 'job-a',
    runtimeId: null,
    number: 1,
    status: 'pending',
    generation: 0,
    leaseOwnerId: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    runtimeRunId: null,
    checkpointJson: null,
    resultJson: null,
    errorJson: null,
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}
