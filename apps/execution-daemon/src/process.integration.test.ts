import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import path from "node:path";

import { createClient, type Client } from "@libsql/client";
import { expect, test } from "@playwright/test";

import { isRecord, safeJsonParse } from "@/framework/resilience/safe-data";

const ORGANIZATION_ID = "process-e2e-org";
const WORKSPACE_ID = "process-e2e-workspace";
const CONVERSATION_ID = "process-e2e-conversation";
const RUNTIME_ID = "process-e2e-runtime";
const JOB_ID = "process-e2e-job";
const ATTEMPT_ID = "process-e2e-attempt";
const ROOM_ID = "process-e2e-room";
const ROOM_MESSAGE_ID = "process-e2e-room-message";
const WORKER_ID = "process-e2e-worker";
const CRASHED_WORKER_ID = "process-e2e-crashed-worker";
const RECOVERY_WORKER_ID = "process-e2e-recovery-worker";
const KNOWLEDGE_SPACE_ID = "process-e2e-knowledge-space";
const KNOWLEDGE_BINDING_ID = "process-e2e-knowledge-binding";
const KNOWLEDGE_CREDENTIAL_REF = "process-e2e-private-credential";
const DEFAULT_BRANCH = "main";
const EXPECTED_ATTEMPT_BRANCH =
  `agent/unassigned/job/${JOB_ID}/attempt/1-${sha256(ATTEMPT_ID).slice(0, 10)}`;
const RUNTIME_CHANGE_FILE = "runtime-change.txt";
const WORKTREE_AUTHOR = {
  name: "Execution Daemon E2E",
  email: "execution-daemon-e2e@example.test",
};
const GOAL = "Prove the standalone execution daemon completes durable work.";
const EXPECTED_RUNTIME_TEXT = `fixture-success:${ATTEMPT_ID}`;
const PROCESS_TIMEOUT_MS = 15_000;

type ProcessEvent = {
  schemaVersion?: number;
  type?: string;
  [key: string]: unknown;
};

type GitWorkspaceLifecycle = {
  schemaVersion: number;
  kind: string;
  binding: Record<string, unknown>;
  prepared: Record<string, unknown> & {
    branch: string;
    repositoryPath: string;
    worktreePath: string;
  };
  runtimeCompletion: Record<string, unknown>;
  finalized: Record<string, unknown> & {
    branch: string;
    baseCommit: string;
    headCommit: string;
    files: string[];
    diffSummary: Record<string, unknown>;
    patchSha256: string;
  };
  changeRequestId: string;
  cleanedAt: string;
};

type PreparedGitWorkspaceLifecycle = Pick<
  GitWorkspaceLifecycle,
  "schemaVersion" | "kind" | "binding" | "prepared"
>;

type CancelledGitWorkspaceLifecycle = PreparedGitWorkspaceLifecycle & {
  runtimeCompletion: Record<string, unknown> & {
    status: string;
    runtimeRunId?: string;
  };
  cleanedAt: string;
};

type CleanupCrashStage =
  | "before-workspace-cleanup"
  | "after-workspace-cleanup"
  | "after-cleaned-lifecycle-persist";

