import { expect, test } from '@playwright/test';

import type { Prisma } from '@/generated/prisma/client';

import {
  resolveKnowledgeAdmissionV1,
  selectKnowledgeAdmissionCandidateV1,
  type KnowledgeAdmissionBaseCommitResolverV1,
} from './admission';

const BASE_COMMIT = 'a'.repeat(40);

test('prefers one valid agent binding over a global fallback', async () => {
  const resolverInputs: unknown[] = [];
  const result = await resolveKnowledgeAdmissionV1(
    dbWithRows([
      candidate({ bindingId: 'global-binding' }),
      candidate({
        bindingId: 'agent-binding',
        agentId: 'agent-a',
        ownerAgentId: 'agent-a',
        scope: 'agent',
        spaceId: 'agent-space',
      }),
    ]),
    {
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      agentId: 'agent-a',
    },
    resolverReturning(BASE_COMMIT, resolverInputs)
  );

  expect(result).toEqual({
    schemaVersion: 1,
    bindingId: 'agent-binding',
    spaceId: 'agent-space',
    workspaceId: 'workspace-a',
    agentId: 'agent-a',
    mountPath: '/',
    defaultBranch: 'main',
    baseCommit: BASE_COMMIT,
  });
  expect(resolverInputs).toEqual([
    { repoPath: '/trusted/knowledge.git', defaultBranch: 'main' },
  ]);
  expect(JSON.stringify(result)).not.toContain('repoPath');
});

test('an admission without an agent only considers the global binding', async () => {
  const result = await resolveKnowledgeAdmissionV1(
    dbWithRows([
      candidate({
        bindingId: 'agent-binding',
        agentId: 'agent-a',
        ownerAgentId: 'agent-a',
        scope: 'agent',
      }),
      candidate({ bindingId: 'global-binding' }),
    ]),
    {
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      agentId: null,
    },
    resolverReturning(BASE_COMMIT)
  );

  expect(result?.bindingId).toBe('global-binding');
  expect(result?.agentId).toBeNull();
});

test('fails closed to null for ambiguity, invalid scope, or invalid commit', async () => {
  const input = {
    organizationId: 'organization-a',
    workspaceId: 'workspace-a',
    agentId: 'agent-a',
  };

  await expect(
    resolveKnowledgeAdmissionV1(
      dbWithRows([
        candidate({
          bindingId: 'agent-one',
          agentId: 'agent-a',
          ownerAgentId: 'agent-a',
          scope: 'agent',
        }),
        candidate({
          bindingId: 'agent-two',
          agentId: 'agent-a',
          ownerAgentId: 'agent-a',
          scope: 'agent',
        }),
      ]),
      input,
      resolverReturning(BASE_COMMIT)
    )
  ).resolves.toBeNull();

  await expect(
    resolveKnowledgeAdmissionV1(
      dbWithRows([
        candidate({
          agentId: 'agent-a',
          ownerAgentId: 'different-agent',
          scope: 'agent',
        }),
      ]),
      input,
      resolverReturning(BASE_COMMIT)
    )
  ).resolves.toBeNull();

  await expect(
    resolveKnowledgeAdmissionV1(
      dbWithRows([candidate()]),
      input,
      resolverReturning('short-sha')
    )
  ).resolves.toBeNull();
});

test('rejects a nullable repository path before calling the resolver', async () => {
  const resolverInputs: unknown[] = [];

  await expect(
    resolveKnowledgeAdmissionV1(
      dbWithRows([candidate({ repoPath: null })]),
      {
        organizationId: 'organization-a',
        workspaceId: 'workspace-a',
        agentId: null,
      },
      resolverReturning(BASE_COMMIT, resolverInputs)
    )
  ).resolves.toBeNull();
  expect(resolverInputs).toEqual([]);
});

test('the selected admission candidate exposes a non-null repository path', async () => {
  const selected = await selectKnowledgeAdmissionCandidateV1(
    dbWithRows([candidate()]),
    {
      organizationId: 'organization-a',
      workspaceId: 'workspace-a',
      agentId: null,
    }
  );

  expect(selected).not.toBeNull();
  if (selected) {
    const repoPath: string = selected.repoPath;
    expect(repoPath).toBe('/trusted/knowledge.git');
  }
});

function candidate(
  overrides: Partial<AdmissionCandidate> = {}
): AdmissionCandidate {
  return {
    bindingId: 'binding-a',
    workspaceId: 'workspace-a',
    agentId: null,
    spaceId: 'space-a',
    mountPath: '/',
    access: 'propose',
    scope: 'team',
    ownerAgentId: null,
    repoPath: '/trusted/knowledge.git',
    repoUrl: null,
    defaultBranch: 'main',
    ...overrides,
  };
}

type AdmissionCandidate = {
  bindingId: string;
  workspaceId: string;
  agentId: string | null;
  spaceId: string;
  mountPath: string;
  access: string;
  scope: string;
  ownerAgentId: string | null;
  repoPath: string | null;
  repoUrl: string | null;
  defaultBranch: string;
};

function dbWithRows(rows: readonly AdmissionCandidate[]) {
  return {
    async $queryRaw() {
      return rows;
    },
  } as unknown as Prisma.TransactionClient;
}

function resolverReturning(
  commit: string,
  calls: unknown[] = []
): KnowledgeAdmissionBaseCommitResolverV1 {
  return {
    async resolve(input) {
      calls.push(input);
      return commit;
    },
  };
}
