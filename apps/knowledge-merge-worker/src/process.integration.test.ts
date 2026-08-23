import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { devNull } from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { expect, test } from "@playwright/test";

import { safeJsonParse } from "@/framework/resilience/safe-data";

const ORGANIZATION_ID = "knowledge-worker-process-org";
const SPACE_ID = "knowledge-worker-process-space";
const DEFAULT_BRANCH = "main";
const INDEX_VERSION = "knowledge-index-v1";
const PROCESS_TIMEOUT_MS = 30_000;
const MIGRATION_TIMEOUT_MS = 60_000;
const BASE_README = "# Process knowledge\n";
const PROPOSAL_README = "# Process knowledge\n\nApproved facts.\n";
const PROPOSAL_GUIDE = "A deterministic knowledge guide.\n";

type ProcessEvent = {
  schemaVersion?: number;
  type?: string;
  [key: string]: unknown;
};

type ProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  events: ProcessEvent[];
};

type Proposal = {
  baseCommit: string;
  headCommit: string;
  branchName: string;
  patchSha256: string;
};

type OperationSeed = {
  changeRequestId: string;
  operationId: string;
};

test("run-once CAS-merges the exact approved head and publishes a verified deterministic snapshot", async () => {
  test.setTimeout(90_000);

  const fixture = await createFixture("dao-knowledge-worker-success-");
  let client: Client | null = null;

  try {
    const proposal = await createProposal(
      fixture.repositoryPath,
      "proposal/approved",
    );
    const gitWrapper = await createGitWrapper(fixture.temporaryRoot);
    client = await openDatabase(fixture.databaseUrl);
    const seed = await seedApprovedOperation(client, {
      repositoryPath: fixture.repositoryPath,
      proposal,
      suffix: "success",
    });
    const commitCountBefore = await gitText(fixture.repositoryPath, [
      "rev-list",
      "--all",
      "--count",
    ]);

    const result = await runWorker(fixture, {
      workerId: "knowledge-worker-success",
      gitBinary: gitWrapper.executable,
    });

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expectRun(result, {
      workerId: "knowledge-worker-success",
      status: "succeeded",
      processed: 1,
      succeeded: 1,
      conflicted: 0,
      failed: 0,
      unhandled: 0,
      remaining: 0,
    });
    await expectPreflightResidueRemoved(fixture.artifactRoot);

    expect(
      await gitText(fixture.repositoryPath, [
        "rev-parse",
        `refs/heads/${DEFAULT_BRANCH}`,
      ]),
    ).toBe(proposal.headCommit);
    expect(
      await gitText(fixture.repositoryPath, [
        "rev-parse",
        `${proposal.headCommit}^`,
      ]),
    ).toBe(proposal.baseCommit);
    expect(
      await gitText(fixture.repositoryPath, ["rev-list", "--all", "--count"]),
    ).toBe(commitCountBefore);
    const updateRefs = await readOptionalLines(gitWrapper.updateRefLog);
    expect(updateRefs).toHaveLength(1);
    expect(updateRefs[0]).toContain(
      `update-ref\trefs/heads/${DEFAULT_BRANCH}\t${proposal.headCommit}\t${proposal.baseCommit}`,
    );

    const state = await readOperationState(client, seed.operationId);
    expect(state).toMatchObject({
      operationStatus: "succeeded",
      attemptCount: 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      mergedCommit: proposal.headCommit,
      errorCode: null,
      errorMessage: null,
      changeRequestStatus: "merged",
      changeRequestRevision: 3,
      changeRequestMergedCommit: proposal.headCommit,
      snapshotCommit: proposal.headCommit,
      snapshotIndexVersion: INDEX_VERSION,
      activeSnapshotId: state?.snapshotId,
    });
    expect(state?.snapshotId).toEqual(expect.any(String));
    expect(state?.completedAt).not.toBeNull();
    expect(state?.snapshotReadyAt).not.toBeNull();

    await verifyDeterministicSnapshot({
      client,
      fixture,
      proposal,
      operationId: seed.operationId,
    });
  } finally {
    await client?.close();
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("an independently advanced canonical default becomes a durable conflict without a snapshot", async () => {
  test.setTimeout(90_000);

  const fixture = await createFixture("dao-knowledge-worker-conflict-");
  let client: Client | null = null;

  try {
    const proposal = await createProposal(
      fixture.repositoryPath,
      "proposal/conflict",
    );
    await writeFile(
      path.join(fixture.repositoryPath, "independent.txt"),
      "The canonical branch advanced independently.\n",
    );
    await gitText(fixture.repositoryPath, ["add", "--all"]);
    await commit(fixture.repositoryPath, "Advance canonical default");
    const independentlyAdvancedHead = await gitText(fixture.repositoryPath, [
      "rev-parse",
      "HEAD",
    ]);
    expect(independentlyAdvancedHead).not.toBe(proposal.baseCommit);
    expect(independentlyAdvancedHead).not.toBe(proposal.headCommit);

    client = await openDatabase(fixture.databaseUrl);
    const seed = await seedApprovedOperation(client, {
      repositoryPath: fixture.repositoryPath,
      proposal,
      suffix: "conflict",
    });
    const result = await runWorker(fixture, {
      workerId: "knowledge-worker-conflict",
    });

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expectRun(result, {
      workerId: "knowledge-worker-conflict",
      status: "succeeded",
      processed: 1,
      succeeded: 0,
      conflicted: 1,
      failed: 0,
      unhandled: 0,
      remaining: 0,
    });
    expect(
      await gitText(fixture.repositoryPath, [
        "rev-parse",
        `refs/heads/${DEFAULT_BRANCH}`,
      ]),
    ).toBe(independentlyAdvancedHead);
    expect(
      await gitText(fixture.repositoryPath, [
        "rev-parse",
        `refs/heads/${proposal.branchName}`,
      ]),
    ).toBe(proposal.headCommit);

    const state = await readOperationState(client, seed.operationId);
    expect(state).toMatchObject({
      operationStatus: "conflicted",
      attemptCount: 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      mergedCommit: null,
      snapshotId: null,
      errorCode: "default-ref-changed",
      changeRequestStatus: "conflicted",
      changeRequestRevision: 3,
      changeRequestMergedCommit: null,
      activeSnapshotId: null,
      snapshotCommit: null,
    });
    expect(state?.errorMessage).toContain("default-ref-changed");
    expect(state?.completedAt).not.toBeNull();
    expect(await snapshotCount(client)).toBe(0);
    expect(await readdir(fixture.artifactRoot)).toEqual([]);
  } finally {
    await client?.close();
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

test("a fresh run-once retries a durable index failure and reuses the recorded Git merge without a second commit", async () => {
  test.setTimeout(120_000);

  const fixture = await createFixture("dao-knowledge-worker-retry-");
  let client: Client | null = null;

  try {
    const proposal = await createProposal(
      fixture.repositoryPath,
      "proposal/retry",
    );
    const failMarker = path.join(fixture.temporaryRoot, "fail-ls-tree");
    await writeFile(failMarker, "fail the first index build\n");
    const gitWrapper = await createGitWrapper(
      fixture.temporaryRoot,
      failMarker,
    );
    client = await openDatabase(fixture.databaseUrl);
    const seed = await seedApprovedOperation(client, {
      repositoryPath: fixture.repositoryPath,
      proposal,
      suffix: "retry",
    });
    const commitCountBefore = await gitText(fixture.repositoryPath, [
      "rev-list",
      "--all",
      "--count",
    ]);

    const failed = await runWorker(fixture, {
      workerId: "knowledge-worker-failing-index",
      gitBinary: gitWrapper.executable,
      maxAttempts: 3,
    });

    expect(failed.exitCode).toBe(1);
    expect(failed.signal).toBeNull();
    expect(failed.stderr).toBe("");
    expectRun(failed, {
      workerId: "knowledge-worker-failing-index",
      status: "incomplete",
      processed: 1,
      succeeded: 0,
      conflicted: 0,
      failed: 1,
      unhandled: 0,
      remaining: 1,
    });
    expect(
      await gitText(fixture.repositoryPath, [
        "rev-parse",
        `refs/heads/${DEFAULT_BRANCH}`,
      ]),
    ).toBe(proposal.headCommit);
    expect(
      await gitText(fixture.repositoryPath, ["rev-list", "--all", "--count"]),
    ).toBe(commitCountBefore);
    expect(await readOptionalLines(gitWrapper.updateRefLog)).toHaveLength(1);

    const failedState = await readOperationState(client, seed.operationId);
    expect(failedState).toMatchObject({
      operationStatus: "failed",
      attemptCount: 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      mergedCommit: proposal.headCommit,
      snapshotId: null,
      errorCode: "git-failed",
      changeRequestStatus: "merged",
      changeRequestRevision: 3,
      changeRequestMergedCommit: proposal.headCommit,
      activeSnapshotId: null,
    });
    expect(failedState?.completedAt).not.toBeNull();
    expect(await snapshotCount(client)).toBe(0);

    await unlink(failMarker);
    const retried = await runWorker(fixture, {
      workerId: "knowledge-worker-retry",
      gitBinary: gitWrapper.executable,
      maxAttempts: 3,
    });

    expect(retried.exitCode).toBe(0);
    expect(retried.signal).toBeNull();
    expect(retried.stderr).toBe("");
    expectRun(retried, {
      workerId: "knowledge-worker-retry",
      status: "succeeded",
      processed: 1,
      succeeded: 1,
      conflicted: 0,
      failed: 0,
      unhandled: 0,
      remaining: 0,
    });
    expect(
      await gitText(fixture.repositoryPath, [
        "rev-parse",
        `refs/heads/${DEFAULT_BRANCH}`,
      ]),
    ).toBe(proposal.headCommit);
    expect(
      await gitText(fixture.repositoryPath, ["rev-list", "--all", "--count"]),
    ).toBe(commitCountBefore);
    expect(await readOptionalLines(gitWrapper.updateRefLog)).toHaveLength(1);

    const recovered = await readOperationState(client, seed.operationId);
    expect(recovered).toMatchObject({
      operationStatus: "succeeded",
      attemptCount: 2,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      mergedCommit: proposal.headCommit,
      errorCode: null,
      errorMessage: null,
      changeRequestStatus: "merged",
      changeRequestRevision: 3,
      changeRequestMergedCommit: proposal.headCommit,
      snapshotCommit: proposal.headCommit,
      snapshotIndexVersion: INDEX_VERSION,
      activeSnapshotId: recovered?.snapshotId,
    });
    expect(recovered?.snapshotId).toEqual(expect.any(String));
    expect(await snapshotCount(client)).toBe(1);
    await verifyDeterministicSnapshot({
      client,
      fixture,
      proposal,
      operationId: seed.operationId,
    });
  } finally {
    await client?.close();
    await rm(fixture.temporaryRoot, { recursive: true, force: true });
  }
});

async function createFixture(prefix: string): Promise<{
  repositoryRoot: string;
  temporaryRoot: string;
  appDataRoot: string;
  databaseUrl: string;
  artifactRoot: string;
  repositoryPath: string;
  workerEntry: string;
}> {
  const repositoryRoot = process.cwd();
  const fixtureRoot = path.join(
    repositoryRoot,
    ".tmp",
    "control-plane-tests",
    "knowledge-merge-worker",
    "fixtures",
  );
  await mkdir(fixtureRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(fixtureRoot, prefix));
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const databasePath = path.join(appDataRoot, "worker.db");
  const databaseUrl = `file:${databasePath}`;
  const artifactRoot = path.join(temporaryRoot, "indexes");
  const repositoryPath = path.join(temporaryRoot, "knowledge-repository");
  const workerEntry = path.join(
    repositoryRoot,
    ".vite",
    "knowledge-merge-worker",
    "index.mjs",
  );
  await access(workerEntry, fsConstants.R_OK).catch(() => {
    throw new Error(
      "Standalone knowledge merge worker artifact is missing; run " +
        "npm run knowledge:merge-worker:build before this test.",
    );
  });
  await mkdir(appDataRoot, { recursive: true });
  await Promise.all([
    applyProductionMigrations(repositoryRoot, databaseUrl),
    initializeGitRepository(repositoryPath),
  ]);
  return {
    repositoryRoot,
    temporaryRoot,
    appDataRoot,
    databaseUrl,
    artifactRoot,
    repositoryPath,
    workerEntry,
  };
}

async function applyProductionMigrations(
  repositoryRoot: string,
  databaseUrl: string,
): Promise<void> {
  const prismaCli = path.join(
    repositoryRoot,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  const result = await runCommand(
    process.execPath,
    [prismaCli, "migrate", "deploy"],
    repositoryRoot,
    {
      ...toolEnvironment(),
      DATABASE_URL: databaseUrl,
    },
    MIGRATION_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new Error(
      `Prisma migrations failed with code ${result.code}: ${result.stderr}`,
    );
  }
}

async function openDatabase(databaseUrl: string): Promise<Client> {
  const client = createClient({ url: databaseUrl });
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA foreign_keys = ON");
  return client;
}

async function seedApprovedOperation(
  client: Client,
  input: {
    repositoryPath: string;
    proposal: Proposal;
    suffix: string;
  },
): Promise<OperationSeed> {
  const now = new Date().toISOString();
  const changeRequestId = `knowledge-change-${input.suffix}`;
  const operationId = `knowledge-merge-${input.suffix}`;
  await client.batch(
    [
      {
        sql: `
          INSERT INTO "Organization"
            ("id", "slug", "name", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          ORGANIZATION_ID,
          `${ORGANIZATION_ID}-${input.suffix}`,
          "Knowledge worker process org",
          now,
          now,
        ],
      },
      {
        sql: `
          INSERT INTO "KnowledgeSpace" (
            "id", "organizationId", "scope", "ownerAgentId",
            "repoPath", "repoUrl", "defaultBranch", "credentialRef",
            "activeSnapshotId", "readPolicy", "writePolicy",
            "createdAt", "updatedAt"
          ) VALUES (?, ?, 'team', NULL, ?, NULL, ?, NULL, NULL, 'team', 'review', ?, ?)
        `,
        args: [
          SPACE_ID,
          ORGANIZATION_ID,
          input.repositoryPath,
          DEFAULT_BRANCH,
          now,
          now,
        ],
      },
      {
        sql: `
          INSERT INTO "KnowledgeChangeRequest" (
            "id", "organizationId", "jobId", "attemptId", "spaceId",
            "baseCommit", "headCommit", "branchName", "status",
            "diffSummary", "diffMetadataJson", "reviewerId", "reviewNote",
            "reviewedAt", "mergedCommit", "mergedAt", "revision",
            "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, NULL, ?, NULL, NULL, 2, ?, ?)
        `,
        args: [
          changeRequestId,
          ORGANIZATION_ID,
          `knowledge-job-${input.suffix}`,
          `knowledge-attempt-${input.suffix}`,
          SPACE_ID,
          input.proposal.baseCommit,
          input.proposal.headCommit,
          input.proposal.branchName,
          "Approved process integration proposal",
          JSON.stringify({ patchSha256: input.proposal.patchSha256 }),
          "knowledge-reviewer",
          now,
          now,
          now,
        ],
      },
      {
        sql: `
          INSERT INTO "KnowledgeMergeOperation" (
            "id", "organizationId", "changeRequestId", "requestedById",
            "expectedRevision", "expectedBaseCommit", "expectedHeadCommit",
            "indexVersion", "status", "attemptCount", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, 2, ?, ?, ?, 'queued', 0, ?, ?)
        `,
        args: [
          operationId,
          ORGANIZATION_ID,
          changeRequestId,
          "knowledge-reviewer",
          input.proposal.baseCommit,
          input.proposal.headCommit,
          INDEX_VERSION,
          now,
          now,
        ],
      },
    ],
    "write",
  );
  return { changeRequestId, operationId };
}

async function initializeGitRepository(repositoryPath: string): Promise<void> {
  await mkdir(repositoryPath, { recursive: true });
  await gitText(repositoryPath, ["init"]);
  await gitText(repositoryPath, [
    "symbolic-ref",
    "HEAD",
    `refs/heads/${DEFAULT_BRANCH}`,
  ]);
  await writeFile(path.join(repositoryPath, "README.md"), BASE_README);
  await gitText(repositoryPath, ["add", "--all"]);
  await commit(repositoryPath, "Seed knowledge repository");
}

async function createProposal(
  repositoryPath: string,
  branchName: string,
): Promise<Proposal> {
  const baseCommit = await gitText(repositoryPath, ["rev-parse", "HEAD"]);
  await gitText(repositoryPath, ["checkout", "-b", branchName]);
  await mkdir(path.join(repositoryPath, "docs"), { recursive: true });
  await Promise.all([
    writeFile(path.join(repositoryPath, "README.md"), PROPOSAL_README),
    writeFile(path.join(repositoryPath, "docs", "guide.md"), PROPOSAL_GUIDE),
  ]);
  await gitText(repositoryPath, ["add", "--all"]);
  await commit(repositoryPath, "Add approved knowledge");
  const headCommit = await gitText(repositoryPath, ["rev-parse", "HEAD"]);
  const patch = await gitRaw(repositoryPath, [
    "diff",
    "--binary",
    "--full-index",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--no-renames",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    baseCommit,
    headCommit,
    "--",
  ]);
  await gitText(repositoryPath, ["checkout", DEFAULT_BRANCH]);
  return {
    baseCommit,
    headCommit,
    branchName,
    patchSha256: sha256(patch),
  };
}

async function commit(repositoryPath: string, message: string): Promise<void> {
  await gitText(repositoryPath, [
    "-c",
    "user.name=Knowledge Worker Process Test",
    "-c",
    "user.email=knowledge-worker-process@example.test",
    "commit",
    "-m",
    message,
  ]);
}

async function createGitWrapper(
  temporaryRoot: string,
  failMarker?: string,
): Promise<{ executable: string; updateRefLog: string }> {
  const executable = path.join(temporaryRoot, "git-process-wrapper.mjs");
  const updateRefLog = path.join(temporaryRoot, "git-update-ref.log");
  const markerExpression = failMarker
    ? `existsSync(${JSON.stringify(failMarker)})`
    : "false";
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.includes('update-ref')) {
  appendFileSync(${JSON.stringify(updateRefLog)}, args.join('\\t') + '\\n');
}
if (${markerExpression} && args.includes('ls-tree')) {
  process.stderr.write('intentional index failure\\n');
  process.exit(97);
}
const result = spawnSync('git', args, { env: process.env, stdio: 'inherit' });
if (result.error) {
  process.stderr.write(String(result.error.message) + '\\n');
  process.exit(1);
}
process.exit(typeof result.status === 'number' ? result.status : 1);
`,
    { mode: 0o700 },
  );
  return { executable, updateRefLog };
}

async function gitText(
  repositoryPath: string,
  args: readonly string[],
): Promise<string> {
  return (await gitRaw(repositoryPath, args)).trim();
}

async function gitRaw(
  repositoryPath: string,
  args: readonly string[],
): Promise<string> {
  const result = await runCommand(
    "git",
    ["-c", `core.hooksPath=${devNull}`, "-C", repositoryPath, ...args],
    repositoryPath,
    gitEnvironment(),
    PROCESS_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new Error(
      `Git command failed with code ${result.code}: ${result.stderr}`,
    );
  }
  return result.stdout;
}

async function runWorker(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  options: { workerId: string; gitBinary?: string; maxAttempts?: number },
): Promise<ProcessResult> {
  const result = await runCommand(
    process.execPath,
    [fixture.workerEntry],
    fixture.repositoryRoot,
    {
      ...toolEnvironment(),
      DATABASE_URL: fixture.databaseUrl,
      DAO_APP_DATA_ROOT: fixture.appDataRoot,
      DAO_KNOWLEDGE_ORGANIZATION_ID: ORGANIZATION_ID,
      DAO_KNOWLEDGE_WORKER_ID: options.workerId,
      DAO_KNOWLEDGE_INDEX_ROOT: fixture.artifactRoot,
      DAO_KNOWLEDGE_POLL_INTERVAL_MS: "25",
      DAO_KNOWLEDGE_LEASE_DURATION_MS: "10000",
      DAO_KNOWLEDGE_MAX_ATTEMPTS: String(options.maxAttempts ?? 3),
      DAO_KNOWLEDGE_RUN_ONCE: "1",
      DAO_GIT_BINARY: options.gitBinary ?? "git",
    },
    PROCESS_TIMEOUT_MS,
  );
  return {
    exitCode: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    events: parseStructuredLines(result.stdout),
  };
}

function expectRun(
  result: ProcessResult,
  expected: {
    workerId: string;
    status: "succeeded" | "incomplete";
    processed: number;
    succeeded: number;
    conflicted: number;
    failed: number;
    unhandled: number;
    remaining: number;
  },
): void {
  expect(result.events).toHaveLength(2);
  expect(result.events[0]).toMatchObject({
    schemaVersion: 1,
    type: "ready",
    organizationId: ORGANIZATION_ID,
    workerId: expected.workerId,
    pid: expect.any(Number),
  });
  expect(result.events[1]).toEqual({
    schemaVersion: 1,
    type: "run-complete",
    workerId: expected.workerId,
    pid: result.events[0].pid,
    status: expected.status,
    processed: expected.processed,
    succeeded: expected.succeeded,
    conflicted: expected.conflicted,
    failed: expected.failed,
    unhandled: expected.unhandled,
    remaining: expected.remaining,
  });
}

async function expectPreflightResidueRemoved(artifactRoot: string) {
  expect((await stat(artifactRoot)).isDirectory()).toBe(true);
  expect(
    (await readdir(artifactRoot)).filter((entry) =>
      entry.startsWith(".knowledge-preflight-"),
    ),
  ).toEqual([]);
}

async function readOperationState(
  client: Client,
  operationId: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.execute({
    sql: `
      SELECT
        operation."status" AS "operationStatus",
        operation."attemptCount" AS "attemptCount",
        operation."leaseOwnerId" AS "leaseOwnerId",
        operation."leaseExpiresAt" AS "leaseExpiresAt",
        operation."mergedCommit" AS "mergedCommit",
        operation."snapshotId" AS "snapshotId",
        operation."errorCode" AS "errorCode",
        operation."errorMessage" AS "errorMessage",
        operation."completedAt" AS "completedAt",
        change_request."status" AS "changeRequestStatus",
        change_request."revision" AS "changeRequestRevision",
        change_request."mergedCommit" AS "changeRequestMergedCommit",
        space."activeSnapshotId" AS "activeSnapshotId",
        snapshot."commitSha" AS "snapshotCommit",
        snapshot."indexVersion" AS "snapshotIndexVersion",
        snapshot."artifactPath" AS "artifactPath",
        snapshot."artifactSha256" AS "artifactSha256",
        snapshot."readyAt" AS "snapshotReadyAt"
      FROM "KnowledgeMergeOperation" AS operation
      JOIN "KnowledgeChangeRequest" AS change_request
        ON change_request."id" = operation."changeRequestId"
       AND change_request."organizationId" = operation."organizationId"
      JOIN "KnowledgeSpace" AS space
        ON space."id" = change_request."spaceId"
       AND space."organizationId" = change_request."organizationId"
      LEFT JOIN "KnowledgeSnapshot" AS snapshot
        ON snapshot."id" = operation."snapshotId"
       AND snapshot."organizationId" = operation."organizationId"
      WHERE operation."id" = ?
    `,
    args: [operationId],
  });
  return result.rows[0] ? { ...result.rows[0] } : null;
}

async function snapshotCount(client: Client): Promise<number> {
  const result = await client.execute(
    'SELECT COUNT(*) AS "count" FROM "KnowledgeSnapshot"',
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function verifyDeterministicSnapshot(input: {
  client: Client;
  fixture: Awaited<ReturnType<typeof createFixture>>;
  proposal: Proposal;
  operationId: string;
}): Promise<void> {
  const state = await readOperationState(input.client, input.operationId);
  const artifactPath = String(state?.artifactPath ?? "");
  const artifactSha256 = String(state?.artifactSha256 ?? "");
  const documents = await Promise.all(
    [
      { path: "README.md", content: PROPOSAL_README },
      { path: "docs/guide.md", content: PROPOSAL_GUIDE },
    ].map(async (document) => ({
      path: document.path,
      blobSha: await gitText(input.fixture.repositoryPath, [
        "rev-parse",
        `${input.proposal.headCommit}:${document.path}`,
      ]),
      byteLength: Buffer.byteLength(document.content),
      content: document.content,
      contentSha256: sha256(document.content),
    })),
  );
  const expectedArtifact = {
    schemaVersion: 1,
    indexVersion: INDEX_VERSION,
    commitSha: input.proposal.headCommit,
    documents,
  };
  const expectedBytes = Buffer.from(
    `${stableSerialize(expectedArtifact)}\n`,
    "utf8",
  );
  const expectedDigest = sha256(expectedBytes);
  const expectedPath = path.join(
    input.fixture.artifactRoot,
    safeComponent(SPACE_ID),
    `${safeComponent(INDEX_VERSION)}-${input.proposal.headCommit}-${expectedDigest}.json`,
  );

  expect(artifactPath).toBe(expectedPath);
  expect(artifactSha256).toBe(expectedDigest);
  const actualBytes = await readFile(artifactPath);
  expect(actualBytes.equals(expectedBytes)).toBe(true);
  expect(sha256(actualBytes)).toBe(artifactSha256);
  expect(
    safeJsonParse<Record<string, unknown> | null>(
      actualBytes.toString("utf8"),
      null,
    ),
  ).toEqual(expectedArtifact);
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function safeComponent(value: string): string {
  return sha256(value).slice(0, 32);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readOptionalLines(filePath: string): Promise<string[]> {
  try {
    return (await readFile(filePath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }
}

function parseStructuredLines(output: string): ProcessEvent[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) =>
      safeJsonParse<ProcessEvent>(line, {
        type: "unstructured-output",
        line,
      }),
    );
}

function runCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(
          new Error(
            `Command timed out after ${timeoutMs}ms: ${executable}; ` +
              `stdout=${stdout}; stderr=${stderr}`,
          ),
        );
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function toolEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
}

function gitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...toolEnvironment(),
    LC_ALL: "C",
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: "0",
  };
}
