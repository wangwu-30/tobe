import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createClient, type Client } from '@libsql/client';
import { expect, test } from '@playwright/test';

import { ConflictError, ForbiddenError, ValidationError } from '@/framework/resilience';
import {
  DAO_DEVICE_HEADER,
  DAO_ORGANIZATION_HEADER,
  DAO_USER_HEADER,
  LOCAL_DEVICE_ID,
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
} from '@/lib/platform/defaults';
import { getPlatformContextFromHeaders } from '@/lib/platform/server-context';

import {
  approveKnowledgeChangeRequest,
  createKnowledgeBinding,
  createKnowledgeChangeRequest,
  createKnowledgeSnapshot,
  createKnowledgeSpace,
  markKnowledgeChangeRequestConflicted,
  queueKnowledgeMerge,
  recordKnowledgeChangeRequestMerged,
  rejectKnowledgeChangeRequest,
} from './commands';
import {
  getKnowledgeChangeRequest,
  getKnowledgeSpace,
  listKnowledgeBindings,
  listKnowledgeChangeRequests,
  listKnowledgeSnapshots,
  listKnowledgeSpaces,
} from './queries';
import { prisma as testPrisma } from './test-prisma';
import type { KnowledgeHumanActor } from './queries';

const ORG_A = {
  actorType: 'user' as const,
  organizationId: 'knowledge-org-a',
  userId: 'reviewer-a',
};
const ORG_B = {
  actorType: 'user' as const,
  organizationId: 'knowledge-org-b',
  userId: 'reviewer-b',
};
const MERGE_ACTOR_A = {
  authority: 'knowledge-merge-service' as const,
  organizationId: ORG_A.organizationId,
};
const ADMIN_A = {
  actorType: 'user' as const,
  organizationId: ORG_A.organizationId,
  userId: 'admin-a',
};
const MEMBER_A = {
  actorType: 'user' as const,
  organizationId: ORG_A.organizationId,
  userId: 'member-a',
};
const OUTSIDER_A = {
  actorType: 'user' as const,
  organizationId: ORG_A.organizationId,
  userId: 'outsider-a',
};
const JOB_A = 'knowledge-job-a';
const ATTEMPT_A = 'knowledge-attempt-a';
const JOB_B = 'knowledge-job-b';
const ATTEMPT_B = 'knowledge-attempt-b';

let client: Client;
let temporaryRoot: string;

