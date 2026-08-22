import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { expect, test } from "@playwright/test";

import type {
  FinalizedGitWorktree,
  PreparedGitWorktree,
} from "@/agent/knowledge/contracts";
import { ConflictError } from "@/framework/resilience";
import { safeJsonParse } from "@/framework/resilience/safe-data";
import type { FrozenKnowledgeBindingV1 } from "@/objects/execution-job/schema";

import { prisma as testPrisma } from "./test-prisma";
import { createKnowledgeChangeRequestForAttempt } from "./worker-commands";

const ORGANIZATION_ID = "knowledge-worker-org";
const OTHER_ORGANIZATION_ID = "knowledge-worker-other-org";
const JOB_ID = "knowledge-worker-job";
const ATTEMPT_ID = "knowledge-worker-attempt";
const WORKER_ID = "knowledge-worker-current";
const GENERATION = 3;
const BASE_COMMIT = "a".repeat(40);
const HEAD_COMMIT = "b".repeat(40);
const PATCH_SHA256 = "c".repeat(64);

const binding: FrozenKnowledgeBindingV1 = {
  schemaVersion: 1,
  bindingId: "binding-a",
  spaceId: "space-a",
  workspaceId: "workspace-a",
  agentId: "agent-a",
  mountPath: "/",
  defaultBranch: "main",
  baseCommit: BASE_COMMIT,
};

const prepared: PreparedGitWorktree = {
  schemaVersion: 1,
  spaceId: binding.spaceId,
  mountPath: "/",
  repositoryPath: "/trusted/repos/knowledge",
  worktreePath: "/trusted/worktrees/attempt-a",
  defaultBranch: binding.defaultBranch,
  branch: "agent/agent-a/job/knowledge-worker-job/attempt/1",
  baseCommit: BASE_COMMIT,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  attemptNumber: 1,
  agentId: "agent-a",
};

const finalized: FinalizedGitWorktree = {
  schemaVersion: 1,
  spaceId: binding.spaceId,
  jobId: JOB_ID,
  attemptId: ATTEMPT_ID,
  agentId: "agent-a",
  changed: true,
  baseCommit: BASE_COMMIT,
  headCommit: HEAD_COMMIT,
  branch: prepared.branch,
  files: ["team/domain/playbook.md"],
  diffSummary: {
    filesChanged: 1,
    insertions: 4,
    deletions: 1,
    shortStat: "1 file changed, 4 insertions(+), 1 deletion(-)",
  },
  patchSha256: PATCH_SHA256,
};

let client: Client;
let temporaryRoot: string;

