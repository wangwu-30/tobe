import { expect, test } from '@playwright/test';

import type { Prisma } from '@/generated/prisma/client';
import { ValidationError } from '@/framework/resilience/app-error';

import { executionAdmissionTestApiV1 } from './commands';

const BASE_COMMIT = 'a'.repeat(40);
const ACTOR = { organizationId: 'organization-a' };
const INPUT = {
  conversationId: 'conversation-a',
  documentVersionId: 'version-a',
  goal: 'Ship the aligned version',
  projectId: 'project-a',
  teamTaskId: 'task-a',
  trustedAgentId: 'agent-a',
  workspaceId: 'workspace-a',
};

test('resolves Git only while taking the pre-transaction admission snapshot', async () => {
  const state = admissionState();
  let resolverCalls = 0;
  let resolverActive = false;
  const before = await executionAdmissionTestApiV1.materializeContextManifestV1(
    admissionDb(state, () => {
      expect(resolverActive).toBe(false);
    }),
    ACTOR,
    INPUT,
    {
      async resolve(input) {
        resolverCalls += 1;
        resolverActive = true;
        expect(input).toEqual({
          repoPath: '/repos/team-knowledge',
          defaultBranch: 'main',
        });
        resolverActive = false;
        return BASE_COMMIT.toUpperCase();
      },
    }
  );

  const revalidated =
    await executionAdmissionTestApiV1.revalidateContextManifestV1(
      admissionDb(state, () => {
        expect(resolverActive).toBe(false);
      }),
      ACTOR,
      INPUT,
      before
    );

  expect(resolverCalls).toBe(1);
  expect(revalidated).toBe(before);
  expect(before.contextManifest.knowledgeCommit).toMatchObject({
    bindingId: 'binding-a',
    spaceId: 'space-a',
    workspaceId: 'workspace-a',
    agentId: 'agent-a',
    defaultBranch: 'main',
    baseCommit: BASE_COMMIT,
  });
  expect(before.knowledgeSnapshot).toEqual({
    activeSnapshotId: 'snapshot-a',
    organizationId: 'organization-a',
    spaceId: 'space-a',
    commitSha: BASE_COMMIT,
    readyAt: '2026-08-21T11:00:00.000Z',
  });
});

test('rejects workspace, version, alignment, identity, and binding drift', async () => {
  const cases: Array<{
    name: string;
    mutate(state: AdmissionState): void;
  }> = [
    {
      name: 'workspace identity',
      mutate: (state) => {
        state.workspace.revision += 1;
      },
    },
    {
      name: 'version content',
      mutate: (state) => {
        state.version.content = 'changed';
      },
    },
    {
      name: 'aligned state',
      mutate: (state) => {
        state.version.labels = [{ kind: 'milestone' }];
      },
    },
    {
      name: 'agent scope',
      mutate: (state) => {
        state.teamTask.assigneeId = 'agent-b';
      },
    },
    {
      name: 'binding identity',
      mutate: (state) => {
        state.binding.bindingId = 'binding-b';
      },
    },
    {
      name: 'default branch',
      mutate: (state) => {
        state.binding.defaultBranch = 'release';
      },
    },
    {
      name: 'repository path',
      mutate: (state) => {
        state.binding.repoPath = '/repos/replaced';
      },
    },
    {
      name: 'active snapshot pointer',
      mutate: (state) => {
        state.activeSnapshot!.activeSnapshotId = 'snapshot-b';
      },
    },
    {
      name: 'active snapshot commit',
      mutate: (state) => {
        state.activeSnapshot!.commitSha = 'c'.repeat(40);
      },
    },
    {
      name: 'active snapshot space',
      mutate: (state) => {
        state.activeSnapshot!.spaceId = 'space-b';
      },
    },
  ];

  for (const drift of cases) {
    const state = admissionState();
    const before =
      await executionAdmissionTestApiV1.materializeContextManifestV1(
        admissionDb(state),
        ACTOR,
        INPUT,
        resolverReturning(BASE_COMMIT)
      );
    drift.mutate(state);

    await expect(
      executionAdmissionTestApiV1.revalidateContextManifestV1(
        admissionDb(state),
        ACTOR,
        INPUT,
        before
      ),
      drift.name
    ).rejects.toBeInstanceOf(ValidationError);
  }
});

test('rejects a future active snapshot and revalidates a frozen absence', async () => {
  const futureState = admissionState();
  futureState.activeSnapshot!.readyAt = '2999-01-01T00:00:00.000Z';
  await expect(
    executionAdmissionTestApiV1.materializeContextManifestV1(
      admissionDb(futureState),
      ACTOR,
      INPUT,
      resolverReturning(BASE_COMMIT)
    )
  ).rejects.toThrow('must be ready before execution admission');

  const state = admissionState();
  state.activeSnapshot = null;
  const before = await executionAdmissionTestApiV1.materializeContextManifestV1(
    admissionDb(state),
    ACTOR,
    INPUT,
    resolverReturning(BASE_COMMIT)
  );
  expect(before.knowledgeSnapshot).toBeNull();

  state.activeSnapshot = {
    activeSnapshotId: 'snapshot-late',
    organizationId: 'organization-a',
    spaceId: 'space-a',
    commitSha: BASE_COMMIT,
    readyAt: '2026-08-21T11:30:00.000Z',
  };
  await expect(
    executionAdmissionTestApiV1.revalidateContextManifestV1(
      admissionDb(state),
      ACTOR,
      INPUT,
      before
    )
  ).rejects.toThrow('Knowledge active snapshot changed');
});