test("built daemon completes a seeded SQLite attempt in a standalone process", async () => {
  test.setTimeout(45_000);

  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-execution-daemon-process-"),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const runtimeCwd = path.join(temporaryRoot, "workspace");
  const databasePath = path.join(appDataRoot, "daemon.db");
  const databaseUrl = `file:${databasePath}`;
  const configPath = path.join(appDataRoot, "execution-daemon.json");
  const daemonEntry = path.join(
    repositoryRoot,
    ".vite",
    "execution-daemon",
    "index.mjs",
  );
  const runtimeFixture = path.join(
    repositoryRoot,
    "apps",
    "execution-daemon",
    "fixtures",
    "success-runtime.mjs",
  );
  let client: Client | null = null;
  let daemon: ObservedProcess | null = null;

  try {
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(runtimeCwd, { recursive: true }),
    ]);
    await applyProductionMigrations(repositoryRoot, databaseUrl);

    client = createClient({ url: databaseUrl });
    await seedExecution(client);
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        workerId: WORKER_ID,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        leaseDurationMs: 3_000,
        shutdownGraceMs: 2_000,
        runtimes: [
          {
            driver: "generic-cli",
            runtimeId: RUNTIME_ID,
            runtimeVersion: "process-fixture-v1",
            executable: process.execPath,
            args: [runtimeFixture],
            cwd: runtimeCwd,
            envAllowlist: [],
            capacityTotal: 1,
            timeoutMs: 5_000,
            interruptGracePeriodMs: 200,
            maxStdoutBytes: 4_096,
            maxStderrBytes: 1_024,
          },
        ],
      }),
    );

    daemon = observeProcess(
      spawn(process.execPath, [daemonEntry], {
        cwd: repositoryRoot,
        env: {
          DATABASE_URL: databaseUrl,
          DAO_APP_DATA_ROOT: appDataRoot,
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          NODE_ENV: "test",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    const ready = await daemon.waitForEvent("stdout", "ready");
    expect(ready).toMatchObject({
      schemaVersion: 1,
      type: "ready",
      organizationId: ORGANIZATION_ID,
      workerId: WORKER_ID,
      runtimeIds: [RUNTIME_ID],
      pid: daemon.child.pid,
    });

    let lastObserved: unknown = null;
    const terminal = await pollUntil(
      async () => {
        let result;
        try {
          result = await client!.execute({
            sql: `
              SELECT
                attempt."status" AS "attemptStatus",
                attempt."generation" AS "generation",
                attempt."leaseOwnerId" AS "leaseOwnerId",
                attempt."leaseExpiresAt" AS "leaseExpiresAt",
                attempt."runtimeRunId" AS "runtimeRunId",
                attempt."resultJson" AS "attemptResultJson",
                job."status" AS "jobStatus",
                job."resultJson" AS "jobResultJson",
                runtime."capacityUsed" AS "capacityUsed"
              FROM "ExecutionAttempt" AS attempt
              JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
              JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
              WHERE attempt."id" = ?
            `,
            args: [ATTEMPT_ID],
          });
        } catch (error) {
          if (isSqliteBusy(error)) return null;
          throw error;
        }
        const row = result.rows[0];
        lastObserved = row ?? null;
        return row?.attemptStatus === "succeeded" &&
          row?.jobStatus === "succeeded"
          ? row
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () =>
        `the seeded execution attempt to succeed; last state=${JSON.stringify(
          lastObserved,
        )}; stdout=${redactProcessOutput(daemon?.stdout() ?? "", [
          temporaryRoot,
          databaseUrl,
          configPath,
        ])}; stderr=${redactProcessOutput(daemon?.stderr() ?? "", [
          temporaryRoot,
          databaseUrl,
          configPath,
        ])}`,
    );

    expect(terminal).toMatchObject({
      attemptStatus: "succeeded",
      jobStatus: "succeeded",
      generation: 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      capacityUsed: 0,
    });
    expect(terminal.runtimeRunId).toEqual(expect.any(String));
    expect(JSON.parse(String(terminal.attemptResultJson))).toMatchObject({
      runtimeRunId: terminal.runtimeRunId,
      text: EXPECTED_RUNTIME_TEXT,
      truncated: false,
    });
    expect(JSON.parse(String(terminal.jobResultJson))).toMatchObject({
      runtimeRunId: terminal.runtimeRunId,
      text: EXPECTED_RUNTIME_TEXT,
      truncated: false,
    });

    const events = await client.execute({
      sql: `
        SELECT "sequence", "type", "source", "runtimeEventId", "payloadJson"
        FROM "ExecutionEvent"
        WHERE "attemptId" = ?
        ORDER BY "sequence" ASC
      `,
      args: [ATTEMPT_ID],
    });
    const eventTypes = events.rows.map((row) => row.type);
    expect(eventTypes[0]).toBe("attempt-started");
    expect(eventTypes.at(-1)).toBe("attempt-completed");
    expect(eventTypes).toContain("text-delta");
    expect(events.rows.every((row) => row.source === "runtime")).toBe(true);
    expect(events.rows.map((row) => row.runtimeEventId)).toEqual(
      events.rows.map((_, index) => `generation:1:event:${index + 1}`),
    );
    expect(
      events.rows
        .filter((row) => row.type === "text-delta")
        .map((row) => JSON.parse(String(row.payloadJson)).text)
        .join(""),
    ).toBe(EXPECTED_RUNTIME_TEXT);

    daemon.child.kill("SIGTERM");
    const stopped = await daemon.waitForEvent("stdout", "stopped");
    expect(stopped).toMatchObject({
      schemaVersion: 1,
      type: "stopped",
      reason: "SIGTERM",
      workerId: WORKER_ID,
      pid: daemon.child.pid,
    });
    await expect(daemon.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });

    expect(daemon.events("stdout").map((event) => event.type)).toEqual([
      "ready",
      "stopped",
    ]);
    expect(
      daemon.events("stderr").filter((event) => event.type === "error"),
    ).toEqual([]);
    expect(`${daemon.stdout()}${daemon.stderr()}`).not.toContain(databaseUrl);
    expect(`${daemon.stdout()}${daemon.stderr()}`).not.toContain(configPath);
  } finally {
    if (daemon && daemon.child.exitCode === null) {
      daemon.child.kill("SIGTERM");
      await daemon.waitForExit(2_000).catch(async () => {
        daemon?.child.kill("SIGKILL");
        await daemon?.waitForExit(2_000).catch(() => undefined);
      });
    }
    await client?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("built daemon dynamically loads a trusted module and natively resumes exact human input", async () => {
  test.setTimeout(45_000);

  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-execution-plugin-process-"),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const pluginRoot = path.join(temporaryRoot, "runtime plugins # %");
  const databasePath = path.join(appDataRoot, "daemon.db");
  const databaseUrl = `file:${databasePath}`;
  const configPath = path.join(appDataRoot, "execution-daemon.json");
  const pluginPath = path.join(pluginRoot, "native resume # adapter %.mjs");
  const markerPath = path.join(pluginRoot, "plugin-calls.jsonl");
  const daemonEntry = path.join(
    repositoryRoot,
    ".vite",
    "execution-daemon",
    "index.mjs",
  );
  const requestId = "external-plugin-approval";
  const responseId = "external-plugin-response";
  const checkpointRef = "external-plugin-checkpoint";
  const runtimeAttemptId = "external-plugin-native-attempt";
  const runtimeSecret = "external-plugin-private-token";
  const humanResponse = {
    approved: true,
    note: "resume this exact run",
    nested: { choices: [1, "two", false] },
  };
  let client: Client | null = null;
  let daemon: ObservedProcess | null = null;

  try {
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(pluginRoot, { recursive: true }),
    ]);
    await applyProductionMigrations(repositoryRoot, databaseUrl);
    client = createClient({ url: databaseUrl });
    await seedExecution(client);
    await writeFile(
      pluginPath,
      nativeResumePluginSource({
        checkpointRef,
        markerPath,
        requestId,
        runtimeAttemptId,
        runtimeId: RUNTIME_ID,
        runtimeSecret,
      }),
      "utf8",
    );
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        workerId: WORKER_ID,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        leaseDurationMs: 3_000,
        shutdownGraceMs: 2_000,
        runtimes: [
          {
            driver: "external-module",
            runtimeId: RUNTIME_ID,
            contractVersion: 1,
            modulePath: pluginPath,
            exportName: "createRuntimePluginV1",
            envAllowlist: ["EXTERNAL_RUNTIME_TOKEN"],
            capacityTotal: 1,
          },
        ],
      }),
      "utf8",
    );

    daemon = observeProcess(
      spawn(process.execPath, [daemonEntry], {
        cwd: repositoryRoot,
        env: {
          DATABASE_URL: databaseUrl,
          DAO_APP_DATA_ROOT: appDataRoot,
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          EXTERNAL_RUNTIME_TOKEN: runtimeSecret,
          EXTERNAL_RUNTIME_BLOCKED_SECRET: "must-not-reach-factory",
          NODE_ENV: "test",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    await expect(daemon.waitForEvent("stdout", "ready")).resolves.toMatchObject({
      schemaVersion: 1,
      type: "ready",
      runtimeIds: [RUNTIME_ID],
      pid: daemon.child.pid,
    });

    const waiting = await pollUntil(
      async () => {
        const state = await client!.execute({
          sql: `
            SELECT attempt."status" AS "attemptStatus",
                   attempt."generation" AS "generation",
                   attempt."runtimeRunId" AS "runtimeRunId",
                   attempt."checkpointJson" AS "checkpointJson",
                   attempt."capacityReserved" AS "capacityReserved",
                   attempt."leaseOwnerId" AS "leaseOwnerId",
                   job."status" AS "jobStatus",
                   job."revision" AS "jobRevision",
                   runtime."capacityUsed" AS "capacityUsed",
                   request."status" AS "requestStatus",
                   request."revision" AS "requestRevision"
            FROM "ExecutionAttempt" AS attempt
            JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
            JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
            LEFT JOIN "ExecutionInputRequest" AS request ON request."id" = ?
            WHERE attempt."id" = ?
          `,
          args: [requestId, ATTEMPT_ID],
        });
        const row = state.rows[0];
        return row?.attemptStatus === "waiting_input" &&
          row?.jobStatus === "waiting_input" &&
          row?.requestStatus === "pending"
          ? row
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () =>
        `external plugin to suspend; stdout=${redactProcessOutput(
          daemon?.stdout() ?? "",
          [temporaryRoot, databaseUrl, configPath, runtimeSecret],
        )}; stderr=${redactProcessOutput(daemon?.stderr() ?? "", [
          temporaryRoot,
          databaseUrl,
          configPath,
          runtimeSecret,
        ])}`,
    );

    expect(waiting).toMatchObject({
      attemptStatus: "waiting_input",
      generation: 2,
      runtimeRunId: runtimeAttemptId,
      checkpointJson: JSON.stringify(checkpointRef),
      capacityReserved: 0,
      leaseOwnerId: null,
      jobStatus: "waiting_input",
      capacityUsed: 0,
      requestStatus: "pending",
      requestRevision: 1,
    });

    const answered = await pollUntil(
      async () => {
        try {
          return await answerExecutionInputForProcessTest(client!, {
            expectedInputRevision: Number(waiting.requestRevision),
            expectedJobRevision: Number(waiting.jobRevision),
            requestId,
            responseId,
            response: humanResponse,
          });
        } catch (error) {
          return isTransientSqliteBusy(error) ? null : Promise.reject(error);
        }
      },
      PROCESS_TIMEOUT_MS,
      "the exact human answer to be accepted",
    );
    expect(answered).toMatchObject({
      requestStatus: "answered",
      requestRevision: 2,
      responseId,
      responseJson: JSON.stringify(humanResponse),
      attemptStatus: "pending",
      generation: 2,
      jobStatus: "queued",
      jobRevision: 4,
    });

    const terminal = await pollUntil(
      async () => {
        const result = await client!.execute({
          sql: `
            SELECT attempt."status" AS "attemptStatus",
                   attempt."generation" AS "generation",
                   attempt."runtimeRunId" AS "runtimeRunId",
                   attempt."resultJson" AS "resultJson",
                   job."status" AS "jobStatus",
                   runtime."capacityUsed" AS "capacityUsed",
                   runtime."driver" AS "driver",
                   runtime."registrationJson" AS "registrationJson"
            FROM "ExecutionAttempt" AS attempt
            JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
            JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
            WHERE attempt."id" = ?
          `,
          args: [ATTEMPT_ID],
        });
        const row = result.rows[0];
        return row?.attemptStatus === "succeeded" &&
          row?.jobStatus === "succeeded"
          ? row
          : null;
      },
      PROCESS_TIMEOUT_MS,
      "external plugin native resume to succeed",
    );
    expect(terminal).toMatchObject({
      attemptStatus: "succeeded",
      jobStatus: "succeeded",
      generation: 3,
      runtimeRunId: runtimeAttemptId,
      capacityUsed: 0,
      driver: "external-module",
    });
    expect(JSON.parse(String(terminal.resultJson))).toMatchObject({
      runtimeRunId: runtimeAttemptId,
      text: `native-resume:${responseId}`,
    });
    expect(String(terminal.registrationJson)).not.toContain(runtimeSecret);

    const calls = await pollUntil(
      async () => {
        const records = await readJsonLines(markerPath);
        return records.some((record) => record.type === "resume")
          ? records
          : null;
      },
      PROCESS_TIMEOUT_MS,
      "external plugin resume marker",
    );
    expect(calls.filter((record) => record.type === "module-loaded")).toHaveLength(1);
    expect(calls.filter((record) => record.type === "factory")).toHaveLength(1);
    expect(calls.filter((record) => record.type === "start")).toHaveLength(1);
    expect(calls.filter((record) => record.type === "resume")).toHaveLength(1);
    expect(calls.find((record) => record.type === "module-loaded")).toMatchObject({
      pid: daemon.child.pid,
    });
    expect(calls.find((record) => record.type === "factory")).toMatchObject({
      contractVersion: 1,
      runtimeId: RUNTIME_ID,
      environmentKeys: ["EXTERNAL_RUNTIME_TOKEN"],
      frozen: true,
    });
    expect(calls.find((record) => record.type === "resume")).toMatchObject({
      input: {
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
        generation: 3,
        runtimeAttemptId,
        checkpointRef,
        humanInput: { requestId, responseId, response: humanResponse },
      },
    });

    const persistedEvents = await client.execute({
      sql: `SELECT "type", "runtimeEventId" FROM "ExecutionEvent"
            WHERE "attemptId" = ? ORDER BY "sequence" ASC`,
      args: [ATTEMPT_ID],
    });
    expect(persistedEvents.rows.map((row) => row.type)).toEqual([
      "attempt-started",
      "checkpoint",
      "waiting-for-human",
      "text-delta",
      "attempt-completed",
    ]);
    expect(persistedEvents.rows.map((row) => row.runtimeEventId)).toEqual([
      "generation:1:event:1",
      "generation:1:event:2",
      "generation:1:event:3",
      "generation:3:event:1",
      "generation:3:event:2",
    ]);

    expect(`${daemon.stdout()}${daemon.stderr()}`).not.toContain(runtimeSecret);
    daemon.child.kill("SIGTERM");
    await daemon.waitForEvent("stdout", "stopped");
    await expect(daemon.waitForExit()).resolves.toEqual({ code: 0, signal: null });
  } finally {
    await stopObservedProcess(daemon);
    await client?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("built daemon turns a real Git worktree change into a pending review", async () => {
  test.setTimeout(60_000);

  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-execution-daemon-git-process-"),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const runtimeFallbackCwd = path.join(temporaryRoot, "runtime-fallback");
  const knowledgeRepository = path.join(temporaryRoot, "knowledge-repository");
  const managedWorktreeRoot = path.join(temporaryRoot, "managed-worktrees");
  const databasePath = path.join(appDataRoot, "daemon.db");
  const databaseUrl = `file:${databasePath}`;
  const configPath = path.join(appDataRoot, "execution-daemon.json");
  const daemonEntry = path.join(
    repositoryRoot,
    ".vite",
    "execution-daemon",
    "index.mjs",
  );
  const runtimeFixture = path.join(
    repositoryRoot,
    "apps",
    "execution-daemon",
    "fixtures",
    "git-change-runtime.mjs",
  );
  let client: Client | null = null;
  let daemon: ObservedProcess | null = null;
  let lifecycle: GitWorkspaceLifecycle | null = null;

  try {
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(runtimeFallbackCwd, { recursive: true }),
    ]);
    const baseCommit = await initializeGitRepository(knowledgeRepository);
    await applyProductionMigrations(repositoryRoot, databaseUrl);

    client = createClient({ url: databaseUrl });
    await seedExecution(client, {
      knowledge: {
        repositoryPath: knowledgeRepository,
        baseCommit,
      },
    });
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        workerId: WORKER_ID,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        leaseDurationMs: 3_000,
        shutdownGraceMs: 2_000,
        runtimes: [
          {
            driver: "generic-cli",
            runtimeId: RUNTIME_ID,
            runtimeVersion: "process-git-fixture-v1",
            executable: process.execPath,
            args: [runtimeFixture],
            cwd: runtimeFallbackCwd,
            envAllowlist: [],
            capacityTotal: 1,
            timeoutMs: 10_000,
            interruptGracePeriodMs: 200,
            maxStdoutBytes: 4_096,
            maxStderrBytes: 1_024,
            worktree: {
              enabled: true,
              managedRoot: managedWorktreeRoot,
              commitAuthor: WORKTREE_AUTHOR,
            },
          },
        ],
      }),
    );

    daemon = observeProcess(
      spawn(process.execPath, [daemonEntry], {
        cwd: repositoryRoot,
        env: {
          DATABASE_URL: databaseUrl,
          DAO_APP_DATA_ROOT: appDataRoot,
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          NODE_ENV: "test",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );

    await expect(daemon.waitForEvent("stdout", "ready")).resolves.toMatchObject({
      schemaVersion: 1,
      type: "ready",
      organizationId: ORGANIZATION_ID,
      workerId: WORKER_ID,
      runtimeIds: [RUNTIME_ID],
      pid: daemon.child.pid,
    });

    let lastObserved: unknown = null;
    const terminal = await pollUntil(
      async () => {
        const state = await readGitExecutionState(client!);
        lastObserved = state;
        if (
          state?.attemptStatus !== "succeeded" ||
          state.jobStatus !== "succeeded" ||
          state.changeRequestStatus !== "pending_review" ||
          typeof state.workspaceLifecycleJson !== "string"
        ) {
          return null;
        }
        const parsed = parseGitWorkspaceLifecycle(
          state.workspaceLifecycleJson,
        );
        return parsed.cleanedAt ? { state, lifecycle: parsed } : null;
      },
      PROCESS_TIMEOUT_MS,
      () =>
        [
          `the Git-backed execution attempt to succeed; last state=${JSON.stringify(lastObserved)}`,
          `stdout=${redactProcessOutput(daemon?.stdout() ?? "", [
            temporaryRoot,
            databaseUrl,
            configPath,
          ])}`,
          `stderr=${redactProcessOutput(daemon?.stderr() ?? "", [
            temporaryRoot,
            databaseUrl,
            configPath,
          ])}`,
        ].join("; "),
    );
    lifecycle = terminal.lifecycle;

    expect(terminal.state).toMatchObject({
      attemptStatus: "succeeded",
      jobStatus: "succeeded",
      generation: 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      capacityUsed: 0,
      changeRequestId: lifecycle.changeRequestId,
      changeRequestStatus: "pending_review",
      changeRequestBaseCommit: baseCommit,
      changeRequestHeadCommit: lifecycle.finalized.headCommit,
      changeRequestBranch: EXPECTED_ATTEMPT_BRANCH,
      changeRequestRevision: 1,
    });
    expect(terminal.state.runtimeRunId).toEqual(expect.any(String));
    const changeRequestCount = await client.execute({
      sql: `
        SELECT COUNT(*) AS "count"
        FROM "KnowledgeChangeRequest"
        WHERE "attemptId" = ?
      `,
      args: [ATTEMPT_ID],
    });
    expect(Number(changeRequestCount.rows[0]?.count)).toBe(1);

    expect(lifecycle).toMatchObject({
      schemaVersion: 1,
      kind: "git-worktree",
      binding: {
        schemaVersion: 1,
        bindingId: KNOWLEDGE_BINDING_ID,
        spaceId: KNOWLEDGE_SPACE_ID,
        workspaceId: WORKSPACE_ID,
        agentId: null,
        mountPath: "/",
        defaultBranch: DEFAULT_BRANCH,
        baseCommit,
      },
      prepared: {
        schemaVersion: 1,
        spaceId: KNOWLEDGE_SPACE_ID,
        mountPath: "/",
        repositoryPath: knowledgeRepository,
        defaultBranch: DEFAULT_BRANCH,
        branch: EXPECTED_ATTEMPT_BRANCH,
        baseCommit,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
        attemptNumber: 1,
      },
      runtimeCompletion: {
        status: "succeeded",
        runtimeRunId: terminal.state.runtimeRunId,
      },
      finalized: {
        schemaVersion: 1,
        spaceId: KNOWLEDGE_SPACE_ID,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
        changed: true,
        baseCommit,
        branch: EXPECTED_ATTEMPT_BRANCH,
        files: [RUNTIME_CHANGE_FILE],
        diffSummary: {
          filesChanged: 1,
          insertions: 1,
          deletions: 0,
        },
      },
      changeRequestId: expect.any(String),
      cleanedAt: expect.any(String),
    });
    expect(lifecycle.prepared.worktreePath).not.toBe(runtimeFallbackCwd);
    expect(lifecycle.finalized.headCommit).not.toBe(baseCommit);
    expect(lifecycle.finalized.patchSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(lifecycle.cleanedAt).toISOString()).toBe(
      lifecycle.cleanedAt,
    );

    expect(JSON.parse(String(terminal.state.attemptResultJson))).toMatchObject({
      runtimeRunId: terminal.state.runtimeRunId,
      text: `fixture-git-change:${ATTEMPT_ID}:${baseCommit}`,
      truncated: false,
    });
    expect(JSON.parse(String(terminal.state.jobResultJson))).toMatchObject({
      runtimeRunId: terminal.state.runtimeRunId,
      text: `fixture-git-change:${ATTEMPT_ID}:${baseCommit}`,
      truncated: false,
    });

    const diffMetadata = JSON.parse(
      String(terminal.state.changeRequestDiffMetadataJson),
    );
    expect(diffMetadata).toEqual({
      bindingId: KNOWLEDGE_BINDING_ID,
      mountPath: "/",
      files: [RUNTIME_CHANGE_FILE],
      shortStat: lifecycle.finalized.diffSummary.shortStat,
      insertions: 1,
      deletions: 0,
      patchSha256: lifecycle.finalized.patchSha256,
    });

    const events = await readExecutionEvents(client);
    expect(events.map((event) => event.type)).toEqual([
      "attempt-started",
      "text-delta",
      "attempt-completed",
    ]);
    expect(
      events.filter((event) => event.type === "attempt-completed"),
    ).toHaveLength(1);

    expect(await pathExists(lifecycle.prepared.worktreePath)).toBe(false);
    const registeredWorktrees = await gitText(knowledgeRepository, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    expect(registeredWorktrees).not.toContain(lifecycle.prepared.worktreePath);
    expect(registeredWorktrees).not.toContain(
      `branch refs/heads/${EXPECTED_ATTEMPT_BRANCH}`,
    );
    expect(
      await gitText(knowledgeRepository, [
        "rev-parse",
        `refs/heads/${DEFAULT_BRANCH}`,
      ]),
    ).toBe(baseCommit);
    expect(
      await gitText(knowledgeRepository, [
        "rev-parse",
        `refs/heads/${EXPECTED_ATTEMPT_BRANCH}`,
      ]),
    ).toBe(lifecycle.finalized.headCommit);
    expect(
      await gitText(knowledgeRepository, [
        "show",
        `${lifecycle.finalized.headCommit}:${RUNTIME_CHANGE_FILE}`,
      ]),
    ).toBe(`changed by ${ATTEMPT_ID} at ${baseCommit}`);
    expect(
      await gitText(knowledgeRepository, [
        "show",
        "-s",
        "--format=%an%x00%ae%x00%cn%x00%ce",
        lifecycle.finalized.headCommit,
      ]),
    ).toBe(
      [
        WORKTREE_AUTHOR.name,
        WORKTREE_AUTHOR.email,
        WORKTREE_AUTHOR.name,
        WORKTREE_AUTHOR.email,
      ].join("\0"),
    );
    expect(
      await gitText(knowledgeRepository, [
        "show",
        "-s",
        "--format=%B",
        lifecycle.finalized.headCommit,
      ]),
    ).toBe(
      [
        `Knowledge change for job ${JOB_ID}`,
        "",
        `Job-Id: ${JOB_ID}`,
        `Attempt-Id: ${ATTEMPT_ID}`,
        "Agent-Id: unassigned",
      ].join("\n"),
    );

    daemon.child.kill("SIGTERM");
    await expect(daemon.waitForEvent("stdout", "stopped")).resolves.toMatchObject({
      schemaVersion: 1,
      type: "stopped",
      reason: "SIGTERM",
      workerId: WORKER_ID,
      pid: daemon.child.pid,
    });
    await expect(daemon.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });

    const processOutput = `${daemon.stdout()}${daemon.stderr()}`;
    for (const secret of [
      databaseUrl,
      configPath,
      knowledgeRepository,
      managedWorktreeRoot,
      lifecycle.prepared.worktreePath,
      KNOWLEDGE_CREDENTIAL_REF,
    ]) {
      expect(processOutput).not.toContain(secret);
    }
  } finally {
    await stopObservedProcess(daemon);
    await client?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("reclaims a clean prepared Git worktree after a daemon crash", async () => {
  test.setTimeout(60_000);

  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-execution-daemon-reclaim-"),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const runtimeFallbackCwd = path.join(temporaryRoot, "runtime-fallback");
  const knowledgeRepository = path.join(temporaryRoot, "knowledge-repository");
  const managedWorktreeRoot = path.join(temporaryRoot, "managed-worktrees");
  const databasePath = path.join(appDataRoot, "daemon.db");
  const databaseUrl = `file:${databasePath}`;
  const configPath = path.join(appDataRoot, "execution-daemon.json");
  const markerPath = path.join(temporaryRoot, "prepared-reclaim.marker.json");
  const daemonEntry = path.join(
    repositoryRoot,
    ".vite",
    "execution-daemon",
    "index.mjs",
  );
  const runtimeFixture = path.join(
    repositoryRoot,
    "apps",
    "execution-daemon",
    "fixtures",
    "git-controlled-runtime.mjs",
  );
  const daemonEnvironment = {
    DATABASE_URL: databaseUrl,
    DAO_APP_DATA_ROOT: appDataRoot,
    DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
    NODE_ENV: "test",
  } satisfies NodeJS.ProcessEnv;
  let client: Client | null = null;
  let crashedDaemon: ObservedProcess | null = null;
  let recoveryDaemon: ObservedProcess | null = null;

  const writeDaemonConfig = (workerId: string) =>
    writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        workerId,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        leaseDurationMs: 1_000,
        shutdownGraceMs: 1_000,
        runtimes: [
          {
            driver: "generic-cli",
            runtimeId: RUNTIME_ID,
            runtimeVersion: "process-git-fixture-v1",
            executable: process.execPath,
            args: [
              runtimeFixture,
              "--scenario",
              "prepared-reclaim",
              "--marker",
              markerPath,
            ],
            cwd: runtimeFallbackCwd,
            envAllowlist: [],
            capacityTotal: 1,
            timeoutMs: 20_000,
            interruptGracePeriodMs: 200,
            maxStdoutBytes: 4_096,
            maxStderrBytes: 1_024,
            worktree: {
              enabled: true,
              managedRoot: managedWorktreeRoot,
              commitAuthor: WORKTREE_AUTHOR,
            },
          },
        ],
      }),
    );
  const startDaemon = () =>
    observeProcess(
      spawn(process.execPath, [daemonEntry], {
        cwd: repositoryRoot,
        env: daemonEnvironment,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  const diagnostics = (label: string, lastState: unknown): string =>
    [
      `${label}; last state=${JSON.stringify(lastState)}`,
      `crashed stdout=${redactProcessOutput(crashedDaemon?.stdout() ?? "", [
        temporaryRoot,
        databaseUrl,
        configPath,
      ])}`,
      `crashed stderr=${redactProcessOutput(crashedDaemon?.stderr() ?? "", [
        temporaryRoot,
        databaseUrl,
        configPath,
      ])}`,
      `recovery stdout=${redactProcessOutput(recoveryDaemon?.stdout() ?? "", [
        temporaryRoot,
        databaseUrl,
        configPath,
      ])}`,
      `recovery stderr=${redactProcessOutput(recoveryDaemon?.stderr() ?? "", [
        temporaryRoot,
        databaseUrl,
        configPath,
      ])}`,
    ].join("; ");

  try {
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(runtimeFallbackCwd, { recursive: true }),
    ]);
    const baseCommit = await initializeGitRepository(knowledgeRepository);
    await applyProductionMigrations(repositoryRoot, databaseUrl);
    client = createClient({ url: databaseUrl });
    await seedExecution(client, {
      knowledge: { repositoryPath: knowledgeRepository, baseCommit },
    });

    await writeDaemonConfig(CRASHED_WORKER_ID);
    crashedDaemon = startDaemon();
    await expect(
      crashedDaemon.waitForEvent("stdout", "ready"),
    ).resolves.toMatchObject({
      type: "ready",
      workerId: CRASHED_WORKER_ID,
    });

    let firstObserved: unknown = null;
    const firstClaim = await pollUntil(
      async () => {
        const [state, marker, events] = await Promise.all([
          readGitExecutionState(client!),
          readJsonFile(markerPath),
          readExecutionEvents(client!),
        ]);
        const lifecycle =
          typeof state?.workspaceLifecycleJson === "string"
            ? parsePreparedGitWorkspaceLifecycle(state.workspaceLifecycleJson)
            : null;
        firstObserved = { state, marker, lifecycle, events };
        return state?.attemptStatus === "running" &&
          state.jobStatus === "running" &&
          state.generation === 1 &&
          state.leaseOwnerId === CRASHED_WORKER_ID &&
          state.capacityUsed === 1 &&
          typeof state.runtimeRunId === "string" &&
          marker?.attemptId === ATTEMPT_ID &&
          marker.generation === 1 &&
          marker.workspacePath === lifecycle?.prepared.worktreePath &&
          lifecycle !== null &&
          events.some(
            (event) =>
              event.runtimeEventId === "generation:1:event:1" &&
              event.type === "attempt-started",
          )
          ? { state, marker, lifecycle }
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () =>
        diagnostics("the first daemon to claim generation 1", firstObserved),
    );

    expect(firstClaim.lifecycle).toMatchObject({
      schemaVersion: 1,
      kind: "git-worktree",
      binding: {
        bindingId: KNOWLEDGE_BINDING_ID,
        spaceId: KNOWLEDGE_SPACE_ID,
        workspaceId: WORKSPACE_ID,
        agentId: null,
        baseCommit,
      },
      prepared: {
        repositoryPath: knowledgeRepository,
        worktreePath: firstClaim.marker.workspacePath,
        branch: EXPECTED_ATTEMPT_BRANCH,
        baseCommit,
        jobId: JOB_ID,
        attemptId: ATTEMPT_ID,
        attemptNumber: 1,
      },
    });
    expect(Object.keys(firstClaim.lifecycle).sort()).toEqual([
      "binding",
      "kind",
      "prepared",
      "schemaVersion",
    ]);
    expect(await pathExists(firstClaim.lifecycle.prepared.worktreePath)).toBe(
      true,
    );
    expect(
      await gitText(firstClaim.lifecycle.prepared.worktreePath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ]),
    ).toBe("");
    expect(
      await gitText(firstClaim.lifecycle.prepared.worktreePath, [
        "rev-parse",
        "HEAD",
      ]),
    ).toBe(baseCommit);
    expect(await pathExists(path.join(
      firstClaim.lifecycle.prepared.worktreePath,
      RUNTIME_CHANGE_FILE,
    ))).toBe(false);

    expect(crashedDaemon.child.kill("SIGKILL")).toBe(true);
    await expect(crashedDaemon.waitForExit()).resolves.toEqual({
      code: null,
      signal: "SIGKILL",
    });
    expect(
      crashedDaemon.events("stdout").some((event) => event.type === "stopped"),
    ).toBe(false);

    const interruptedMarker = await pollUntil(
      () => readJsonFile(`${markerPath}.interrupted`),
      PROCESS_TIMEOUT_MS,
      () =>
        diagnostics(
          "the generation 1 runtime to stop after its daemon died",
          firstObserved,
        ),
    );
    expect(interruptedMarker).toMatchObject({
      attemptId: ATTEMPT_ID,
      generation: 1,
      pid: firstClaim.marker.pid,
      signal: "SIGTERM",
    });

    let expiredObserved: unknown = null;
    const expired = await pollUntil(
      async () => {
        const state = await readGitExecutionState(client!);
        expiredObserved = state;
        return state?.attemptStatus === "running" &&
          state.generation === 1 &&
          state.leaseOwnerId === CRASHED_WORKER_ID &&
          state.capacityUsed === 1 &&
          leaseExpired(state.leaseExpiresAt)
          ? state
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics("the generation 1 lease to expire", expiredObserved),
    );
    expect(expired.runtimeRunId).toBe(firstClaim.state.runtimeRunId);
    expect(expired.workspaceLifecycleJson).toBe(
      firstClaim.state.workspaceLifecycleJson,
    );
    expect(
      await gitText(firstClaim.lifecycle.prepared.worktreePath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
      ]),
    ).toBe("");

    const beforeRecoveryEvents = await readExecutionEvents(client);
    expect(beforeRecoveryEvents).toHaveLength(1);
    expect(beforeRecoveryEvents[0]).toMatchObject({
      type: "attempt-started",
      runtimeEventId: "generation:1:event:1",
    });

    await writeDaemonConfig(RECOVERY_WORKER_ID);
    recoveryDaemon = startDaemon();
    await expect(
      recoveryDaemon.waitForEvent("stdout", "ready"),
    ).resolves.toMatchObject({
      type: "ready",
      workerId: RECOVERY_WORKER_ID,
    });

    let recoveredObserved: unknown = null;
    const recovered = await pollUntil(
      async () => {
        const state = await readGitExecutionState(client!);
        recoveredObserved = state;
        return state?.attemptStatus === "succeeded" &&
          state.jobStatus === "succeeded" &&
          state.generation === 2 &&
          state.changeRequestStatus === "pending_review" &&
          typeof state.workspaceLifecycleJson === "string"
          ? {
              state,
              lifecycle: parseGitWorkspaceLifecycle(
                state.workspaceLifecycleJson,
              ),
            }
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () =>
        diagnostics(
          "the recovery daemon to complete generation 2",
          recoveredObserved,
        ),
    );

    expect(recovered.state).toMatchObject({
      attemptStatus: "succeeded",
      jobStatus: "succeeded",
      generation: 2,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      capacityUsed: 0,
      changeRequestId: recovered.lifecycle.changeRequestId,
      changeRequestStatus: "pending_review",
      changeRequestBaseCommit: baseCommit,
      changeRequestHeadCommit: recovered.lifecycle.finalized.headCommit,
      changeRequestBranch: EXPECTED_ATTEMPT_BRANCH,
    });
    expect(recovered.state.runtimeRunId).toEqual(expect.any(String));
    expect(recovered.state.runtimeRunId).not.toBe(
      firstClaim.state.runtimeRunId,
    );
    expect(JSON.parse(String(recovered.state.attemptResultJson))).toMatchObject({
      runtimeRunId: recovered.state.runtimeRunId,
      text: `fixture-git-reclaimed:${ATTEMPT_ID}:generation:2`,
      truncated: false,
    });
    expect(JSON.parse(String(recovered.state.jobResultJson))).toMatchObject({
      runtimeRunId: recovered.state.runtimeRunId,
      text: `fixture-git-reclaimed:${ATTEMPT_ID}:generation:2`,
      truncated: false,
    });
    expect(recovered.lifecycle).toMatchObject({
      binding: { agentId: null, baseCommit },
      prepared: firstClaim.lifecycle.prepared,
      runtimeCompletion: {
        status: "succeeded",
        runtimeRunId: recovered.state.runtimeRunId,
      },
      finalized: {
        changed: true,
        baseCommit,
        headCommit: recovered.state.changeRequestHeadCommit,
        branch: EXPECTED_ATTEMPT_BRANCH,
        files: [RUNTIME_CHANGE_FILE],
      },
      changeRequestId: expect.any(String),
      cleanedAt: expect.any(String),
    });

    const changeRequestCount = await readChangeRequestCount(client);
    expect(changeRequestCount).toBe(1);

    const recoveredEvents = await readExecutionEvents(client);
    expect(
      recoveredEvents.filter((event) =>
        String(event.runtimeEventId).startsWith("generation:1:"),
      ),
    ).toEqual([
      expect.objectContaining({
        type: "attempt-started",
        runtimeEventId: "generation:1:event:1",
      }),
    ]);
    expect(
      recoveredEvents.filter((event) => event.type === "attempt-started"),
    ).toHaveLength(2);
    expect(
      recoveredEvents.filter((event) => event.type === "attempt-completed"),
    ).toHaveLength(1);
    expect(
      recoveredEvents
        .filter(
          (event) =>
            event.type === "text-delta" &&
            String(event.runtimeEventId).startsWith("generation:2:"),
        )
        .map((event) => JSON.parse(String(event.payloadJson)).text)
        .join(""),
    ).toBe(`fixture-git-reclaimed:${ATTEMPT_ID}:generation:2`);

    expect(await pathExists(recovered.lifecycle.prepared.worktreePath)).toBe(
      false,
    );
    const registeredWorktrees = await gitText(knowledgeRepository, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    expect(registeredWorktrees).not.toContain(
      recovered.lifecycle.prepared.worktreePath,
    );
    expect(registeredWorktrees).not.toContain(
      `branch refs/heads/${EXPECTED_ATTEMPT_BRANCH}`,
    );
    expect(
      await gitText(knowledgeRepository, [
        "rev-list",
        "--count",
        `${baseCommit}..refs/heads/${EXPECTED_ATTEMPT_BRANCH}`,
      ]),
    ).toBe("1");
    expect(
      await gitText(knowledgeRepository, [
        "show",
        `${recovered.lifecycle.finalized.headCommit}:${RUNTIME_CHANGE_FILE}`,
      ]),
    ).toBe(`changed by ${ATTEMPT_ID} at ${baseCommit}`);

    recoveryDaemon.child.kill("SIGTERM");
    await expect(
      recoveryDaemon.waitForEvent("stdout", "stopped"),
    ).resolves.toMatchObject({
      type: "stopped",
      reason: "SIGTERM",
      workerId: RECOVERY_WORKER_ID,
    });
    await expect(recoveryDaemon.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });
  } finally {
    await stopObservedProcess(recoveryDaemon);
    await stopObservedProcess(crashedDaemon);
    await killRuntimeFromMarker(markerPath);
    await client?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

for (const crashStage of [
  "before-workspace-cleanup",
  "after-workspace-cleanup",
  "after-cleaned-lifecycle-persist",
] as const) {
  test(`recovers changed Git success after a crash at ${crashStage}`, async () => {
    test.setTimeout(75_000);
    await verifyChangedSuccessCleanupRecovery(crashStage);
  });
}

test("relays one terminal Room projection after a crash and restart", async () => {
  test.setTimeout(60_000);

  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-execution-daemon-relay-restart-"),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const runtimeCwd = path.join(temporaryRoot, "workspace");
  const databaseUrl = `file:${path.join(appDataRoot, "daemon.db")}`;
  const configPath = path.join(appDataRoot, "execution-daemon.json");
  const barrierPath = path.join(temporaryRoot, "relay-barrier.json");
  const daemonEntry = path.join(
    repositoryRoot,
    ".vite",
    "execution-daemon",
    "index.mjs",
  );
  const runtimeFixture = path.join(
    repositoryRoot,
    "apps",
    "execution-daemon",
    "fixtures",
    "success-runtime.mjs",
  );
  let client: Client | null = null;
  let crashedDaemon: ObservedProcess | null = null;
  let recoveryDaemon: ObservedProcess | null = null;

  const writeDaemonConfig = (workerId: string) =>
    writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        workerId,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        leaseDurationMs: 3_000,
        shutdownGraceMs: 1_000,
        runtimes: [
          {
            driver: "generic-cli",
            runtimeId: RUNTIME_ID,
            runtimeVersion: "process-fixture-v1",
            executable: process.execPath,
            args: [runtimeFixture],
            cwd: runtimeCwd,
            envAllowlist: [],
            capacityTotal: 1,
            timeoutMs: 5_000,
            interruptGracePeriodMs: 200,
            maxStdoutBytes: 4_096,
            maxStderrBytes: 1_024,
          },
        ],
      }),
    );
  const startDaemon = (barrier: boolean) =>
    observeProcess(
      spawn(process.execPath, [daemonEntry], {
        cwd: repositoryRoot,
        env: {
          DATABASE_URL: databaseUrl,
          DAO_APP_DATA_ROOT: appDataRoot,
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          ...(barrier
            ? {
                DAO_EXECUTION_DAEMON_TEST_BARRIER:
                  "before-room-projection-relay",
                DAO_EXECUTION_DAEMON_TEST_BARRIER_MARKER_PATH: barrierPath,
              }
            : {}),
          NODE_ENV: "test",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  const diagnostics = (label: string, observed: unknown): string =>
    [
      `${label}; last state=${JSON.stringify(observed)}`,
      `crashed stdout=${redactProcessOutput(crashedDaemon?.stdout() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
      `crashed stderr=${redactProcessOutput(crashedDaemon?.stderr() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
      `recovery stdout=${redactProcessOutput(recoveryDaemon?.stdout() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
      `recovery stderr=${redactProcessOutput(recoveryDaemon?.stderr() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
    ].join("; " );

  try {
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(runtimeCwd, { recursive: true }),
    ]);
    await applyProductionMigrations(repositoryRoot, databaseUrl);
    client = createClient({ url: databaseUrl });
    await seedExecution(client);
    await seedExecutionRoomOrigin(client);
    await writeDaemonConfig(CRASHED_WORKER_ID);

    crashedDaemon = startDaemon(true);
    await expect(
      crashedDaemon.waitForEvent("stdout", "ready"),
    ).resolves.toMatchObject({ workerId: CRASHED_WORKER_ID });

    let pendingObserved: unknown = null;
    const pending = await pollUntil(
      async () => {
        const [marker, state] = await Promise.all([
          readJsonFile(barrierPath),
          readRoomProjectionState(client!),
        ]);
        pendingObserved = { marker, state };
        return marker?.stage === "before-room-projection-relay" &&
          marker.pid === crashedDaemon?.child.pid &&
          state?.attemptStatus === "succeeded" &&
          state.jobStatus === "succeeded" &&
          state.generation === 1 &&
          state.leaseOwnerId === null &&
          state.capacityUsed === 0 &&
          state.executionOutboxCount === 1 &&
          state.outboxTopic === "execution.completed" &&
          state.outboxStatus === "pending" &&
          state.outboxAttempts === 0 &&
          state.roomEventCount === 0 &&
          state.roomOutboxCount === 0 &&
          state.roomEventSequence === 0
          ? state
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics("terminal completion to remain pending before relay", pendingObserved),
    );

    expect(pending).toMatchObject({
      jobRevision: 3,
      outboxRoomEventId: null,
    });
    expect(crashedDaemon.child.kill("SIGKILL")).toBe(true);
    await expect(crashedDaemon.waitForExit()).resolves.toEqual({
      code: null,
      signal: "SIGKILL",
    });

    await writeDaemonConfig(RECOVERY_WORKER_ID);
    recoveryDaemon = startDaemon(false);
    await expect(
      recoveryDaemon.waitForEvent("stdout", "ready"),
    ).resolves.toMatchObject({ workerId: RECOVERY_WORKER_ID });

    let deliveredObserved: unknown = null;
    const delivered = await pollUntil(
      async () => {
        const state = await readRoomProjectionState(client!);
        deliveredObserved = state;
        return state?.outboxStatus === "delivered" ? state : null;
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics("the restarted daemon to relay the terminal projection", deliveredObserved),
    );

    expect(delivered).toMatchObject({
      attemptStatus: "succeeded",
      jobStatus: "succeeded",
      jobRevision: 3,
      generation: 1,
      leaseOwnerId: null,
      capacityUsed: 0,
      executionOutboxCount: 1,
      outboxId: pending.outboxId,
      outboxTopic: "execution.completed",
      outboxStatus: "delivered",
      outboxAttempts: 1,
      outboxRoomEventId: `execution:${pending.outboxId}`,
      roomEventCount: 1,
      roomEventId: `execution:${pending.outboxId}`,
      roomEventType: "execution.completed",
      roomOutboxCount: 1,
      roomOutboxId: `room:${pending.outboxId}`,
      roomOutboxDedupeKey: `execution:${pending.outboxId}`,
      roomEventSequence: 1,
    });
    expect(JSON.parse(String(delivered.outboxPayloadJson))).toMatchObject({
      schemaVersion: 1,
      jobId: JOB_ID,
      jobStatus: "succeeded",
      jobRevision: 3,
    });

    recoveryDaemon.child.kill("SIGTERM");
    await expect(
      recoveryDaemon.waitForEvent("stdout", "stopped"),
    ).resolves.toMatchObject({
      reason: "SIGTERM",
      workerId: RECOVERY_WORKER_ID,
    });
    await expect(recoveryDaemon.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });
    await expect(readRoomProjectionState(client)).resolves.toMatchObject({
      executionOutboxCount: 1,
      outboxAttempts: 1,
      roomEventCount: 1,
      roomOutboxCount: 1,
      roomEventSequence: 1,
    });
  } finally {
    await stopObservedProcess(recoveryDaemon);
    await stopObservedProcess(crashedDaemon);
    await client?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("cancels a running Git attempt without finalizing its worktree", async () => {
  test.setTimeout(60_000);

  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-execution-daemon-cancel-"),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const runtimeFallbackCwd = path.join(temporaryRoot, "runtime-fallback");
  const knowledgeRepository = path.join(temporaryRoot, "knowledge-repository");
  const managedWorktreeRoot = path.join(temporaryRoot, "managed-worktrees");
  const databasePath = path.join(appDataRoot, "daemon.db");
  const databaseUrl = `file:${databasePath}`;
  const configPath = path.join(appDataRoot, "execution-daemon.json");
  const markerPath = path.join(temporaryRoot, "cancel.marker.json");
  const daemonEntry = path.join(
    repositoryRoot,
    ".vite",
    "execution-daemon",
    "index.mjs",
  );
  const runtimeFixture = path.join(
    repositoryRoot,
    "apps",
    "execution-daemon",
    "fixtures",
    "git-controlled-runtime.mjs",
  );
  let client: Client | null = null;
  let daemon: ObservedProcess | null = null;
  let prepared: PreparedGitWorkspaceLifecycle | null = null;

  const diagnostics = (label: string, lastState: unknown): string =>
    [
      `${label}; last state=${JSON.stringify(lastState)}`,
      `stdout=${redactProcessOutput(daemon?.stdout() ?? "", [
        temporaryRoot,
        databaseUrl,
        configPath,
      ])}`,
      `stderr=${redactProcessOutput(daemon?.stderr() ?? "", [
        temporaryRoot,
        databaseUrl,
        configPath,
      ])}`,
    ].join("; " );

  try {
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(runtimeFallbackCwd, { recursive: true }),
    ]);
    const baseCommit = await initializeGitRepository(knowledgeRepository);
    await applyProductionMigrations(repositoryRoot, databaseUrl);
    client = createClient({ url: databaseUrl });
    await seedExecution(client, {
      knowledge: { repositoryPath: knowledgeRepository, baseCommit },
    });
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        workerId: WORKER_ID,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        leaseDurationMs: 3_000,
        shutdownGraceMs: 1_000,
        runtimes: [
          {
            driver: "generic-cli",
            runtimeId: RUNTIME_ID,
            runtimeVersion: "process-git-fixture-v1",
            executable: process.execPath,
            args: [
              runtimeFixture,
              "--scenario",
              "cancel",
              "--marker",
              markerPath,
            ],
            cwd: runtimeFallbackCwd,
            envAllowlist: [],
            capacityTotal: 1,
            timeoutMs: 20_000,
            interruptGracePeriodMs: 500,
            maxStdoutBytes: 4_096,
            maxStderrBytes: 1_024,
            worktree: {
              enabled: true,
              managedRoot: managedWorktreeRoot,
              commitAuthor: WORKTREE_AUTHOR,
            },
          },
        ],
      }),
    );

    daemon = observeProcess(
      spawn(process.execPath, [daemonEntry], {
        cwd: repositoryRoot,
        env: {
          DATABASE_URL: databaseUrl,
          DAO_APP_DATA_ROOT: appDataRoot,
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          NODE_ENV: "test",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    await expect(daemon.waitForEvent("stdout", "ready")).resolves.toMatchObject({
      type: "ready",
      workerId: WORKER_ID,
    });

    let runningObserved: unknown = null;
    const running = await pollUntil(
      async () => {
        const [state, marker, events] = await Promise.all([
          readGitExecutionState(client!),
          readJsonFile(markerPath),
          readExecutionEvents(client!),
        ]);
        const lifecycle =
          typeof state?.workspaceLifecycleJson === "string"
            ? parsePreparedGitWorkspaceLifecycle(state.workspaceLifecycleJson)
            : null;
        runningObserved = { state, marker, lifecycle, events };
        return state?.attemptStatus === "running" &&
          state.jobStatus === "running" &&
          state.jobRevision === 2 &&
          state.generation === 1 &&
          state.leaseOwnerId === WORKER_ID &&
          state.capacityUsed === 1 &&
          typeof state.runtimeRunId === "string" &&
          marker?.attemptId === ATTEMPT_ID &&
          marker.generation === 1 &&
          marker.workspacePath === lifecycle?.prepared.worktreePath &&
          lifecycle !== null &&
          events.some(
            (event) =>
              event.type === "attempt-started" &&
              event.runtimeEventId === "generation:1:event:1",
          )
          ? { state, marker, lifecycle }
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics("the Git runtime to reach its cancel barrier", runningObserved),
    );
    prepared = running.lifecycle;
    expect(prepared.binding).toMatchObject({
      bindingId: KNOWLEDGE_BINDING_ID,
      spaceId: KNOWLEDGE_SPACE_ID,
      workspaceId: WORKSPACE_ID,
      agentId: null,
      baseCommit,
    });
    expect(
      await gitText(prepared.prepared.worktreePath, [
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
      ]),
    ).toBe(`?? ${RUNTIME_CHANGE_FILE}`);

    const requested = await requestExecutionJobCancellation(client, 2);
    expect(requested).toMatchObject({
      jobStatus: "cancel_requested",
      jobRevision: 3,
      attemptStatus: "running",
      generation: 1,
      leaseOwnerId: WORKER_ID,
      capacityUsed: 1,
    });
    expect(requested.cancelRequestedAt).toEqual(expect.any(String));
    expect(requested.jobFinishedAt).toBeNull();

    let terminalObserved: unknown = null;
    const terminal = await pollUntil(
      async () => {
        const state = await readGitExecutionState(client!);
        terminalObserved = state;
        return state?.attemptStatus === "cancelled" &&
          state.jobStatus === "cancelled" &&
          typeof state.workspaceLifecycleJson === "string"
          ? {
              state,
              lifecycle: parseCancelledGitWorkspaceLifecycle(
                state.workspaceLifecycleJson,
              ),
            }
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics("the Git attempt to complete cancellation", terminalObserved),
    );

    expect(terminal.state).toMatchObject({
      attemptStatus: "cancelled",
      jobStatus: "cancelled",
      jobRevision: 4,
      generation: 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      capacityUsed: 0,
      runtimeRunId: running.state.runtimeRunId,
      attemptResultJson: null,
      jobResultJson: null,
      changeRequestId: null,
    });
    expect(terminal.state.cancelRequestedAt).toEqual(expect.any(String));
    expect(terminal.state.attemptFinishedAt).toEqual(expect.any(String));
    expect(terminal.state.jobFinishedAt).toEqual(expect.any(String));
    expect(JSON.parse(String(terminal.state.attemptErrorJson))).toEqual({
      message: "Execution cancelled.",
    });
    expect(JSON.parse(String(terminal.state.jobErrorJson))).toEqual({
      message: "Execution cancelled.",
    });
    expect(terminal.lifecycle).toMatchObject({
      binding: { agentId: null, baseCommit },
      prepared: prepared.prepared,
      runtimeCompletion: {
        status: "cancelled",
        runtimeRunId: running.state.runtimeRunId,
        error: {
          runtimeRunId: running.state.runtimeRunId,
          message: "Execution cancelled.",
        },
      },
      cleanedAt: expect.any(String),
    });

    expect(await readChangeRequestCount(client)).toBe(0);
    const events = await readExecutionEvents(client);
    expect(events.map((event) => event.type)).toEqual([
      "attempt-started",
      "attempt-completed",
    ]);
    expect(events.map((event) => event.runtimeEventId)).toEqual([
      "generation:1:event:1",
      "generation:1:event:2",
    ]);
    expect(JSON.parse(String(events[1].payloadJson))).toEqual({
      status: "interrupted",
      message: "Execution cancelled.",
    });
    await expect(
      pollUntil(
        () => readJsonFile(`${markerPath}.interrupted`),
        PROCESS_TIMEOUT_MS,
        "the controlled Git runtime to observe SIGTERM",
      ),
    ).resolves.toMatchObject({
      attemptId: ATTEMPT_ID,
      generation: 1,
      pid: running.marker.pid,
      signal: "SIGTERM",
    });

    expect(await pathExists(terminal.lifecycle.prepared.worktreePath)).toBe(
      false,
    );
    const registeredWorktrees = await gitText(knowledgeRepository, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    expect(registeredWorktrees).not.toContain(
      terminal.lifecycle.prepared.worktreePath,
    );
    expect(registeredWorktrees).not.toContain(
      `branch refs/heads/${EXPECTED_ATTEMPT_BRANCH}`,
    );
    expect(
      await gitText(knowledgeRepository, [
        "rev-parse",
        `refs/heads/${EXPECTED_ATTEMPT_BRANCH}`,
      ]),
    ).toBe(baseCommit);

    daemon.child.kill("SIGTERM");
    await expect(daemon.waitForEvent("stdout", "stopped")).resolves.toMatchObject({
      type: "stopped",
      reason: "SIGTERM",
      workerId: WORKER_ID,
    });
    await expect(daemon.waitForExit()).resolves.toEqual({
      code: 0,
      signal: null,
    });
  } finally {
    await stopObservedProcess(daemon);
    await killRuntimeFromMarker(markerPath);
    await client?.close();
    if (prepared?.prepared.worktreePath) {
      await pathExists(prepared.prepared.worktreePath);
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

async function verifyChangedSuccessCleanupRecovery(
  crashStage: CleanupCrashStage,
): Promise<void> {
  const repositoryRoot = process.cwd();
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), `dao-execution-daemon-cleanup-${crashStage}-`),
  );
  const appDataRoot = path.join(temporaryRoot, "app-data");
  const runtimeFallbackCwd = path.join(temporaryRoot, "runtime-fallback");
  const knowledgeRepository = path.join(temporaryRoot, "knowledge-repository");
  const managedWorktreeRoot = path.join(temporaryRoot, "managed-worktrees");
  const databaseUrl = `file:${path.join(appDataRoot, "daemon.db")}`;
  const configPath = path.join(appDataRoot, "execution-daemon.json");
  const barrierPath = path.join(temporaryRoot, "cleanup-barrier.json");
  const recoveryClaimBarrierPath = path.join(
    temporaryRoot,
    "recovery-claim-barrier.json",
  );
  const daemonEntry = path.join(
    repositoryRoot,
    ".vite",
    "execution-daemon",
    "index.mjs",
  );
  const runtimeFixture = path.join(
    repositoryRoot,
    "apps",
    "execution-daemon",
    "fixtures",
    "git-change-runtime.mjs",
  );
  let client: Client | null = null;
  let crashedDaemon: ObservedProcess | null = null;
  let recoveryDaemon: ObservedProcess | null = null;

  const writeDaemonConfig = (workerId: string) =>
    writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: ORGANIZATION_ID,
        workerId,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 200,
        leaseDurationMs: 1_000,
        shutdownGraceMs: 500,
        runtimes: [
          {
            driver: "generic-cli",
            runtimeId: RUNTIME_ID,
            runtimeVersion: "process-git-fixture-v1",
            executable: process.execPath,
            args: [runtimeFixture],
            cwd: runtimeFallbackCwd,
            envAllowlist: [],
            capacityTotal: 1,
            timeoutMs: 10_000,
            interruptGracePeriodMs: 200,
            maxStdoutBytes: 4_096,
            maxStderrBytes: 1_024,
            worktree: {
              enabled: true,
              managedRoot: managedWorktreeRoot,
              commitAuthor: WORKTREE_AUTHOR,
            },
          },
        ],
      }),
    );
  const startDaemon = (
    barrier?: {
      markerPath: string;
      stage: CleanupCrashStage | "after-attempt-claim";
    },
  ) =>
    observeProcess(
      spawn(process.execPath, [daemonEntry], {
        cwd: repositoryRoot,
        env: {
          DATABASE_URL: databaseUrl,
          DAO_APP_DATA_ROOT: appDataRoot,
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          ...(barrier
            ? {
                DAO_EXECUTION_DAEMON_TEST_BARRIER: barrier.stage,
                DAO_EXECUTION_DAEMON_TEST_BARRIER_MARKER_PATH:
                  barrier.markerPath,
              }
            : {}),
          NODE_ENV: "test",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  const diagnostics = (label: string, observed: unknown): string =>
    [
      `${label}; last state=${JSON.stringify(observed)}`,
      `crashed stdout=${redactProcessOutput(crashedDaemon?.stdout() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
      `crashed stderr=${redactProcessOutput(crashedDaemon?.stderr() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
      `recovery stdout=${redactProcessOutput(recoveryDaemon?.stdout() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
      `recovery stderr=${redactProcessOutput(recoveryDaemon?.stderr() ?? "", [temporaryRoot, databaseUrl, configPath])}`,
    ].join("; " );

  try {
    await Promise.all([
      mkdir(appDataRoot, { recursive: true }),
      mkdir(runtimeFallbackCwd, { recursive: true }),
    ]);
    const baseCommit = await initializeGitRepository(knowledgeRepository);
    await applyProductionMigrations(repositoryRoot, databaseUrl);
    client = createClient({ url: databaseUrl });
    await seedExecution(client, {
      knowledge: { repositoryPath: knowledgeRepository, baseCommit },
    });
    await writeDaemonConfig(CRASHED_WORKER_ID);
    crashedDaemon = startDaemon({ markerPath: barrierPath, stage: crashStage });
    await expect(
      crashedDaemon.waitForEvent("stdout", "ready"),
    ).resolves.toMatchObject({ workerId: CRASHED_WORKER_ID });

    let barrierObserved: unknown = null;
    const atBarrier = await pollUntil(
      async () => {
        const [marker, state] = await Promise.all([
          readJsonFile(barrierPath),
          readGitExecutionState(client!),
        ]);
        barrierObserved = { marker, state };
        if (
          marker?.stage !== crashStage ||
          state?.attemptStatus !== "running" ||
          state.jobStatus !== "running" ||
          state.generation !== 1 ||
          typeof state.workspaceLifecycleJson !== "string"
        ) {
          return null;
        }
        const lifecycle = parseChangedGitWorkspaceLifecycle(
          state.workspaceLifecycleJson,
          crashStage === "after-cleaned-lifecycle-persist",
        );
        return { marker, state, lifecycle };
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics(`the daemon to reach ${crashStage}`, barrierObserved),
    );

    expect(atBarrier.marker).toMatchObject({
      schemaVersion: 1,
      stage: crashStage,
      pid: crashedDaemon.child.pid,
    });
    expect(atBarrier.lifecycle).toMatchObject({
      binding: { baseCommit },
      runtimeCompletion: {
        status: "succeeded",
        runtimeRunId: atBarrier.state.runtimeRunId,
      },
      finalized: {
        changed: true,
        baseCommit,
        branch: EXPECTED_ATTEMPT_BRANCH,
        files: [RUNTIME_CHANGE_FILE],
      },
      changeRequestId: expect.any(String),
      ...(crashStage === "after-cleaned-lifecycle-persist"
        ? { cleanedAt: expect.any(String) }
        : {}),
    });
    expect(await readChangeRequestCount(client)).toBe(1);
    const removedBeforeCrash =
      crashStage !== "before-workspace-cleanup";
    expect(
      await pathExists(atBarrier.lifecycle.prepared.worktreePath),
    ).toBe(!removedBeforeCrash);
    if (!removedBeforeCrash) {
      expect(
        await gitText(atBarrier.lifecycle.prepared.worktreePath, [
          "rev-parse",
          "HEAD",
        ]),
      ).toBe(atBarrier.lifecycle.finalized.headCommit);
    }

    expect(crashedDaemon.child.kill("SIGKILL")).toBe(true);
    await expect(crashedDaemon.waitForExit()).resolves.toEqual({
      code: null,
      signal: "SIGKILL",
    });

    let expiredObserved: unknown = null;
    await pollUntil(
      async () => {
        const state = await readGitExecutionState(client!);
        expiredObserved = state;
        return state?.generation === 1 && leaseExpired(state.leaseExpiresAt)
          ? state
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics("the crashed cleanup lease to expire", expiredObserved),
    );

    await writeDaemonConfig(RECOVERY_WORKER_ID);
    let expectedRecoveryGeneration = 2;
    if (crashStage === "before-workspace-cleanup") {
      recoveryDaemon = startDaemon({
        markerPath: recoveryClaimBarrierPath,
        stage: "after-attempt-claim",
      });
      await expect(
        recoveryDaemon.waitForEvent("stdout", "ready"),
      ).resolves.toMatchObject({ workerId: RECOVERY_WORKER_ID });

      let reclaimedObserved: unknown = null;
      const reclaimed = await pollUntil(
        async () => {
          const [marker, state] = await Promise.all([
            readJsonFile(recoveryClaimBarrierPath),
            readGitExecutionState(client!),
          ]);
          reclaimedObserved = { marker, state };
          return marker?.stage === "after-attempt-claim" &&
            state?.attemptStatus === "running" &&
            state.jobStatus === "running" &&
            state.generation === 2 &&
            state.leaseOwnerId === RECOVERY_WORKER_ID
            ? { marker, state }
            : null;
        },
        PROCESS_TIMEOUT_MS,
        () => diagnostics(
          "the cleanup recovery claim to retain its runtime identity",
          reclaimedObserved,
        ),
      );
      expect(reclaimed.marker).toMatchObject({
        schemaVersion: 1,
        stage: "after-attempt-claim",
        pid: recoveryDaemon.child.pid,
      });
      expect(reclaimed.state).toMatchObject({
        generation: 2,
        runtimeRunId: atBarrier.state.runtimeRunId,
        capacityUsed: 1,
      });
      expect(reclaimed.state.workspaceLifecycleJson).toBe(
        atBarrier.state.workspaceLifecycleJson,
      );

      expect(recoveryDaemon.child.kill("SIGKILL")).toBe(true);
      await expect(recoveryDaemon.waitForExit()).resolves.toEqual({
        code: null,
        signal: "SIGKILL",
      });
      let reclaimedExpiryObserved: unknown = null;
      await pollUntil(
        async () => {
          const state = await readGitExecutionState(client!);
          reclaimedExpiryObserved = state;
          return state?.generation === 2 && leaseExpired(state.leaseExpiresAt)
            ? state
            : null;
        },
        PROCESS_TIMEOUT_MS,
        () => diagnostics(
          "the cleanup recovery probe lease to expire",
          reclaimedExpiryObserved,
        ),
      );
      expectedRecoveryGeneration = 3;
    }

    recoveryDaemon = startDaemon();
    await expect(
      recoveryDaemon.waitForEvent("stdout", "ready"),
    ).resolves.toMatchObject({ workerId: RECOVERY_WORKER_ID });

    let terminalObserved: unknown = null;
    const recovered = await pollUntil(
      async () => {
        const state = await readGitExecutionState(client!);
        terminalObserved = state;
        return state?.attemptStatus === "succeeded" &&
          state.jobStatus === "succeeded" &&
          state.generation === expectedRecoveryGeneration &&
          typeof state.workspaceLifecycleJson === "string"
          ? {
              state,
              lifecycle: parseGitWorkspaceLifecycle(
                state.workspaceLifecycleJson,
              ),
            }
          : null;
      },
      PROCESS_TIMEOUT_MS,
      () => diagnostics("the cleanup recovery to complete", terminalObserved),
    );

    expect(recovered.state).toMatchObject({
      generation: expectedRecoveryGeneration,
      runtimeRunId: atBarrier.state.runtimeRunId,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      capacityUsed: 0,
      changeRequestId: atBarrier.lifecycle.changeRequestId,
      changeRequestStatus: "pending_review",
    });
    expect(recovered.lifecycle.finalized).toEqual(
      atBarrier.lifecycle.finalized,
    );
    expect(recovered.lifecycle.changeRequestId).toBe(
      atBarrier.lifecycle.changeRequestId,
    );
    expect(recovered.lifecycle.cleanedAt).toEqual(expect.any(String));
    expect(await readChangeRequestCount(client)).toBe(1);
    expect(await pathExists(recovered.lifecycle.prepared.worktreePath)).toBe(
      false,
    );
    const events = await readExecutionEvents(client);
    expect(events.filter((event) => event.type === "attempt-started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "attempt-completed")).toHaveLength(1);
    expect(
      await gitText(knowledgeRepository, [
        "rev-list",
        "--count",
        `${baseCommit}..refs/heads/${EXPECTED_ATTEMPT_BRANCH}`,
      ]),
    ).toBe("1");
  } finally {
    await stopObservedProcess(recoveryDaemon);
    await stopObservedProcess(crashedDaemon);
    await client?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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
    { DATABASE_URL: databaseUrl, NODE_ENV: "test" },
    PROCESS_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new Error(
      `Prisma migrations failed with code ${result.code}: ${result.stderr}`,
    );
  }
}

async function readGitExecutionState(
  client: Client,
): Promise<Record<string, unknown> | null> {
  const result = await client.execute({
    sql: `
      SELECT
        attempt."status" AS "attemptStatus",
        attempt."generation" AS "generation",
        attempt."leaseOwnerId" AS "leaseOwnerId",
        attempt."leaseExpiresAt" AS "leaseExpiresAt",
        attempt."runtimeRunId" AS "runtimeRunId",
        attempt."resultJson" AS "attemptResultJson",
        attempt."errorJson" AS "attemptErrorJson",
        attempt."finishedAt" AS "attemptFinishedAt",
        attempt."workspaceLifecycleJson" AS "workspaceLifecycleJson",
        job."status" AS "jobStatus",
        job."resultJson" AS "jobResultJson",
        job."errorJson" AS "jobErrorJson",
        job."revision" AS "jobRevision",
        job."cancelRequestedAt" AS "cancelRequestedAt",
        job."finishedAt" AS "jobFinishedAt",
        runtime."capacityUsed" AS "capacityUsed",
        change_request."id" AS "changeRequestId",
        change_request."status" AS "changeRequestStatus",
        change_request."baseCommit" AS "changeRequestBaseCommit",
        change_request."headCommit" AS "changeRequestHeadCommit",
        change_request."branchName" AS "changeRequestBranch",
        change_request."diffMetadataJson" AS "changeRequestDiffMetadataJson",
        change_request."revision" AS "changeRequestRevision"
      FROM "ExecutionAttempt" AS attempt
      JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
      JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
      LEFT JOIN "KnowledgeChangeRequest" AS change_request
        ON change_request."attemptId" = attempt."id"
      WHERE attempt."id" = ?
    `,
    args: [ATTEMPT_ID],
  });
  return result.rows[0] ? { ...result.rows[0] } : null;
}

async function readExecutionEvents(
  client: Client,
): Promise<Array<Record<string, unknown>>> {
  const result = await client.execute({
    sql: `
      SELECT "sequence", "type", "source", "runtimeEventId", "payloadJson"
      FROM "ExecutionEvent"
      WHERE "attemptId" = ?
      ORDER BY "sequence" ASC
    `,
    args: [ATTEMPT_ID],
  });
  return result.rows.map((row) => ({ ...row }));
}

async function readRoomProjectionState(
  client: Client,
): Promise<Record<string, unknown> | null> {
  const result = await client.execute({
    sql: `
      SELECT
        attempt."status" AS "attemptStatus",
        attempt."generation" AS "generation",
        attempt."leaseOwnerId" AS "leaseOwnerId",
        job."status" AS "jobStatus",
        job."revision" AS "jobRevision",
        runtime."capacityUsed" AS "capacityUsed",
        projection."id" AS "outboxId",
        projection."topic" AS "outboxTopic",
        projection."status" AS "outboxStatus",
        projection."attempts" AS "outboxAttempts",
        projection."payloadJson" AS "outboxPayloadJson",
        projection."roomEventId" AS "outboxRoomEventId",
        room_event."id" AS "roomEventId",
        room_event."type" AS "roomEventType",
        room_outbox."id" AS "roomOutboxId",
        room_outbox."dedupeKey" AS "roomOutboxDedupeKey",
        room."eventSequence" AS "roomEventSequence",
        (SELECT COUNT(*) FROM "ExecutionOutbox" WHERE "jobId" = job."id")
          AS "executionOutboxCount",
        (SELECT COUNT(*) FROM "RoomEvent" WHERE "roomId" = room."id")
          AS "roomEventCount",
        (SELECT COUNT(*) FROM "RoomOutbox" WHERE "roomId" = room."id")
          AS "roomOutboxCount"
      FROM "ExecutionAttempt" AS attempt
      JOIN "ExecutionJob" AS job ON job."id" = attempt."jobId"
      JOIN "ExecutionRuntime" AS runtime ON runtime."id" = attempt."runtimeId"
      JOIN "Room" AS room ON room."id" = job."originRoomId"
      LEFT JOIN "ExecutionOutbox" AS projection
        ON projection."jobId" = job."id"
        AND projection."topic" = 'execution.completed'
      LEFT JOIN "RoomEvent" AS room_event
        ON room_event."id" = projection."roomEventId"
      LEFT JOIN "RoomOutbox" AS room_outbox
        ON room_outbox."id" = 'room:' || projection."id"
      WHERE attempt."id" = ?
    `,
    args: [ATTEMPT_ID],
  });
  return result.rows[0] ? { ...result.rows[0] } : null;
}

async function readJsonFile(
  filePath: string,
): Promise<Record<string, unknown> | null> {
  try {
    return safeJsonParse<Record<string, unknown> | null>(
      await readFile(filePath, "utf8"),
      null,
      (value): value is Record<string, unknown> | null =>
        value === null || isRecord(value),
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function leaseExpired(value: unknown): boolean {
  if (typeof value !== "string" && !(value instanceof Date)) return false;
  const expiresAt = new Date(value).valueOf();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

async function stopObservedProcess(
  observed: ObservedProcess | null,
): Promise<void> {
  if (
    !observed ||
    observed.child.exitCode !== null ||
    observed.child.signalCode !== null
  ) {
    return;
  }
  observed.child.kill("SIGTERM");
  await observed.waitForExit(2_000).catch(async () => {
    observed.child.kill("SIGKILL");
    await observed.waitForExit(2_000).catch(() => undefined);
  });
}

async function killRuntimeFromMarker(markerPath: string): Promise<void> {
  if (await readJsonFile(`${markerPath}.late`)) return;
  const marker = await readJsonFile(markerPath);
  const pid = marker?.pid;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return;
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "ESRCH"
    ) {
      throw error;
    }
  }
}

function nativeResumePluginSource(input: {
  checkpointRef: string;
  markerPath: string;
  requestId: string;
  runtimeAttemptId: string;
  runtimeId: string;
  runtimeSecret: string;
}): string {
  const literal = JSON.stringify(input);
  return `
import { appendFileSync } from 'node:fs';
const expected = ${literal};
const record = (value) => appendFileSync(
  expected.markerPath,
  JSON.stringify({ ...value, pid: process.pid }) + String.fromCharCode(10),
  'utf8',
);
record({ type: 'module-loaded', moduleUrl: import.meta.url });
export function createRuntimePluginV1(context) {
  record({
    type: 'factory',
    contractVersion: context.contractVersion,
    runtimeId: context.runtimeId,
    environmentKeys: Object.keys(context.environment).sort(),
    frozen: Object.isFrozen(context) && Object.isFrozen(context.environment),
  });
  if (context.contractVersion !== 1 || context.runtimeId !== expected.runtimeId) {
    throw new Error('invalid plugin factory context');
  }
  if (context.environment.EXTERNAL_RUNTIME_TOKEN !== expected.runtimeSecret) {
    throw new Error('allowlisted runtime secret was not delivered');
  }
  if ('EXTERNAL_RUNTIME_BLOCKED_SECRET' in context.environment) {
    throw new Error('blocked environment value reached plugin');
  }
  return {
    async describe() {
      return {
        schemaVersion: 1,
        runtimeId: expected.runtimeId,
        displayName: 'External native-resume fixture',
        runtimeVersion: 'plugin-v1',
        capabilities: {
          schemaVersion: 1, kinds: ['coding'], nativeResume: true,
          checkpoint: true, streaming: 'typed-events', interrupt: 'graceful',
          workspace: 'none', sandbox: 'host', structuredArtifacts: false,
          waitingForHuman: true, supportedModels: [],
        },
      };
    },
    async *start(startInput) {
      record({ type: 'start', input: startInput });
      yield { type: 'attempt-started', runtimeAttemptId: expected.runtimeAttemptId };
      yield { type: 'checkpoint', checkpointRef: expected.checkpointRef };
      yield {
        type: 'waiting-for-human',
        requestId: expected.requestId,
        prompt: 'Approve native resume?',
      };
      throw new Error('waiting iterator should have been closed');
    },
    async *resume(resumeInput) {
      record({ type: 'resume', input: resumeInput });
      if (resumeInput.runtimeAttemptId !== expected.runtimeAttemptId ||
          resumeInput.checkpointRef !== expected.checkpointRef ||
          resumeInput.humanInput?.requestId !== expected.requestId) {
        throw new Error('native resume identity mismatch');
      }
      yield { type: 'text-delta', text: 'native-resume:' + resumeInput.humanInput.responseId };
      yield { type: 'attempt-completed', status: 'succeeded' };
    },
    async interrupt(interruptInput) { record({ type: 'interrupt', input: interruptInput }); },
    async reconcile(reconcileInput) {
      return { runtimeAttemptId: reconcileInput.runtimeAttemptId, status: 'unknown' };
    },
    async archive() { return []; },
  };
}
`;
}

async function readJsonLines(
  filePath: string,
): Promise<Array<Record<string, unknown>>> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf8");
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
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parsed = safeJsonParse<unknown>(line, null);
      if (!isRecord(parsed)) throw new Error("Invalid plugin marker record.");
      return parsed;
    });
}

async function answerExecutionInputForProcessTest(
  client: Client,
  input: {
    expectedInputRevision: number;
    expectedJobRevision: number;
    requestId: string;
    responseId: string;
    response: unknown;
  },
) {
  const now = new Date().toISOString();
  const responseJson = JSON.stringify(input.response);
  await client.batch(
    [
      {
        sql: `
          UPDATE "ExecutionInputRequest"
          SET "responseJson" = ?, "responseId" = ?, "status" = 'answered',
              "respondedAt" = ?, "respondedById" = 'process-e2e-user',
              "revision" = "revision" + 1, "updatedAt" = ?
          WHERE "id" = ? AND "organizationId" = ? AND "jobId" = ?
            AND "status" = 'pending' AND "revision" = ?
        `,
        args: [
          responseJson,
          input.responseId,
          now,
          now,
          input.requestId,
          ORGANIZATION_ID,
          JOB_ID,
          input.expectedInputRevision,
        ],
      },
      {
        sql: `
          UPDATE "ExecutionAttempt"
          SET "status" = 'pending', "leaseOwnerId" = NULL,
              "leaseExpiresAt" = NULL, "updatedAt" = ?
          WHERE "id" = ? AND "organizationId" = ? AND "jobId" = ?
            AND "status" = 'waiting_input' AND "generation" = 2
        `,
        args: [now, ATTEMPT_ID, ORGANIZATION_ID, JOB_ID],
      },
      {
        sql: `
          UPDATE "ExecutionJob"
          SET "status" = 'queued', "queuedAt" = ?,
              "revision" = "revision" + 1, "updatedAt" = ?
          WHERE "id" = ? AND "organizationId" = ?
            AND "status" = 'waiting_input' AND "revision" = ?
        `,
        args: [
          now,
          now,
          JOB_ID,
          ORGANIZATION_ID,
          input.expectedJobRevision,
        ],
      },
    ],
    "write",
  );

  const result = await client.execute({
    sql: `
      SELECT request."status" AS "requestStatus",
             request."revision" AS "requestRevision",
             request."responseId" AS "responseId",
             request."responseJson" AS "responseJson",
             attempt."status" AS "attemptStatus",
             attempt."generation" AS "generation",
             job."status" AS "jobStatus",
             job."revision" AS "jobRevision"
      FROM "ExecutionInputRequest" AS request
      JOIN "ExecutionAttempt" AS attempt ON attempt."id" = request."attemptId"
      JOIN "ExecutionJob" AS job ON job."id" = request."jobId"
      WHERE request."id" = ?
    `,
    args: [input.requestId],
  });
  const row = result.rows[0];
  if (
    row?.requestStatus !== "answered" ||
    row?.attemptStatus !== "pending" ||
    row?.jobStatus !== "queued"
  ) {
    throw new Error("Input answer transaction did not requeue the attempt.");
  }
  return row;
}

async function seedExecution(
  client: Client,
  options: {
    knowledge?: { repositoryPath: string; baseCommit: string };
  } = {},
): Promise<void> {
  await client.execute("PRAGMA journal_mode = WAL");
  await client.execute("PRAGMA busy_timeout = 5000");
  await client.execute("PRAGMA foreign_keys = ON");

  const now = new Date().toISOString();
  const workspaceContent = "Frozen process integration context.";
  const workspaceCapability = options.knowledge ? "git-worktree" : "none";
  const runtimeVersion = options.knowledge
    ? "process-git-fixture-v1"
    : "process-fixture-v1";
  const requirements = options.knowledge
    ? { workspace: "git-worktree" }
    : {};
  const frozenKnowledgeBinding = options.knowledge
    ? {
        schemaVersion: 1,
        bindingId: KNOWLEDGE_BINDING_ID,
        spaceId: KNOWLEDGE_SPACE_ID,
        workspaceId: WORKSPACE_ID,
        agentId: null,
        mountPath: "/",
        defaultBranch: DEFAULT_BRANCH,
        baseCommit: options.knowledge.baseCommit,
      }
    : null;
  const capabilities = {
    schemaVersion: 1,
    kinds: ["coding"],
    nativeResume: false,
    checkpoint: false,
    streaming: "text",
    interrupt: "process-kill",
    workspace: workspaceCapability,
    sandbox: "host",
    structuredArtifacts: false,
    waitingForHuman: false,
    supportedModels: [],
  };
  const health = {
    state: "healthy",
    acceptingNewAttempts: true,
    observedAt: now,
  };
  const candidate = {
    descriptor: {
      schemaVersion: 1,
      runtimeId: RUNTIME_ID,
      displayName: "Generic CLI",
      runtimeVersion,
      capabilities,
    },
    health,
    capacity: {
      availableSlots: 1,
      activeAttempts: 0,
      maxConcurrentAttempts: 1,
    },
  };
  const spec = {
    schemaVersion: 1,
    goal: GOAL,
    kind: "coding",
    requirements,
  };
  const contextManifest = {
    schemaVersion: 1,
    goal: GOAL,
    frozenAt: now,
    source: {
      type: "workspace-draft",
      workspaceId: WORKSPACE_ID,
      conversationId: CONVERSATION_ID,
      documentVersionId: null,
    },
    workspace: {
      id: WORKSPACE_ID,
      projectId: WORKSPACE_ID,
      title: "Process integration workspace",
      draftRevision: 1,
      revision: 1,
    },
    document: {
      id: WORKSPACE_ID,
      title: "Process integration workspace",
      versionId: null,
      revision: 1,
      content: workspaceContent,
      contentSha256: sha256(workspaceContent),
    },
    files: [],
    roomWatermark: null,
    knowledgeCommit: frozenKnowledgeBinding,
  };
  const selection = {
    schemaVersion: 1,
    matched: true,
    selected: candidate,
    selectedBy: "explicit-request",
    evaluations: [
      {
        candidate,
        eligible: true,
        preferenceRank: null,
        rejectionReasons: [],
      },
    ],
  };

  await client.batch(
    [
      {
        sql: `
          INSERT INTO "Organization"
            ("id", "slug", "name", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [ORGANIZATION_ID, "process-e2e-org", "Process E2E Org", now, now],
      },
      {
        sql: `
          INSERT INTO "Session"
            ("id", "organizationId", "title", "projectId", "createdAt", "updatedAt")
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [
          CONVERSATION_ID,
          ORGANIZATION_ID,
          "Process integration conversation",
          WORKSPACE_ID,
          now,
          now,
        ],
      },
      {
        sql: `
          INSERT INTO "Document" (
            "id", "organizationId", "sessionId", "title", "content",
            "projectId", "status", "draftRevision", "revision",
            "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, 1, ?, ?)
        `,
        args: [
          WORKSPACE_ID,
          ORGANIZATION_ID,
          CONVERSATION_ID,
          "Process integration workspace",
          workspaceContent,
          WORKSPACE_ID,
          now,
          now,
        ],
      },
      ...(options.knowledge
        ? [
            {
              sql: `
                INSERT INTO "KnowledgeSpace" (
                  "id", "organizationId", "scope", "ownerAgentId",
                  "repoPath", "repoUrl", "defaultBranch",
                  "credentialRef", "readPolicy", "writePolicy",
                  "createdAt", "updatedAt"
                ) VALUES (?, ?, 'team', NULL, ?, NULL, ?, ?, 'team',
                          'review-only', ?, ?)
              `,
              args: [
                KNOWLEDGE_SPACE_ID,
                ORGANIZATION_ID,
                options.knowledge.repositoryPath,
                DEFAULT_BRANCH,
                KNOWLEDGE_CREDENTIAL_REF,
                now,
                now,
              ],
            },
            {
              sql: `
                INSERT INTO "KnowledgeBinding" (
                  "id", "organizationId", "workspaceId", "agentId",
                  "spaceId", "mountPath", "access",
                  "createdAt", "updatedAt"
                ) VALUES (?, ?, ?, NULL, ?, '/', 'propose', ?, ?)
              `,
              args: [
                KNOWLEDGE_BINDING_ID,
                ORGANIZATION_ID,
                WORKSPACE_ID,
                KNOWLEDGE_SPACE_ID,
                now,
                now,
              ],
            },
          ]
        : []),
      {
        sql: `
          INSERT INTO "ExecutionRuntime" (
            "id", "organizationId", "key", "name", "driver",
            "version", "enabled", "registrationJson", "capabilitiesJson",
            "healthStatus", "healthJson", "lastHeartbeatAt",
            "capacityTotal", "capacityUsed", "capacityJson",
            "capacityUpdatedAt", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, 'Generic CLI', 'generic-cli', ?, TRUE, ?, ?,
                    'healthy', ?, ?, 1, 0, '{}', ?, ?, ?)
        `,
        args: [
          RUNTIME_ID,
          ORGANIZATION_ID,
          RUNTIME_ID,
          runtimeVersion,
          JSON.stringify({ workerId: "seed" }),
          JSON.stringify(capabilities),
          JSON.stringify(health),
          now,
          now,
          now,
          now,
        ],
      },
      {
        sql: `
          INSERT INTO "ExecutionJob" (
            "id", "organizationId", "kind", "status", "priority",
            "specJson", "requirementsJson", "contextManifestJson",
            "selectionJson", "requestedRuntimeId", "selectedRuntimeId",
            "selectionReason", "selectedAt", "maxAttempts", "queuedAt",
            "revision", "createdAt", "updatedAt"
          ) VALUES (?, ?, 'coding', 'queued', 100, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)
        `,
        args: [
          JOB_ID,
          ORGANIZATION_ID,
          JSON.stringify(spec),
          JSON.stringify(requirements),
          JSON.stringify(contextManifest),
          JSON.stringify(selection),
          RUNTIME_ID,
          RUNTIME_ID,
          "process-integration-seed",
          now,
          now,
          now,
          now,
        ],
      },
      {
        sql: `
          INSERT INTO "ExecutionAttempt" (
            "id", "organizationId", "jobId", "runtimeId", "number",
            "status", "generation", "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, 1, 'pending', 0, ?, ?)
        `,
        args: [ATTEMPT_ID, ORGANIZATION_ID, JOB_ID, RUNTIME_ID, now, now],
      },
    ],
    "write",
  );

  const migration = await client.execute({
    sql: `
      SELECT "finished_at"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ?
    `,
    args: ["20260821020000_add_execution_engine"],
  });
  expect(migration.rows[0]?.finished_at).not.toBeNull();
}

async function seedExecutionRoomOrigin(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.batch(
    [
      {
        sql: `
          INSERT INTO "Room" (
            "id", "organizationId", "key", "name", "hostAgentId",
            "policyJson", "messageSequence", "eventSequence",
            "createdAt", "updatedAt"
          ) VALUES (?, ?, ?, ?, ?, '{}', 1, 0, ?, ?)
        `,
        args: [
          ROOM_ID,
          ORGANIZATION_ID,
          "process-e2e-room",
          "Process integration Room",
          "process-e2e-host-agent",
          now,
          now,
        ],
      },
      {
        sql: `
          INSERT INTO "RoomMessage" (
            "id", "organizationId", "roomId", "sequence",
            "actorType", "actorId", "text", "attachmentsJson",
            "createdAt"
          ) VALUES (?, ?, ?, 1, 'user', 'process-e2e-user', ?, '[]', ?)
        `,
        args: [
          ROOM_MESSAGE_ID,
          ORGANIZATION_ID,
          ROOM_ID,
          "Run the process integration execution.",
          now,
        ],
      },
      {
        sql: `
          UPDATE "ExecutionJob"
          SET "originRoomId" = ?, "originRoomMessageId" = ?, "updatedAt" = ?
          WHERE "id" = ? AND "organizationId" = ?
        `,
        args: [ROOM_ID, ROOM_MESSAGE_ID, now, JOB_ID, ORGANIZATION_ID],
      },
    ],
    "write",
  );
}

async function initializeGitRepository(repositoryPath: string): Promise<string> {
  await mkdir(repositoryPath, { recursive: true });
  await gitText(repositoryPath, ["init"]);
  await gitText(repositoryPath, [
    "symbolic-ref",
    "HEAD",
    `refs/heads/${DEFAULT_BRANCH}`,
  ]);
  await writeFile(
    path.join(repositoryPath, "README.md"),
    "# Process integration knowledge\n",
  );
  await gitText(repositoryPath, ["add", "--all"]);
  await gitText(repositoryPath, [
    "-c",
    "user.name=Execution Daemon Seed",
    "-c",
    "user.email=execution-daemon-seed@example.test",
    "commit",
    "-m",
    "Seed knowledge repository",
  ]);
  return gitText(repositoryPath, ["rev-parse", "HEAD"]);
}

async function gitText(
  repositoryPath: string,
  args: readonly string[],
): Promise<string> {
  const result = await runCommand(
    "git",
    ["-c", `core.hooksPath=${devNull}`, "-C", repositoryPath, ...args],
    repositoryPath,
    {
      PATH: process.env.PATH,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: "test",
      LC_ALL: "C",
      LANG: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: devNull,
      GIT_TERMINAL_PROMPT: "0",
    },
    PROCESS_TIMEOUT_MS,
  );
  if (result.code !== 0) {
    throw new Error(
      `Git command failed with code ${result.code}: ${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function parseGitWorkspaceLifecycle(raw: string): GitWorkspaceLifecycle {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("prepared" in parsed) ||
    !("runtimeCompletion" in parsed) ||
    !("finalized" in parsed) ||
    !("changeRequestId" in parsed) ||
    !("cleanedAt" in parsed)
  ) {
    throw new Error("Stored Git workspace lifecycle is incomplete.");
  }
  return parsed as GitWorkspaceLifecycle;
}

function parseChangedGitWorkspaceLifecycle(
  raw: string,
  expectCleaned: boolean,
): Omit<GitWorkspaceLifecycle, "cleanedAt"> & { cleanedAt?: string } {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !("prepared" in parsed) ||
    !("runtimeCompletion" in parsed) ||
    !("finalized" in parsed) ||
    !("changeRequestId" in parsed) ||
    (expectCleaned !== ("cleanedAt" in parsed))
  ) {
    throw new Error("Stored Git workspace lifecycle is not at the expected cleanup stage.");
  }
  return parsed as Omit<GitWorkspaceLifecycle, "cleanedAt"> & {
    cleanedAt?: string;
  };
}

function parsePreparedGitWorkspaceLifecycle(
  raw: string,
): PreparedGitWorkspaceLifecycle {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !==
      "binding,kind,prepared,schemaVersion"
  ) {
    throw new Error("Stored Git workspace lifecycle is not prepared-only.");
  }
  return parsed as PreparedGitWorkspaceLifecycle;
}

function parseCancelledGitWorkspaceLifecycle(
  raw: string,
): CancelledGitWorkspaceLifecycle {
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !==
      "binding,cleanedAt,kind,prepared,runtimeCompletion,schemaVersion"
  ) {
    throw new Error("Stored Git workspace lifecycle is not cancelled.");
  }
  return parsed as CancelledGitWorkspaceLifecycle;
}

async function readChangeRequestCount(client: Client): Promise<number> {
  const result = await client.execute({
    sql: `
      SELECT COUNT(*) AS "count"
      FROM "KnowledgeChangeRequest"
      WHERE "attemptId" = ?
    `,
    args: [ATTEMPT_ID],
  });
  return Number(result.rows[0]?.count);
}

/**
 * Mirrors the public control-plane command's optimistic running ->
 * cancel_requested transaction. Keeping this in one SQLite transaction makes
 * the process test exercise the same durable boundary without importing the
 * app's generated Prisma client into Playwright's CommonJS test runtime.
 */
async function requestExecutionJobCancellation(
  client: Client,
  expectedRevision: number,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const transaction = await client.transaction("write");
  try {
    const updated = await transaction.execute({
      sql: `
        UPDATE "ExecutionJob"
        SET
          "status" = 'cancel_requested',
          "cancelRequestedAt" = ?,
          "finishedAt" = NULL,
          "revision" = "revision" + 1,
          "updatedAt" = ?
        WHERE "id" = ?
          AND "organizationId" = ?
          AND "revision" = ?
          AND "status" = 'running'
      `,
      args: [
        now,
        now,
        JOB_ID,
        ORGANIZATION_ID,
        expectedRevision,
      ],
    });
    if (updated.rowsAffected !== 1) {
      throw new Error(
        "Execution job changed while cancellation was requested.",
      );
    }
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback();
    throw error;
  } finally {
    if (!transaction.closed) transaction.close();
  }

  const state = await readGitExecutionState(client);
  if (!state) throw new Error("Cancelled execution state was not found.");
  return state;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSqliteBusy(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "SQLITE_BUSY" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("SQLITE_BUSY"))
  );
}

function observeProcess(
  child: ChildProcessWithoutNullStreams,
): ObservedProcess {
  const raw = { stdout: "", stderr: "" };
  const parsed: Record<"stdout" | "stderr", ProcessEvent[]> = {
    stdout: [],
    stderr: [],
  };
  const remainders = { stdout: "", stderr: "" };

  for (const target of ["stdout", "stderr"] as const) {
    child[target].setEncoding("utf8");
    child[target].on("data", (chunk: string) => {
      raw[target] += chunk;
      remainders[target] += chunk;
      let newline = remainders[target].indexOf("\n");
      while (newline !== -1) {
        const line = remainders[target].slice(0, newline).trim();
        remainders[target] = remainders[target].slice(newline + 1);
        if (line) {
          try {
            parsed[target].push(JSON.parse(line) as ProcessEvent);
          } catch {
            parsed[target].push({ type: "unstructured-output", line });
          }
        }
        newline = remainders[target].indexOf("\n");
      }
    });
  }

  return {
    child,
    events: (target) => parsed[target],
    stdout: () => raw.stdout,
    stderr: () => raw.stderr,
    waitForEvent: (target, type, timeoutMs = PROCESS_TIMEOUT_MS) =>
      pollUntil(
        () => {
          const event = parsed[target].find(
            (candidate) => candidate.type === type,
          );
          if (event) return event;
          if (child.exitCode !== null) {
            throw new Error(
              `Daemon exited with ${child.exitCode} before emitting ${type}: ${raw.stderr}`,
            );
          }
          return null;
        },
        timeoutMs,
        `the daemon to emit ${type}`,
      ),
    waitForExit: (timeoutMs = PROCESS_TIMEOUT_MS) =>
      waitForExit(child, timeoutMs),
  };
}

type ObservedProcess = {
  child: ChildProcessWithoutNullStreams;
  events(target: "stdout" | "stderr"): ProcessEvent[];
  stdout(): string;
  stderr(): string;
  waitForEvent(
    target: "stdout" | "stderr",
    type: string,
    timeoutMs?: number,
  ): Promise<ProcessEvent>;
  waitForExit(
    timeoutMs?: number,
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting ${timeoutMs}ms for child exit.`));
    }, timeoutMs);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
    };
    child.once("error", onError);
    child.once("close", onClose);
  });
}

function runCommand(
  executable: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Command timed out after ${timeoutMs}ms.`));
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
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function pollUntil<T>(
  read: () => T | null | Promise<T | null>,
  timeoutMs: number,
  description: string | (() => string),
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      if (!isTransientSqliteBusy(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const detail =
    typeof description === "function" ? description() : description;
  throw new Error(`Timed out waiting ${timeoutMs}ms for ${detail}.`);
}

function isTransientSqliteBusy(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "SQLITE_BUSY") ||
      error.message.includes("SQLITE_BUSY"))
  );
}

function redactProcessOutput(
  output: string,
  secrets: readonly string[],
): string {
  return secrets
    .filter(Boolean)
    .reduce(
      (redacted, secret) => redacted.split(secret).join("<redacted>"),
      output,
    )
    .trim();
}