test.describe.serial("fenced knowledge change request worker command", () => {
  test.beforeAll(async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "tobe-knowledge-worker-"),
    );
    const databasePath = path.join(temporaryRoot, "worker.db");
    process.env.DAO_APP_DATA_ROOT = temporaryRoot;
    process.env.DATABASE_URL = `file:${databasePath}`;
    client = createClient({ url: `file:${databasePath}` });

    await client.executeMultiple(`
      CREATE TABLE "ExecutionJob" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "contextManifestJson" TEXT NOT NULL
      );
      CREATE TABLE "ExecutionAttempt" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "jobId" TEXT NOT NULL,
        "number" INTEGER NOT NULL,
        "status" TEXT NOT NULL,
        "generation" INTEGER NOT NULL,
        "leaseOwnerId" TEXT,
        "leaseExpiresAt" DATETIME,
        "workspaceLifecycleJson" TEXT,
        "updatedAt" DATETIME NOT NULL
      );
      CREATE TABLE "KnowledgeSpace" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "scope" TEXT NOT NULL,
        "ownerAgentId" TEXT,
        "defaultBranch" TEXT NOT NULL,
        UNIQUE ("id", "organizationId")
      );
      CREATE TABLE "KnowledgeBinding" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "organizationId" TEXT NOT NULL,
        "workspaceId" TEXT NOT NULL,
        "agentId" TEXT,
        "spaceId" TEXT NOT NULL,
        "mountPath" TEXT NOT NULL,
        "access" TEXT NOT NULL
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
        "updatedAt" DATETIME NOT NULL
      );
      CREATE UNIQUE INDEX "KnowledgeChangeRequest_attemptId_spaceId_headCommit_key"
        ON "KnowledgeChangeRequest" ("attemptId", "spaceId", "headCommit");
    `);
  });

  test.beforeEach(async () => {
    await client.executeMultiple(`
      DELETE FROM "KnowledgeChangeRequest";
      DELETE FROM "KnowledgeBinding";
      DELETE FROM "KnowledgeSpace";
      DELETE FROM "ExecutionAttempt";
      DELETE FROM "ExecutionJob";
    `);
    await seedAuthorizedAttempt();
  });

  test.afterAll(async () => {
    await client.close();
    await testPrisma.$disconnect();
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  });

  test("creates one pending review request and exact replay returns it", async () => {
    const first = await runCommand();
    expect(first.replayed).toBe(false);
    expect(first.changeRequest).toMatchObject({
      jobId: JOB_ID,
      attemptId: ATTEMPT_ID,
      spaceId: binding.spaceId,
      baseCommit: BASE_COMMIT,
      headCommit: HEAD_COMMIT,
      branchName: prepared.branch,
      status: "pending_review",
      diffMetadata: {
        bindingId: binding.bindingId,
        mountPath: binding.mountPath,
        files: finalized.files,
        shortStat: finalized.diffSummary.shortStat,
        insertions: 4,
        deletions: 1,
        patchSha256: PATCH_SHA256,
      },
    });

    const persistedLifecycle = await readLifecycle();
    expect(persistedLifecycle.changeRequestId).toBe(first.changeRequest.id);

    const replay = await runCommand();
    expect(replay).toMatchObject({
      replayed: true,
      changeRequest: { id: first.changeRequest.id },
    });
    expect(await changeRequestCount()).toBe(1);
  });

  test("rejects stale generation, wrong owner, expired lease, and wrong organization", async () => {
    await expect(
      runCommand({ generation: GENERATION - 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      runCommand({ workerId: "stale-worker" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createKnowledgeChangeRequestForAttempt(
        { organizationId: OTHER_ORGANIZATION_ID },
        commandInput(),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    await client.execute({
      sql: 'UPDATE "ExecutionAttempt" SET "leaseExpiresAt" = ? WHERE "id" = ?',
      args: [new Date(Date.now() - 1_000), ATTEMPT_ID],
    });
    await expect(runCommand()).rejects.toBeInstanceOf(ConflictError);
    expect(await changeRequestCount()).toBe(0);
  });

  test("rejects a binding that loses propose access or changes identity", async () => {
    await client.execute({
      sql: 'UPDATE "KnowledgeBinding" SET "access" = ? WHERE "id" = ?',
      args: ["read", binding.bindingId],
    });
    await expect(runCommand()).rejects.toBeInstanceOf(ConflictError);
    expect(await changeRequestCount()).toBe(0);
    expect((await readLifecycle()).changeRequestId).toBeUndefined();

    await client.execute({
      sql: 'UPDATE "KnowledgeBinding" SET "access" = ?, "workspaceId" = ? WHERE "id" = ?',
      args: ["propose", "different-workspace", binding.bindingId],
    });
    await expect(runCommand()).rejects.toBeInstanceOf(ConflictError);
    expect(await changeRequestCount()).toBe(0);
  });

  test("rejects agent-space ownership drift", async () => {
    await client.execute({
      sql: 'UPDATE "KnowledgeSpace" SET "ownerAgentId" = ? WHERE "id" = ?',
      args: ["another-agent", binding.spaceId],
    });
    await expect(runCommand()).rejects.toBeInstanceOf(ConflictError);
    expect(await changeRequestCount()).toBe(0);
  });

  test("rejects a base commit that differs from the frozen manifest", async () => {
    const changedBinding = { ...binding, baseCommit: "d".repeat(40) };
    await client.execute({
      sql: 'UPDATE "ExecutionJob" SET "contextManifestJson" = ? WHERE "id" = ?',
      args: [
        JSON.stringify({ schemaVersion: 1, knowledgeCommit: changedBinding }),
        JOB_ID,
      ],
    });
    await expect(runCommand()).rejects.toBeInstanceOf(ConflictError);
    expect(await changeRequestCount()).toBe(0);
  });

  test("rejects reuse of the idempotency key with different finalized content", async () => {
    await runCommand();
    const differentFinalized: FinalizedGitWorktree = {
      ...finalized,
      files: ["team/domain/different.md"],
      diffSummary: {
        ...finalized.diffSummary,
        shortStat: "1 file changed, 4 insertions(+)",
        deletions: 0,
      },
    };
    const lifecycle = await readLifecycle();
    await client.execute({
      sql: 'UPDATE "ExecutionAttempt" SET "workspaceLifecycleJson" = ? WHERE "id" = ?',
      args: [
        JSON.stringify({
          ...lifecycle,
          finalized: differentFinalized,
          changeRequestId: undefined,
        }),
        ATTEMPT_ID,
      ],
    });

    await expect(
      runCommand({ finalized: differentFinalized }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await changeRequestCount()).toBe(1);
  });
});

function commandInput(
  overrides: Partial<
    Parameters<typeof createKnowledgeChangeRequestForAttempt>[1]
  > = {},
): Parameters<typeof createKnowledgeChangeRequestForAttempt>[1] {
  return {
    attemptId: ATTEMPT_ID,
    workerId: WORKER_ID,
    generation: GENERATION,
    binding,
    prepared,
    finalized,
    ...overrides,
  };
}

function runCommand(
  overrides: Partial<
    Parameters<typeof createKnowledgeChangeRequestForAttempt>[1]
  > = {},
) {
  return createKnowledgeChangeRequestForAttempt(
    { organizationId: ORGANIZATION_ID },
    commandInput(overrides),
  );
}

async function seedAuthorizedAttempt() {
  const now = new Date();
  const lifecycle = {
    schemaVersion: 1,
    kind: "git-worktree",
    binding,
    prepared,
    runtimeCompletion: { status: "succeeded" },
    finalized,
  };
  await client.batch(
    [
      {
        sql: 'INSERT INTO "ExecutionJob" ("id", "organizationId", "contextManifestJson") VALUES (?, ?, ?)',
        args: [
          JOB_ID,
          ORGANIZATION_ID,
          JSON.stringify({ schemaVersion: 1, knowledgeCommit: binding }),
        ],
      },
      {
        sql: `INSERT INTO "ExecutionAttempt" (
          "id", "organizationId", "jobId", "number", "status",
          "generation", "leaseOwnerId", "leaseExpiresAt",
          "workspaceLifecycleJson", "updatedAt"
        ) VALUES (?, ?, ?, 1, 'running', ?, ?, ?, ?, ?)`,
        args: [
          ATTEMPT_ID,
          ORGANIZATION_ID,
          JOB_ID,
          GENERATION,
          WORKER_ID,
          new Date(now.valueOf() + 60_000),
          JSON.stringify(lifecycle),
          now,
        ],
      },
      {
        sql: `INSERT INTO "KnowledgeSpace" (
          "id", "organizationId", "scope", "ownerAgentId", "defaultBranch"
        ) VALUES (?, ?, 'agent', ?, ?)`,
        args: [
          binding.spaceId,
          ORGANIZATION_ID,
          binding.agentId,
          binding.defaultBranch,
        ],
      },
      {
        sql: `INSERT INTO "KnowledgeBinding" (
          "id", "organizationId", "workspaceId", "agentId",
          "spaceId", "mountPath", "access"
        ) VALUES (?, ?, ?, ?, ?, ?, 'propose')`,
        args: [
          binding.bindingId,
          ORGANIZATION_ID,
          binding.workspaceId,
          binding.agentId,
          binding.spaceId,
          binding.mountPath,
        ],
      },
    ],
    "write",
  );
}

async function readLifecycle(): Promise<Record<string, unknown>> {
  const result = await client.execute({
    sql: 'SELECT "workspaceLifecycleJson" FROM "ExecutionAttempt" WHERE "id" = ?',
    args: [ATTEMPT_ID],
  });
  return safeJsonParse<Record<string, unknown>>(
    String(result.rows[0]?.workspaceLifecycleJson),
    {}
  );
}

async function changeRequestCount(): Promise<number> {
  const result = await client.execute(
    'SELECT COUNT(*) AS "count" FROM "KnowledgeChangeRequest"',
  );
  return Number(result.rows[0]?.count);
}