test('keeps the first-proposal path valid when no active snapshot exists', async () => {
  const state = admissionState();
  state.activeSnapshot = null;

  const before = await executionAdmissionTestApiV1.materializeContextManifestV1(
    admissionDb(state),
    ACTOR,
    INPUT,
    resolverReturning(BASE_COMMIT)
  );
  await expect(
    executionAdmissionTestApiV1.revalidateContextManifestV1(
      admissionDb(state),
      ACTOR,
      INPUT,
      before
    )
  ).resolves.toBe(before);
});

test('rejects an active snapshot for a different repository commit', async () => {
  const state = admissionState();
  state.activeSnapshot!.commitSha = 'b'.repeat(40);

  await expect(
    executionAdmissionTestApiV1.materializeContextManifestV1(
      admissionDb(state),
      ACTOR,
      INPUT,
      resolverReturning(BASE_COMMIT)
    )
  ).rejects.toThrow('snapshot commit must match');
});

test('fails closed when a trusted binding cannot be resolved', async () => {
  const state = admissionState();

  await expect(
    executionAdmissionTestApiV1.materializeContextManifestV1(
      admissionDb(state),
      ACTOR,
      INPUT,
      {
        async resolve() {
          throw new Error('git unavailable');
        },
      }
    )
  ).rejects.toThrow('Knowledge binding could not be frozen');

  await expect(
    executionAdmissionTestApiV1.materializeContextManifestV1(
      admissionDb(state),
      ACTOR,
      INPUT,
      resolverReturning('not-a-full-commit')
    )
  ).rejects.toThrow('Knowledge binding could not be frozen');
});

type AdmissionState = ReturnType<typeof admissionState>;

function admissionState() {
  return {
    workspace: {
      id: 'workspace-a',
      projectId: 'project-a',
      sessionId: 'conversation-a',
      title: 'Workspace A',
      content: 'draft',
      draftRevision: 3,
      revision: 7,
    },
    version: {
      id: 'version-a',
      title: 'Aligned Version',
      content: 'immutable content',
      revision: 4,
      labels: [{ kind: 'milestone' }, { kind: 'aligned' }],
    },
    conversation: {
      id: 'conversation-a',
      projectId: 'project-a',
      wikiId: null as string | null,
    },
    teamTask: {
      id: 'task-a',
      projectId: 'project-a',
      workspaceId: 'workspace-a',
      assigneeType: 'agent',
      assigneeId: 'agent-a',
    },
    room: { id: 'room-a' },
    roomMessage: { id: 'message-a', sequence: 8 },
    binding: {
      bindingId: 'binding-a',
      workspaceId: 'workspace-a',
      agentId: 'agent-a',
      spaceId: 'space-a',
      mountPath: '/',
      access: 'propose',
      scope: 'agent',
      ownerAgentId: 'agent-a',
      repoPath: '/repos/team-knowledge',
      repoUrl: null as string | null,
      defaultBranch: 'main',
    },
    activeSnapshot: {
      activeSnapshotId: 'snapshot-a',
      organizationId: 'organization-a',
      spaceId: 'space-a',
      commitSha: BASE_COMMIT,
      readyAt: '2026-08-21T11:00:00.000Z',
    } as {
      activeSnapshotId: string;
      organizationId: string;
      spaceId: string;
      commitSha: string;
      readyAt: Date | string;
    } | null,
  };
}

function admissionDb(
  state: AdmissionState,
  onQuery?: () => void
) {
  return {
    document: {
      async findFirst(args: { where: { id: string } }) {
        onQuery?.();
        if (args.where.id !== state.workspace.id) return null;
        return { ...state.workspace };
      },
    },
    version: {
      async findFirst() {
        onQuery?.();
        return { ...state.version, labels: state.version.labels.map((label) => ({ ...label })) };
      },
    },
    session: {
      async findFirst() {
        onQuery?.();
        return { ...state.conversation };
      },
    },
    teamTask: {
      async findFirst() {
        onQuery?.();
        return { ...state.teamTask };
      },
    },
    room: {
      async findUnique() {
        onQuery?.();
        return { ...state.room };
      },
    },
    roomMessage: {
      async findFirst() {
        onQuery?.();
        return { ...state.roomMessage };
      },
    },
    async $queryRaw(strings: TemplateStringsArray) {
      onQuery?.();
      const sql = strings.join('?');
      if (sql.includes('space."activeSnapshotId" AS "activeSnapshotId"')) {
        return state.activeSnapshot
          ? [{
              ...state.activeSnapshot,
              snapshotId: state.activeSnapshot.activeSnapshotId,
            }]
          : [{
              activeSnapshotId: null,
              snapshotId: null,
              organizationId: null,
              spaceId: null,
              commitSha: null,
              readyAt: null,
            }];
      }
      if (sql.includes('SELECT binding."id" AS "bindingId"') &&
          !sql.includes('space."scope" AS "scope"')) {
        return [{ bindingId: state.binding.bindingId }];
      }
      return [{ ...state.binding }];
    },
  } as unknown as Prisma.TransactionClient;
}

function resolverReturning(commit: string) {
  return {
    async resolve() {
      return commit;
    },
  };
}