test.describe.serial('git knowledge control plane', () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tobe-knowledge-'));
    const databasePath = path.join(temporaryRoot, 'knowledge.db');
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });

    await client.executeMultiple(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE "Organization" (
        "id" TEXT NOT NULL PRIMARY KEY
      );
      CREATE TABLE "OrganizationMembership" (
        "organizationId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "role" TEXT NOT NULL,
        UNIQUE ("organizationId", "userId")
      );
      CREATE TABLE "ExecutionJob" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL
      );
      CREATE TABLE "ExecutionAttempt" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL
      );
      CREATE TABLE "AgentProfile" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL
      );
      CREATE TABLE "Document" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "deletedAt" DATETIME
      );
      CREATE TABLE "KnowledgeSpace" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "scope" TEXT NOT NULL,
        "ownerAgentId" TEXT,
        "repoPath" TEXT,
        "repoUrl" TEXT,
        "defaultBranch" TEXT NOT NULL,
        "credentialRef" TEXT,
        "activeSnapshotId" TEXT,
        "readPolicy" TEXT NOT NULL,
        "writePolicy" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL,
        UNIQUE ("id", "organizationId")
      );
      CREATE TABLE "KnowledgeBinding" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "agentId" TEXT,
        "spaceId" TEXT NOT NULL,
        "mountPath" TEXT NOT NULL,
        "access" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL,
        FOREIGN KEY ("spaceId", "organizationId")
          REFERENCES "KnowledgeSpace" ("id", "organizationId")
      );
      CREATE TABLE "KnowledgeSnapshot" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "spaceId" TEXT NOT NULL,
        "changeRequestId" TEXT NOT NULL,
        "commitSha" TEXT NOT NULL,
        "indexVersion" TEXT NOT NULL,
        "artifactPath" TEXT NOT NULL,
        "artifactSha256" TEXT NOT NULL,
        "readyAt" DATETIME NOT NULL,
        "createdAt" DATETIME NOT NULL,
        FOREIGN KEY ("spaceId", "organizationId")
          REFERENCES "KnowledgeSpace" ("id", "organizationId")
      );
      CREATE TABLE "KnowledgeChangeRequest" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "attemptId" TEXT NOT NULL,
        "spaceId" TEXT NOT NULL,
        "baseCommit" TEXT NOT NULL,
        "headCommit" TEXT NOT NULL,
        "branchName" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "diffSummary" TEXT NOT NULL,
        "diffMetadataJson" TEXT NOT NULL,
        "reviewerId" TEXT,
        "reviewNote" TEXT,
        "reviewedAt" DATETIME,
        "mergedCommit" TEXT,
        "mergedAt" DATETIME,
        "revision" INTEGER NOT NULL,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL,
        FOREIGN KEY ("spaceId", "organizationId")
          REFERENCES "KnowledgeSpace" ("id", "organizationId")
      );
      CREATE TABLE "KnowledgeMergeOperation" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "changeRequestId" TEXT NOT NULL,
        "requestedById" TEXT NOT NULL,
        "expectedRevision" INTEGER NOT NULL,
        "expectedBaseCommit" TEXT NOT NULL,
        "expectedHeadCommit" TEXT NOT NULL,
        "indexVersion" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "attemptCount" INTEGER NOT NULL,
        "leaseOwnerId" TEXT,
        "leaseExpiresAt" DATETIME,
        "mergedCommit" TEXT,
        "snapshotId" TEXT,
        "errorCode" TEXT,
        "errorMessage" TEXT,
        "startedAt" DATETIME,
        "completedAt" DATETIME,
        "createdAt" DATETIME NOT NULL,
        "updatedAt" DATETIME NOT NULL,
        UNIQUE ("changeRequestId", "expectedRevision")
      );
    `);

    await client.batch(
      [
        { sql: 'INSERT INTO "Organization" ("id") VALUES (?)', args: [ORG_A.organizationId] },
        { sql: 'INSERT INTO "Organization" ("id") VALUES (?)', args: [ORG_B.organizationId] },
        { sql: 'INSERT INTO "OrganizationMembership" ("organizationId", "userId", "role") VALUES (?, ?, ?)', args: [ORG_A.organizationId, ORG_A.userId, 'owner'] },
        { sql: 'INSERT INTO "OrganizationMembership" ("organizationId", "userId", "role") VALUES (?, ?, ?)', args: [ORG_A.organizationId, ADMIN_A.userId, 'admin'] },
        { sql: 'INSERT INTO "OrganizationMembership" ("organizationId", "userId", "role") VALUES (?, ?, ?)', args: [ORG_A.organizationId, MEMBER_A.userId, 'member'] },
        { sql: 'INSERT INTO "OrganizationMembership" ("organizationId", "userId", "role") VALUES (?, ?, ?)', args: [ORG_B.organizationId, ORG_B.userId, 'admin'] },
        { sql: 'INSERT INTO "ExecutionJob" ("id", "organizationId") VALUES (?, ?)', args: [JOB_A, ORG_A.organizationId] },
        { sql: 'INSERT INTO "ExecutionAttempt" ("id", "organizationId", "jobId") VALUES (?, ?, ?)', args: [ATTEMPT_A, ORG_A.organizationId, JOB_A] },
        { sql: 'INSERT INTO "ExecutionJob" ("id", "organizationId") VALUES (?, ?)', args: [JOB_B, ORG_B.organizationId] },
        { sql: 'INSERT INTO "ExecutionAttempt" ("id", "organizationId", "jobId") VALUES (?, ?, ?)', args: [ATTEMPT_B, ORG_B.organizationId, JOB_B] },
        { sql: 'INSERT INTO "AgentProfile" ("id", "organizationId") VALUES (?, ?)', args: ['agent-a', ORG_A.organizationId] },
        { sql: 'INSERT INTO "AgentProfile" ("id", "organizationId") VALUES (?, ?)', args: ['agent-b', ORG_B.organizationId] },
        { sql: 'INSERT INTO "Document" ("id", "organizationId") VALUES (?, ?)', args: ['workspace-a', ORG_A.organizationId] },
        { sql: 'INSERT INTO "Document" ("id", "organizationId") VALUES (?, ?)', args: ['workspace-b', ORG_B.organizationId] },
      ],
      'write'
    );
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test('creates and reads spaces, bindings, and snapshots within one organization', async () => {
    const teamSpace = await createKnowledgeSpace(ORG_A, {
      scope: 'team',
      repoPath: '/repos/team-knowledge',
      defaultBranch: 'main',
      readPolicy: 'team',
      writePolicy: 'review-only',
    });
    await createKnowledgeSpace(ORG_B, {
      scope: 'agent',
      ownerAgentId: 'agent-b',
      repoPath: '/repos/agent-b-knowledge',
      readPolicy: 'owner',
      writePolicy: 'review-only',
    });

    const binding = await createKnowledgeBinding(ORG_A, {
      workspaceId: 'workspace-a',
      spaceId: teamSpace.id,
      mountPath: '/',
      access: 'propose',
    });
    expect(teamSpace).toMatchObject({ scope: 'team', ownerAgentId: null });
    expect(binding).toMatchObject({ mountPath: '/', access: 'propose' });
    expect(await listKnowledgeSpaces(ORG_A)).toHaveLength(1);
    expect(await listKnowledgeBindings(ORG_A, { workspaceId: 'workspace-a' })).toHaveLength(1);
    expect(await listKnowledgeSnapshots(ORG_A, { spaceId: teamSpace.id })).toHaveLength(0);
    expect(await getKnowledgeSpace(ORG_B, teamSpace.id)).toBeNull();
    expect(await listKnowledgeSpaces(ORG_B)).toHaveLength(1);
    await expect(
      createKnowledgeBinding(ORG_A, {
        workspaceId: 'workspace-b',
        spaceId: teamSpace.id,
        mountPath: '/',
        access: 'read',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('accepts only the configured platform header identity as a user actor', async () => {
    const platformGlobal = globalThis as typeof globalThis & {
      __daoPlatformBootstrap?: Promise<void>;
    };
    const previousBootstrap = platformGlobal.__daoPlatformBootstrap;
    platformGlobal.__daoPlatformBootstrap = Promise.resolve();
    try {
      await expect(getPlatformContextFromHeaders()).resolves.toEqual({
        actorType: 'user',
        deviceId: LOCAL_DEVICE_ID,
        organizationId: LOCAL_ORGANIZATION_ID,
        userId: LOCAL_USER_ID,
      });
      await expect(
        getPlatformContextFromHeaders(
          new Headers({
            [DAO_DEVICE_HEADER]: LOCAL_DEVICE_ID,
            [DAO_ORGANIZATION_HEADER]: LOCAL_ORGANIZATION_ID,
            [DAO_USER_HEADER]: LOCAL_USER_ID,
          })
        )
      ).resolves.toMatchObject({ actorType: 'user' });
    } finally {
      platformGlobal.__daoPlatformBootstrap = previousBootstrap;
    }
  });

  test('rejects blank or mismatched platform identity before bootstrap', async () => {
    const platformGlobal = globalThis as typeof globalThis & {
      __daoPlatformBootstrap?: Promise<void>;
    };
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      platformGlobal,
      '__daoPlatformBootstrap'
    );
    Object.defineProperty(platformGlobal, '__daoPlatformBootstrap', {
      configurable: true,
      get() {
        throw new Error('Platform bootstrap must not be reached.');
      },
    });
    try {
      for (const [name, value] of [
        [DAO_ORGANIZATION_HEADER, 'other-organization'],
        [DAO_USER_HEADER, ''],
        [DAO_DEVICE_HEADER, 'other-device'],
      ] as const) {
        await expect(
          getPlatformContextFromHeaders(new Headers({ [name]: value }))
        ).rejects.toBeInstanceOf(ForbiddenError);
      }
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(
          platformGlobal,
          '__daoPlatformBootstrap',
          previousDescriptor
        );
      } else {
        delete platformGlobal.__daoPlatformBootstrap;
      }
    }
  });

  test('requires a real owner or admin membership for Knowledge administration', async () => {
    const input = {
      scope: 'team' as const,
      repoPath: '/repos/unauthorized-knowledge',
      readPolicy: 'team',
      writePolicy: 'review-only',
    };
    await expect(createKnowledgeSpace(MEMBER_A, input)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    await expect(createKnowledgeSpace(OUTSIDER_A, input)).rejects.toBeInstanceOf(
      ForbiddenError
    );
    await expect(
      createKnowledgeSpace(
        {
          actorType: 'agent',
          organizationId: ORG_A.organizationId,
          userId: ORG_A.userId,
        } as unknown as KnowledgeHumanActor,
        input
      )
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('enforces space ownership and uniqueness for Knowledge bindings', async () => {
    const [teamSpace] = await listKnowledgeSpaces(ORG_A, { scope: 'team' });
    const [agentSpace] = await listKnowledgeSpaces(ORG_B, { scope: 'agent' });

    await expect(
      createKnowledgeBinding(ORG_A, {
        workspaceId: 'workspace-a',
        agentId: 'agent-a',
        spaceId: teamSpace.id,
        mountPath: '/',
        access: 'read',
      })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createKnowledgeBinding(ORG_B, {
        workspaceId: 'workspace-b',
        spaceId: agentSpace.id,
        mountPath: '/',
        access: 'read',
      })
    ).rejects.toBeInstanceOf(ValidationError);

    const agentBinding = await createKnowledgeBinding(ORG_B, {
      workspaceId: 'workspace-b',
      agentId: 'agent-b',
      spaceId: agentSpace.id,
      mountPath: '/',
      access: 'propose',
    });
    expect(agentBinding.agentId).toBe(agentSpace.ownerAgentId);

    await expect(
      createKnowledgeBinding(ORG_A, {
        workspaceId: 'workspace-a',
        spaceId: teamSpace.id,
        mountPath: '/',
        access: 'read',
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const secondTeamSpace = await createKnowledgeSpace(ADMIN_A, {
      scope: 'team',
      repoPath: '/repos/team-knowledge-two',
      readPolicy: 'team',
      writePolicy: 'review-only',
    });
    await expect(
      createKnowledgeBinding(ADMIN_A, {
        workspaceId: 'workspace-a',
        spaceId: secondTeamSpace.id,
        mountPath: '/',
        access: 'propose',
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test('requires the attempt to belong to the job and organization', async () => {
    const [space] = await listKnowledgeSpaces(ORG_A);
    await expect(
      createKnowledgeChangeRequest(ORG_A, {
        jobId: JOB_A,
        attemptId: ATTEMPT_B,
        spaceId: space.id,
        baseCommit: 'base-a',
        headCommit: 'head-a',
        branchName: 'agent/a/job/a/attempt/1',
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('enforces review transitions and optimistic revision fencing', async () => {
    const [space] = await listKnowledgeSpaces(ORG_A);
    const change = await createKnowledgeChangeRequest(ORG_A, {
      jobId: JOB_A,
      attemptId: ATTEMPT_A,
      spaceId: space.id,
      baseCommit: 'base-a',
      headCommit: 'head-a',
      branchName: 'agent/a/job/a/attempt/1',
      diffSummary: 'Add a durable playbook.',
      diffMetadata: { files: ['team/playbooks/release.md'], patchHash: 'sha256:x' },
    });

    const approved = await approveKnowledgeChangeRequest(ORG_A, change.id, {
      expectedRevision: 1,
      note: 'Ready for the trusted merger.',
    });
    expect(approved).toMatchObject({ status: 'approved', revision: 2 });
    expect(approved.mergedCommit).toBeNull();

    await expect(
      rejectKnowledgeChangeRequest(ORG_A, change.id, {
        expectedRevision: 1,
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const conflicted = await markKnowledgeChangeRequestConflicted(
      MERGE_ACTOR_A,
      change.id,
      { expectedRevision: 2 }
    );
    expect(conflicted).toMatchObject({ status: 'conflicted', revision: 3 });

    const reapproved = await approveKnowledgeChangeRequest(ORG_A, change.id, {
      expectedRevision: 3,
    });
    const rejected = await rejectKnowledgeChangeRequest(ORG_A, change.id, {
      expectedRevision: reapproved.revision,
      note: 'Superseded by a cleaner proposal.',
    });
    expect(rejected).toMatchObject({ status: 'rejected', revision: 5 });

    await expect(
      approveKnowledgeChangeRequest(ORG_A, change.id, {
        expectedRevision: 5,
      })
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await getKnowledgeChangeRequest(ORG_B, change.id)).toBeNull();
    expect(await listKnowledgeChangeRequests(ORG_A, { status: 'rejected' })).toHaveLength(1);
  });

  test('requires reviewer membership and lets only the approval actor queue', async () => {
    const [space] = await listKnowledgeSpaces(ORG_A);
    const change = await createKnowledgeChangeRequest(ORG_A, {
      jobId: JOB_A,
      attemptId: ATTEMPT_A,
      spaceId: space.id,
      baseCommit: 'base-queue',
      headCommit: 'head-queue',
      branchName: 'agent/a/job/a/attempt/queue',
    });

    await expect(
      approveKnowledgeChangeRequest(MEMBER_A, change.id, {
        expectedRevision: change.revision,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      approveKnowledgeChangeRequest(OUTSIDER_A, change.id, {
        expectedRevision: change.revision,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    const approved = await approveKnowledgeChangeRequest(ADMIN_A, change.id, {
      expectedRevision: change.revision,
    });
    expect(approved.reviewerId).toBe(ADMIN_A.userId);

    await expect(
      queueKnowledgeMerge(ORG_A, change.id, {
        expectedRevision: approved.revision,
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      queueKnowledgeMerge(MEMBER_A, change.id, {
        expectedRevision: approved.revision,
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    const operation = await queueKnowledgeMerge(ADMIN_A, change.id, {
      expectedRevision: approved.revision,
    });
    expect(operation).toMatchObject({
      changeRequestId: change.id,
      requestedById: ADMIN_A.userId,
      status: 'queued',
    });
  });

  test('only the trusted recorder can persist a merged result and snapshots require it', async () => {
    const [space] = await listKnowledgeSpaces(ORG_A);
    const change = await createKnowledgeChangeRequest(ORG_A, {
      jobId: JOB_A,
      attemptId: ATTEMPT_A,
      spaceId: space.id,
      baseCommit: 'base-merge',
      headCommit: 'head-merge',
      branchName: 'agent/a/job/a/attempt/merge',
    });
    const trustedMergeActor = MERGE_ACTOR_A;

    await expect(
      recordKnowledgeChangeRequestMerged(trustedMergeActor, change.id, {
        expectedRevision: 1,
        expectedHeadCommit: change.headCommit,
        mergedCommit: 'merge-commit',
      })
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      createKnowledgeSnapshot(ORG_A, {
        spaceId: space.id,
        changeRequestId: change.id,
        commitSha: 'merge-commit',
        indexVersion: 'v1',
        artifactPath: '/indexes/merge-commit.json',
        artifactSha256: 'a'.repeat(64),
      })
    ).rejects.toBeInstanceOf(ValidationError);

    const approved = await approveKnowledgeChangeRequest(ORG_A, change.id, {
      expectedRevision: 1,
    });
    await expect(
      recordKnowledgeChangeRequestMerged(
        trustedMergeActor,
        change.id,
        {
          expectedRevision: approved.revision,
          expectedHeadCommit: 'stale-head',
          mergedCommit: 'merge-commit',
        }
      )
    ).rejects.toBeInstanceOf(ConflictError);

    const merged = await recordKnowledgeChangeRequestMerged(
      trustedMergeActor,
      change.id,
      {
        expectedRevision: approved.revision,
        expectedHeadCommit: change.headCommit,
        mergedCommit: 'merge-commit',
      }
    );
    expect(merged).toMatchObject({
      status: 'merged',
      mergedCommit: 'merge-commit',
      revision: 3,
    });
    await expect(
      recordKnowledgeChangeRequestMerged(
        { ...ORG_B, authority: 'knowledge-merge-service' },
        change.id,
        {
          expectedRevision: merged.revision,
          expectedHeadCommit: change.headCommit,
          mergedCommit: 'other-merge-commit',
        }
      )
    ).rejects.toThrow('Knowledge change request not found.');
    await expect(
      rejectKnowledgeChangeRequest(ORG_A, change.id, {
        expectedRevision: merged.revision,
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      recordKnowledgeChangeRequestMerged(trustedMergeActor, change.id, {
        expectedRevision: merged.revision,
        expectedHeadCommit: change.headCommit,
        mergedCommit: 'merge-commit-2',
      })
    ).rejects.toBeInstanceOf(ConflictError);

    const snapshot = await createKnowledgeSnapshot(ORG_A, {
      spaceId: space.id,
      changeRequestId: change.id,
      commitSha: 'merge-commit',
      indexVersion: 'v1',
      artifactPath: '/indexes/merge-commit.json',
      artifactSha256: 'b'.repeat(64),
    });
    expect(snapshot).toMatchObject({
      changeRequestId: change.id,
      commitSha: 'merge-commit',
    });
  });

  test('keeps rejected requests terminal', async () => {
    const [space] = await listKnowledgeSpaces(ORG_A);
    const change = await createKnowledgeChangeRequest(ORG_A, {
      jobId: JOB_A,
      attemptId: ATTEMPT_A,
      spaceId: space.id,
      baseCommit: 'base-reject',
      headCommit: 'head-reject',
      branchName: 'agent/a/job/a/attempt/reject',
    });
    const rejected = await rejectKnowledgeChangeRequest(ORG_A, change.id, {
      expectedRevision: 1,
    });

    await expect(
      approveKnowledgeChangeRequest(ORG_A, change.id, {
        expectedRevision: rejected.revision,
      })
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      recordKnowledgeChangeRequestMerged(
        { ...ORG_A, authority: 'knowledge-merge-service' },
        change.id,
        {
          expectedRevision: rejected.revision,
          expectedHeadCommit: change.headCommit,
          mergedCommit: 'merge-after-reject',
        }
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
