import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { LOCAL_PLATFORM_HEADERS } from "./helpers";

const PROCESS_TIMEOUT_MS = 15_000;

type JsonRecord = Record<string, unknown>;
type ProcessEvent = { type?: string; [key: string]: unknown };
type ObservedProcess = {
  child: ChildProcessWithoutNullStreams;
  waitForEvent(
    target: "stdout" | "stderr",
    type: string,
    timeoutMs?: number,
  ): Promise<ProcessEvent>;
};

test("HTTP running cancel is consumed by the standalone daemon", async ({}, testInfo) => {
  test.setTimeout(45_000);
  const repositoryRoot = process.cwd();
  const base = String(testInfo.project.use.baseURL);
  const suffix = randomUUID();
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
    "cancel-runtime.mjs",
  );
  await access(daemonEntry, fsConstants.R_OK).catch(() => {
    throw new Error(
      "Standalone daemon artifact is missing; run npm run execution:daemon:build before this test.",
    );
  });

  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "dao-http-daemon-cancel-"),
  );
  const runtimeCwd = path.join(temporaryRoot, "runtime");
  const configPath = path.join(temporaryRoot, "execution-daemon.json");
  const markerPath = path.join(temporaryRoot, "runtime.marker.json");
  const runtimeId = `e2e-http-daemon-${suffix}`;
  const workerId = `e2e-http-worker-${suffix}`;
  let daemon: ObservedProcess | null = null;

  try {
    const projectsRoot = path.join(temporaryRoot, "projects");
    await Promise.all([
      mkdir(runtimeCwd, { recursive: true }),
      mkdir(projectsRoot, { recursive: true }),
    ]);
    const workspaceCreate = await requestJson(base, "/api/workspaces", {
      body: {
        content: JSON.stringify([
          { type: "h1", children: [{ text: "Execution daemon HTTP" }] },
        ]),
        deliverableType: "document",
        goal: "Exercise HTTP cancellation with the standalone daemon.",
        projectParentPath: projectsRoot,
        title: `Execution daemon HTTP ${suffix}`,
      },
      method: "POST",
    });
    expect(workspaceCreate.response.status).toBe(200);
    const workspacePayload = record(workspaceCreate.payload);
    const workspace = record(workspacePayload.workspace);
    const conversation = record(workspacePayload.conversation);
    expect(workspace.id).toEqual(expect.any(String));
    expect(conversation.id).toEqual(expect.any(String));
    const versionCreate = await requestJson(
      base,
      `/api/workspaces/${encodeURIComponent(String(workspace.id))}/versions`,
      { body: { title: `Execution daemon HTTP ${suffix}` }, method: "POST" },
    );
    expect(versionCreate.response.status).toBe(200);
    const version = record(versionCreate.payload);
    const alignment = await requestJson(
      base,
      `/api/workspaces/${encodeURIComponent(String(workspace.id))}/alignment`,
      { body: { versionId: version.id }, method: "POST" },
    );
    expect(alignment.response.status).toBe(200);

    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        organizationId: "local-org",
        workerId,
        pollIntervalMs: 25,
        heartbeatIntervalMs: 500,
        leaseDurationMs: 3_000,
        shutdownGraceMs: 1_000,
        runtimes: [
          {
            driver: "generic-cli",
            runtimeId,
            runtimeVersion: "http-cancel-fixture-v1",
            executable: process.execPath,
            args: [runtimeFixture, "--marker", markerPath],
            cwd: runtimeCwd,
            envAllowlist: [],
            capacityTotal: 1,
            timeoutMs: 20_000,
            interruptGracePeriodMs: 500,
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
          DATABASE_URL: resolveIterationDatabaseUrl(),
          DAO_APP_DATA_ROOT: resolveIterationAppDataRoot(),
          DAO_EXECUTION_DAEMON_CONFIG_PATH: configPath,
          NODE_ENV: "test",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    await expect(daemon.waitForEvent("stdout", "ready")).resolves.toMatchObject({
      organizationId: "local-org",
      runtimeIds: [runtimeId],
      workerId,
    });

    const create = await poll(
      async () => {
        const result = await requestJson(base, "/api/execution-jobs", {
          body: {
            goal: `HTTP cancel standalone execution ${suffix}`,
            documentVersionId: version.id,
            workspaceId: workspace.id,
            projectId: workspace.id,
            conversationId: conversation.id,
            kind: "coding",
            requirements: {},
            runtimeSelection: { mode: "explicit", runtimeId },
          },
          headers: { "x-dao-idempotency-key": `e2e-http-cancel-${suffix}` },
          method: "POST",
        });
        return result.response.status === 500 &&
          (isBusyResponse(result.payload) || result.response.statusText === "Internal Server Error")
          ? null
          : result;
      },
      PROCESS_TIMEOUT_MS,
      "HTTP execution job creation after transient SQLite contention",
    );
    expect(create.response.status).toBe(202);
    const receipt = record(record(create.payload).receipt);
    if (receipt.status !== "queued") {
      throw new Error(
        `HTTP daemon fixture was not selectable: ${JSON.stringify(create.payload)}`,
      );
    }
    expect(receipt).toMatchObject({
      revision: 1,
      selectedRuntimeId: runtimeId,
      status: "queued",
    });
    const jobId = String(receipt.jobId);

    const runningJob = await pollHttpJob(base, jobId, (job) =>
      job.status === "running" &&
      list(job.attempts).some((attempt) => record(attempt).status === "running")
        ? job
        : null,
    );
    const marker = await pollJsonFile(markerPath);
    expect(marker).toMatchObject({
      attemptId: record(list(runningJob.attempts)[0]).id,
      generation: 1,
      pid: expect.any(Number),
    });

    const cancel = await poll(
      async () => {
        const result = await requestJson(
          base,
          `/api/execution-jobs/${encodeURIComponent(jobId)}/cancel`,
          {
            body: { expectedRevision: runningJob.revision },
            method: "POST",
          },
        );
        return result.response.status === 500 &&
          (isBusyResponse(result.payload) ||
            result.response.statusText === "Internal Server Error")
          ? null
          : result;
      },
      PROCESS_TIMEOUT_MS,
      "HTTP cancellation after transient SQLite contention",
    );
    expect(cancel.response.status).toBe(200);
    const requested = record(record(cancel.payload).job);
    expect(requested).toMatchObject({
      id: jobId,
      status: "cancel_requested",
      revision: Number(runningJob.revision) + 1,
      cancelRequestedAt: expect.any(String),
      finishedAt: null,
    });

    const terminal = await pollHttpJob(base, jobId, (job) =>
      job.status === "cancelled" ? job : null,
    );
    expect(terminal).toMatchObject({
      id: jobId,
      status: "cancelled",
      revision: Number(requested.revision) + 1,
      cancelRequestedAt: requested.cancelRequestedAt,
      finishedAt: expect.any(String),
    });
    expect(record(list(terminal.attempts)[0])).toMatchObject({
      status: "cancelled",
      generation: 1,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      finishedAt: expect.any(String),
    });
    await expect(pollJsonFile(`${markerPath}.interrupted`)).resolves.toMatchObject({
      attemptId: marker.attemptId,
      generation: 1,
      pid: marker.pid,
      signal: "SIGTERM",
    });
  } finally {
    await stopProcess(daemon);
    await killProcessFromMarker(markerPath);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function observeProcess(child: ChildProcessWithoutNullStreams): ObservedProcess {
  const events: Record<"stdout" | "stderr", ProcessEvent[]> = {
    stdout: [],
    stderr: [],
  };
  const output = { stdout: "", stderr: "" };
  const remainders = { stdout: "", stderr: "" };
  for (const target of ["stdout", "stderr"] as const) {
    child[target].setEncoding("utf8");
    child[target].on("data", (chunk: string) => {
      output[target] += chunk;
      remainders[target] += chunk;
      let newline = remainders[target].indexOf("\n");
      while (newline !== -1) {
        const line = remainders[target].slice(0, newline).trim();
        remainders[target] = remainders[target].slice(newline + 1);
        if (line) {
          try {
            const parsed: unknown = JSON.parse(line);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              events[target].push(parsed as ProcessEvent);
            }
          } catch {
            // Non-JSON runtime output remains available in diagnostics.
          }
        }
        newline = remainders[target].indexOf("\n");
      }
    });
  }
  return {
    child,
    waitForEvent: (target, type, timeoutMs = PROCESS_TIMEOUT_MS) =>
      poll(
        () => {
          const event = events[target].find((candidate) => candidate.type === type);
          if (event) return event;
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error(
              `Daemon exited before ${type}: stdout=${output.stdout}; stderr=${output.stderr}`,
            );
          }
          return null;
        },
        timeoutMs,
        `daemon event ${type}; stdout=${output.stdout}; stderr=${output.stderr}`,
      ),
  };
}

async function requestJson(
  base: string,
  pathname: string,
  init?: {
    body?: unknown;
    headers?: Record<string, string>;
    method?: "GET" | "POST";
  },
) {
  const response = await fetch(new URL(pathname, base), {
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { ...LOCAL_PLATFORM_HEADERS, ...init?.headers },
    method: init?.method ?? "GET",
  });
  const text = await response.text();
  return { response, payload: text ? JSON.parse(text) : null };
}

function pollHttpJob(
  base: string,
  jobId: string,
  accept: (job: JsonRecord) => JsonRecord | null,
): Promise<JsonRecord> {
  return poll(
    async () => {
      const result = await requestJson(
        base,
        `/api/execution-jobs/${encodeURIComponent(jobId)}`,
      );
      return result.response.status === 200
        ? accept(record(record(result.payload).job))
        : null;
    },
    PROCESS_TIMEOUT_MS,
    `HTTP execution job ${jobId} to reach the expected state`,
  );
}

function pollJsonFile(filePath: string): Promise<JsonRecord> {
  return poll(
    async () => {
      try {
        return record(JSON.parse(await readFile(filePath, "utf8")));
      } catch (error) {
        if (isNodeError(error, "ENOENT")) return null;
        throw error;
      }
    },
    PROCESS_TIMEOUT_MS,
    `JSON marker ${filePath}`,
  );
}

async function poll<T>(
  read: () => T | null | Promise<T | null>,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== null) return value;
    } catch (error) {
      if (!isSqliteBusyError(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting ${timeoutMs}ms for ${description}.`);
}

async function stopProcess(processHandle: ObservedProcess | null): Promise<void> {
  if (
    !processHandle ||
    processHandle.child.exitCode !== null ||
    processHandle.child.signalCode !== null
  ) {
    return;
  }
  processHandle.child.kill("SIGTERM");
  await waitForExit(processHandle.child, 2_000).catch(async () => {
    processHandle.child.kill("SIGKILL");
    await waitForExit(processHandle.child, 2_000).catch(() => undefined);
  });
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.removeListener("close", onClose);
      reject(new Error(`Timed out waiting ${timeoutMs}ms for child exit.`));
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.once("close", onClose);
  });
}

async function killProcessFromMarker(markerPath: string): Promise<void> {
  let marker: JsonRecord;
  try {
    marker = record(JSON.parse(await readFile(markerPath, "utf8")));
  } catch {
    return;
  }
  const pid = marker.pid;
  if (!Number.isSafeInteger(pid) || Number(pid) <= 0) return;
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch (error) {
    if (!isNodeError(error, "ESRCH")) throw error;
  }
}

function resolveIterationAppDataRoot(): string {
  if (process.env.DAO_APP_DATA_ROOT?.trim()) {
    return process.env.DAO_APP_DATA_ROOT.trim();
  }
  return path.join(resolveIterationRoot(), "app-data");
}

function resolveIterationDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  return `file:${path.join(resolveIterationAppDataRoot(), "dev.db")}`;
}

function resolveIterationRoot(): string {
  return (
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), ".tmp", "iteration-regression")
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === code,
  );
}

function isSqliteBusyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "SQLITE_BUSY") ||
      error.message.includes("SQLITE_BUSY"))
  );
}

function isBusyResponse(payload: unknown): boolean {
  const body = record(payload);
  return typeof body.error === "string" && body.error.includes("SQLITE_BUSY");
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
