import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createClient, type Client } from "@libsql/client";
import { expect, test, type TestInfo } from "@playwright/test";
import { readKnowledgeIndexArtifactV1 } from "@/agent/knowledge/index-builder";
import { LOCAL_PLATFORM_HEADERS, readSeedState } from "./helpers";

const run = promisify(execFile);
const ORGANIZATION_ID = "local-org";
const WORKSPACE_TITLE = "迭代回归-主交付物";
const WORKER_TIMEOUT_MS = 30_000;
const PROCESS_TIMEOUT_MS = 30_000;

test("real Knowledge UI configures access, reviews, merges, and activates an exact Git diff", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const suffix = randomUUID();
  const fixtureParent = path.join(resolveIterationRoot(), "knowledge-fixtures");
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(fixtureParent, "review-"));
  const repositoryPath = path.join(fixtureRoot, "repository");
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  const notice = page
    .locator('[role="status"]')
    .filter({ has: page.getByRole("button", { name: "Dismiss notification" }) });
  let spaceId: string | null = null;
  let bindingId: string | null = null;
  let changeRequestId: string | null = null;

  try {
    await database.execute("PRAGMA busy_timeout = 5000");
    const proposal = await createGitProposal(repositoryPath, suffix);

    await page.goto("/knowledge");
    await expect(page.getByRole("heading", { name: "Review once, then follow the same proposal to activation." })).toBeVisible();
    await expect(page).toHaveURL(/\/knowledge\?view=reviews(?:&change=[^&]+)?$/);
    await expect(page.getByRole("navigation", { name: "Knowledge views" })).toBeVisible();

    await page.getByTestId("knowledge-configuration-tab").click();
    await expect(page).toHaveURL(/\/knowledge\?view=configuration$/);
    await page.getByTestId("knowledge-repo-path").fill(repositoryPath);
    await page.getByTestId("knowledge-default-branch").fill("main");
    await page.getByTestId("knowledge-add-space").click();
    await expect(notice).toContainText(
      "Knowledge repository added and verified.",
    );
    await expect(page.getByTestId("knowledge-space-list")).toContainText(
      repositoryPath,
    );
    await expect(page.getByTestId("knowledge-repo-path")).toHaveValue("");

    spaceId = await readId(database, "KnowledgeSpace", "repoPath", repositoryPath);

    const workspaceTrigger = page.getByRole("combobox", {
      exact: true,
      name: "Deliverable",
    });
    await expect(workspaceTrigger).toBeEnabled();
    await workspaceTrigger.click();
    const workspaceListbox = page.getByRole("listbox");
    await expect(workspaceListbox).toBeVisible();
    const workspaceOption = workspaceListbox.getByRole("option", {
      exact: true,
      name: WORKSPACE_TITLE,
    });
    await expect(workspaceOption).toHaveCount(1);
    await workspaceOption.click();
    await expect(workspaceTrigger).toContainText(WORKSPACE_TITLE);

    const repositoryTrigger = page.getByRole("combobox", {
      exact: true,
      name: "Repository",
    });
    await expect(repositoryTrigger).toBeEnabled();
    await repositoryTrigger.click();
    const repositoryListbox = page.getByRole("listbox");
    await expect(repositoryListbox).toBeVisible();
    const repositoryOption = repositoryListbox.getByRole("option", {
      exact: true,
      name: "Team knowledge · main",
    });
    await expect(repositoryOption).toHaveCount(1);
    await repositoryOption.click();
    await expect(repositoryTrigger).toContainText("Team knowledge · main");

    const addBinding = page.getByRole("button", {
      exact: true,
      name: "Add workspace binding",
    });
    await expect(addBinding).toBeEnabled();
    const bindingResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/knowledge/bindings",
    );
    await addBinding.click();
    const bindingResponse = await bindingResponsePromise;
    expect(bindingResponse.status()).toBe(201);
    const bindingPayload = record(await bindingResponse.json());
    const createdBinding = record(bindingPayload.binding);
    bindingId = String(createdBinding.id || "");
    expect(createdBinding).toMatchObject({
      access: "propose",
      agentId: null,
      mountPath: "/",
      spaceId,
    });
    expect(bindingId).not.toBe("");
    await expect(notice).toContainText(
      "Workspace knowledge binding added.",
    );
    await expect(
      page
        .getByTestId("knowledge-binding-list")
        .getByText(WORKSPACE_TITLE, { exact: true }),
    ).toBeVisible();

    changeRequestId = `knowledge-browser-review-${suffix}`;
    await seedPendingProposal(database, {
      changeRequestId,
      spaceId,
      proposal,
      suffix,
    });

    await page.getByTestId("knowledge-reviews-tab").click();
    await expect(page).toHaveURL(/\/knowledge\?view=reviews$/);
    const refreshButton = page.getByRole("button", {
      name: "Refresh Knowledge data",
    });
    const changesResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname === "/api/knowledge/change-requests",
    );
    await refreshButton.click();
    expect((await changesResponsePromise).status()).toBe(200);
    await expect(refreshButton).toBeEnabled();
    await expect(page).toHaveURL(
      new RegExp(`\\/knowledge\\?view=reviews&change=${changeRequestId}$`),
    );
    const proposalLink = page.getByRole("link", {
      name: new RegExp(`Browser knowledge proposal ${suffix}`),
    });
    await expect(proposalLink).toBeVisible();
    await expect(proposalLink).toHaveAttribute("aria-current", "page");
    await proposalLink.focus();
    await expect(proposalLink).toBeFocused();
    await proposalLink.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`\\/knowledge\\?view=reviews&change=${changeRequestId}$`),
    );
    await expect(proposalLink).toBeFocused();
    const review = page.getByLabel("Knowledge proposal review");
    await expect(review.getByTestId("knowledge-diff")).toContainText(
      "+Approved browser knowledge.",
    );
    await expect(
      page.getByTestId("knowledge-detail-announcement"),
    ).toContainText(`Details updated for Browser knowledge proposal ${suffix}.`);
    await expect(review.getByText("Awaiting review", { exact: true })).toBeVisible();
    await expect(review.getByTestId("knowledge-diff")).toHaveAttribute(
      "aria-label",
      "Git diff",
    );
    await expect(review.getByTestId("knowledge-diff")).toHaveAttribute(
      "aria-describedby",
      "knowledge-diff-help",
    );
    await expect(page.getByText("Long diffs stay horizontally scrollable.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Browser knowledge proposal ${suffix}` }),
    ).not.toBeFocused();
    await expect(
      page.getByLabel("Review note (optional)"),
    ).toHaveAttribute("name", "reviewNote");
    await expect(
      page.getByLabel("Review note (optional)"),
    ).toHaveAttribute("aria-describedby", "knowledge-review-note-help");

    await page
      .getByLabel("Review note (optional)")
      .fill("Reviewed in the production-backed browser flow.");
    await page.getByRole("button", { name: "Approve proposal" }).click();
    await expect(notice).toContainText("Proposal approved.");
    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Approved$/ }).first(),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: `Browser knowledge proposal ${suffix}` })).toBeFocused();

    await page.getByRole("button", { name: "Queue merge" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Queue this approved revision?",
    );
    await page.getByRole("button", { name: "Queue trusted merge" }).click();
    await expect(notice).toContainText(
      "Trusted merge queued.",
    );
    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Merge queued$/ }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: `Browser knowledge proposal ${suffix}` })).toBeFocused();

    const worker = await runKnowledgeMergeWorker({
      artifactRoot: path.join(fixtureRoot, "indexes"),
      databaseUrl: resolveIterationDatabaseUrl(),
      workerId: `knowledge-browser-worker-${suffix}`,
    });
    expect(worker.stderr).toBe("");
    expect(worker.exitCode).toBe(0);
    expect(worker.stdout).toContain('"type":"run-complete"');
    expect(worker.stdout).toContain('"status":"succeeded"');

    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Merged$/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Index ready$/ }),
    ).toBeVisible();
    await expect(review.getByText("Active in retrieval", { exact: true })).toBeVisible();
    await expect(review.getByText("This reviewed revision is merged, indexed, and active for retrieval.")).toBeVisible();

    const detailResponse = await page.request.get(
      `/api/knowledge/change-requests/${changeRequestId}`,
    );
    expect(detailResponse.status()).toBe(200);
    const detailPayload = (await detailResponse.json()) as {
      activeSnapshot: {
        artifactPath: string;
        artifactSha256: string;
        commitSha: string;
        readyAt: string;
      } | null;
    };
    const activeSnapshot = detailPayload.activeSnapshot;
    expect(activeSnapshot).not.toBeNull();
    if (!activeSnapshot) {
      throw new Error("Knowledge detail omitted the active snapshot after activation.");
    }
    expect(activeSnapshot).toMatchObject({
      commitSha: proposal.headCommit,
      readyAt: expect.any(String),
    });
    const snapshot = await readKnowledgeIndexArtifactV1(
      activeSnapshot.artifactPath,
      activeSnapshot.artifactSha256,
    );
    expect(snapshot).toMatchObject({
      commitSha: proposal.headCommit,
      indexVersion: "knowledge-index-v1",
      schemaVersion: 1,
    });
    expect(snapshot.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining("Approved browser knowledge."),
          path: "README.md",
        }),
      ]),
    );

    await page.getByTestId("knowledge-configuration-tab").click();
    await expect(page).toHaveURL(
      new RegExp(`\\/knowledge\\?view=configuration&change=${changeRequestId}$`),
    );
    await page.getByTestId("knowledge-reviews-tab").click();
    await expect(page).toHaveURL(
      new RegExp(`\\/knowledge\\?view=reviews&change=${changeRequestId}$`),
    );

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByTestId("knowledge-review-workspace")).toBeVisible();
    const bodyOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(bodyOverflow).toBe(false);

    const completed = await executeWithBusyRetry(database, {
      sql: `SELECT "status", "expectedHeadCommit"
            FROM "KnowledgeMergeOperation"
            WHERE "changeRequestId" = ?`,
      args: [changeRequestId],
    });
    expect(completed.rows[0]).toMatchObject({
      status: "succeeded",
      expectedHeadCommit: proposal.headCommit,
    });
  } finally {
    await runTeardown([
      {
        label: "Knowledge browser page",
        run: () => (page.isClosed() ? undefined : page.close()),
      },
      {
        label: "Knowledge database rows",
        run: () => cleanupDatabase(database, { bindingId, changeRequestId, spaceId }),
      },
      { label: "Knowledge database client", run: () => database.close() },
      {
        label: "Knowledge fixture root",
        run: () => rm(fixtureRoot, { recursive: true, force: true }),
      },
    ]);
  }
});

test("real Execution jobs produce a Knowledge proposal that the browser review flow merges and activates", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const suffix = randomUUID();
  const base = baseURL(testInfo);
  const fixtureParent = path.join(resolveIterationRoot(), "knowledge-fixtures");
  await mkdir(fixtureParent, { recursive: true });
  const fixtureRoot = await mkdtemp(path.join(fixtureParent, "execution-"));
  const repositoryPath = path.join(fixtureRoot, "repository");
  const runtimeFallbackCwd = path.join(fixtureRoot, "runtime-fallback");
  const managedWorktreeRoot = path.join(fixtureRoot, "managed-worktrees");
  const artifactRoot = path.join(fixtureRoot, "indexes");
  const configPath = path.join(fixtureRoot, "execution-daemon.json");
  const runtimeId = `knowledge-execution-runtime-${suffix}`;
  const workerId = `knowledge-execution-worker-${suffix}`;
  const mergeWorkerId = `knowledge-merge-worker-${suffix}`;
  const database = createClient({ url: resolveIterationDatabaseUrl() });
  const workspace = readSeedState().baseWorkspace;
  const notice = page
    .locator('[role="status"]')
    .filter({ has: page.getByRole("button", { name: "Dismiss notification" }) });
  const runtimeFixture = path.join(
    process.cwd(),
    "apps",
    "execution-daemon",
    "fixtures",
    "git-change-runtime.mjs",
  );
  let daemon: ObservedProcess | null = null;
  let spaceId: string | null = null;
  let bindingId: string | null = null;
  let jobId: string | null = null;
  let attemptId: string | null = null;
  let changeRequestId: string | null = null;
  let lockProbeAgentId: string | null = null;
  let registeredRuntimeId: string | null = null;

  try {
    await database.execute("PRAGMA busy_timeout = 5000");
    await Promise.all([
      mkdir(runtimeFallbackCwd, { recursive: true }),
      mkdir(managedWorktreeRoot, { recursive: true }),
      mkdir(artifactRoot, { recursive: true }),
    ]);

    const baseCommit = await initializeKnowledgeRepository(repositoryPath);
    const versionId = await createAlignedVersion(
      base,
      workspace.id,
      `Knowledge execution source ${suffix}`,
    );
    const createdSpace = await createKnowledgeSpace(base, {
      defaultBranch: "main",
      repoPath: repositoryPath,
      scope: "team",
    });
    spaceId = createdSpace.id;
    const createdBinding = await createKnowledgeBinding(base, {
      access: "propose",
      spaceId,
      workspaceId: workspace.id,
    });
    bindingId = createdBinding.id;

    await writeFile(
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
            runtimeId,
            runtimeVersion: "knowledge-e2e-git-change-v1",
            executable: process.execPath,
            args: [runtimeFixture],
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
              commitAuthor: {
                email: "knowledge-e2e@example.test",
                name: "Knowledge E2E",
              },
            },
          },
        ],
      }),
    );

    daemon = observeProcess(
      spawn(process.execPath, [
        path.join(process.cwd(), ".vite", "execution-daemon", "index.mjs"),
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
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
      organizationId: ORGANIZATION_ID,
      runtimeIds: [runtimeId],
      workerId,
    });
    registeredRuntimeId = runtimeId;

    const receipt = await createExecutionJob(base, {
      conversationId: workspace.conversationId,
      documentVersionId: versionId,
      goal: `Execution to Knowledge review ${suffix}`,
      kind: "coding",
      projectId: workspace.id,
      requirements: { workspace: "git-worktree" },
      runtimeId,
      workspaceId: workspace.id,
    });
    jobId = receipt.jobId;

    const executionResult = await waitForExecutionKnowledgeProposal(
      database,
      jobId,
      runtimeId,
    );
    attemptId = executionResult.attemptId;
    changeRequestId = executionResult.changeRequestId;

    expect(executionResult).toMatchObject({
      attemptStatus: "succeeded",
      changeRequestStatus: "pending_review",
      jobStatus: "succeeded",
      runtimeId,
    });
    expect(executionResult.runtimeRunId).toEqual(expect.any(String));
    expect(executionResult.lifecycle).toMatchObject({
      binding: {
        baseCommit,
        mountPath: "/",
        spaceId,
        workspaceId: workspace.id,
      },
      changeRequestId,
      cleanedAt: expect.any(String),
      finalized: {
        attemptId,
        baseCommit,
        branch: expect.stringContaining(`/job/${jobId}/attempt/1`),
        changed: true,
        files: ["runtime-change.txt"],
        headCommit: executionResult.headCommit,
        jobId,
        patchSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      prepared: {
        attemptId,
        baseCommit,
        branch: expect.stringContaining(`/job/${jobId}/attempt/1`),
        defaultBranch: "main",
        jobId,
        repositoryPath,
        spaceId,
      },
      runtimeCompletion: {
        runtimeRunId: executionResult.runtimeRunId,
        status: "succeeded",
      },
    });
    expect(executionResult.diffMetadata).toMatchObject({
      bindingId,
      files: ["runtime-change.txt"],
      mountPath: "/",
      patchSha256: String(record(executionResult.lifecycle.finalized).patchSha256 || ""),
    });
    expect(
      await git(repositoryPath, ["rev-parse", "refs/heads/main"]),
    ).toBe(baseCommit);
    expect(
      await git(repositoryPath, [
        "rev-parse",
        `refs/heads/${String(record(executionResult.lifecycle.finalized).branch || "")}`,
      ]),
    ).toBe(executionResult.headCommit);
    const cleanedWorktreePath = String(
      record(executionResult.lifecycle.prepared).worktreePath || "",
    );
    expect(cleanedWorktreePath).not.toBe("");
    await expectPathAbsent(cleanedWorktreePath);

    await page.goto(`/knowledge?view=reviews&change=${changeRequestId}`);
    await expect(page.getByRole("heading", { name: "Review once, then follow the same proposal to activation." })).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`\\/knowledge\\?view=reviews&change=${changeRequestId}$`),
    );
    await page.getByRole("button", { name: "Refresh Knowledge data" }).click();

    const review = page.getByLabel("Knowledge proposal review");
    await expect(review.getByTestId("knowledge-diff")).toContainText(
      "+changed by",
    );
    await expect(review.getByTestId("knowledge-diff")).toContainText(
      "runtime-change.txt",
    );
    await expect(review.getByText("Awaiting review", { exact: true })).toBeVisible();

    await page
      .getByLabel("Review note (optional)")
      .fill("Reviewed after a real execution daemon attempt produced this proposal.");
    await page.getByRole("button", { name: "Approve proposal" }).click();
    await expect(notice).toContainText("Proposal approved.");
    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Approved$/ }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Queue merge" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Queue this approved revision?",
    );
    await page.getByRole("button", { name: "Queue trusted merge" }).click();
    await expect(notice).toContainText("Trusted merge queued.");
    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Merge queued$/ }),
    ).toBeVisible();

    const queued = await executeWithBusyRetry(database, {
      sql: `SELECT "status", "expectedBaseCommit", "expectedHeadCommit"
            FROM "KnowledgeMergeOperation"
            WHERE "changeRequestId" = ?`,
      args: [changeRequestId],
    });
    expect(queued.rows[0]).toMatchObject({
      expectedBaseCommit: baseCommit,
      expectedHeadCommit: executionResult.headCommit,
      status: "queued",
    });

    const worker = await runKnowledgeMergeWorker({
      artifactRoot,
      databaseUrl: resolveIterationDatabaseUrl(),
      workerId: mergeWorkerId,
    });
    expect(worker.stderr).toBe("");
    expect(worker.exitCode).toBe(0);
    expect(worker.stdout).toContain('"type":"run-complete"');
    expect(worker.stdout).toContain('"status":"succeeded"');

    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Merged$/ }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      review.locator('[data-slot="badge"]').filter({ hasText: /^Index ready$/ }),
    ).toBeVisible();
    await expect(review.getByText("Active in retrieval", { exact: true })).toBeVisible();

    const detailResponse = await page.request.get(
      `/api/knowledge/change-requests/${changeRequestId}`,
    );
    expect(detailResponse.status()).toBe(200);
    const detailPayload = (await detailResponse.json()) as {
      activeSnapshot: {
        artifactPath: string;
        artifactSha256: string;
        commitSha: string;
        readyAt: string;
      } | null;
      changeRequest: {
        mergedCommit: string | null;
      };
      space: {
        activeSnapshotId: string | null;
      };
    };
    expect(detailPayload.changeRequest.mergedCommit).toBe(executionResult.headCommit);
    expect(detailPayload.space.activeSnapshotId).toEqual(expect.any(String));
    expect(detailPayload.activeSnapshot).not.toBeNull();
    if (!detailPayload.activeSnapshot) {
      throw new Error("Knowledge detail omitted the active snapshot after activation.");
    }
    expect(detailPayload.activeSnapshot).toMatchObject({
      commitSha: executionResult.headCommit,
      readyAt: expect.any(String),
    });

    const lockProbeResponse = await page.request.post("/api/agents", {
      data: {
        description: "Created immediately after Knowledge activation to detect leaked SQLite locks.",
        enabled: true,
        handle: `@knowledge-lock-${suffix.slice(0, 8)}`,
        name: `Knowledge lock probe ${suffix.slice(0, 8)}`,
        schemaVersion: 1,
      },
      headers: LOCAL_PLATFORM_HEADERS,
    });
    expect(lockProbeResponse.status()).toBe(201);
    const lockProbePayload = record(await lockProbeResponse.json());
    const lockProbeAgent = record(lockProbePayload.agent);
    lockProbeAgentId = String(lockProbeAgent.id || "");
    expect(lockProbeAgentId).not.toBe("");
    expect(lockProbeAgent).toMatchObject({
      handle: `@knowledge-lock-${suffix.slice(0, 8)}`,
      organizationId: ORGANIZATION_ID,
      revision: 1,
    });

    const snapshot = await readKnowledgeIndexArtifactV1(
      detailPayload.activeSnapshot.artifactPath,
      detailPayload.activeSnapshot.artifactSha256,
    );
    expect(snapshot).toMatchObject({
      commitSha: executionResult.headCommit,
      indexVersion: "knowledge-index-v1",
      schemaVersion: 1,
    });
    expect(snapshot.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining(`changed by ${attemptId} at ${baseCommit}`),
          path: "runtime-change.txt",
        }),
      ]),
    );

    expect(
      await git(repositoryPath, ["rev-parse", "refs/heads/main"]),
    ).toBe(executionResult.headCommit);

    const completed = await executeWithBusyRetry(database, {
      sql: `SELECT "status", "expectedHeadCommit", "mergedCommit", "snapshotId"
            FROM "KnowledgeMergeOperation"
            WHERE "changeRequestId" = ?`,
      args: [changeRequestId],
    });
    expect(completed.rows[0]).toMatchObject({
      expectedHeadCommit: executionResult.headCommit,
      mergedCommit: executionResult.headCommit,
      status: "succeeded",
      snapshotId: expect.any(String),
    });
  } finally {
    await runTeardown([
      {
        label: "Knowledge browser page",
        run: () => (page.isClosed() ? undefined : page.close()),
      },
      { label: "Execution daemon", run: () => stopProcess(daemon) },
      {
        label: "Knowledge database rows",
        run: () => cleanupDatabase(database, { bindingId, changeRequestId, spaceId }),
      },
      {
        label: "Execution database rows",
        run: () =>
          cleanupExecutionArtifacts(database, {
            agentProfileId: lockProbeAgentId,
            jobId,
            runtimeId: registeredRuntimeId,
          }),
      },
      { label: "Execution database client", run: () => database.close() },
      {
        label: "Execution fixture root",
        run: () => rm(fixtureRoot, { recursive: true, force: true }),
      },
    ]);
  }
});

type GitProposal = {
  baseCommit: string;
  branchName: string;
  headCommit: string;
  patchSha256: string;
};

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

type ExecutionKnowledgeProposal = {
  attemptId: string;
  attemptStatus: string;
  changeRequestId: string;
  changeRequestStatus: string;
  diffMetadata: JsonRecord;
  headCommit: string;
  jobStatus: string;
  lifecycle: JsonRecord;
  runtimeId: string;
  runtimeRunId: string;
};

async function createGitProposal(
  repositoryPath: string,
  suffix: string,
): Promise<GitProposal> {
  await mkdir(repositoryPath, { recursive: true });
  await git(repositoryPath, ["init"]);
  await git(repositoryPath, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  await writeFile(path.join(repositoryPath, "README.md"), "# Browser knowledge\n");
  await git(repositoryPath, ["add", "--all"]);
  await commit(repositoryPath, "Seed browser knowledge");
  const baseCommit = await git(repositoryPath, ["rev-parse", "HEAD"]);
  const branchName = `proposal/browser-${suffix}`;
  await git(repositoryPath, ["checkout", "-b", branchName]);
  await writeFile(
    path.join(repositoryPath, "README.md"),
    "# Browser knowledge\n\nApproved browser knowledge.\n",
  );
  await git(repositoryPath, ["add", "--all"]);
  await commit(repositoryPath, "Propose browser knowledge");
  const headCommit = await git(repositoryPath, ["rev-parse", "HEAD"]);
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
  await git(repositoryPath, ["checkout", "main"]);
  return {
    baseCommit,
    branchName,
    headCommit,
    patchSha256: createHash("sha256").update(patch).digest("hex"),
  };
}

async function git(repositoryPath: string, args: string[]): Promise<string> {
  return (await gitRaw(repositoryPath, args)).trim();
}

async function gitRaw(repositoryPath: string, args: string[]): Promise<string> {
  const result = await run(
    "git",
    ["-c", `core.hooksPath=${devNull}`, "-C", repositoryPath, ...args],
    {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        LC_ALL: "C",
      },
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return result.stdout;
}

async function expectPathAbsent(candidate: string): Promise<void> {
  await expect(lstat(candidate)).rejects.toMatchObject({ code: "ENOENT" });
}

async function commit(repositoryPath: string, message: string): Promise<void> {
  await git(repositoryPath, [
    "-c",
    "user.name=Knowledge Browser Test",
    "-c",
    "user.email=knowledge-browser@example.test",
    "commit",
    "-m",
    message,
  ]);
}

async function seedPendingProposal(
  database: Client,
  input: {
    changeRequestId: string;
    proposal: GitProposal;
    spaceId: string;
    suffix: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await executeWithBusyRetry(database, {
    sql: `INSERT INTO "KnowledgeChangeRequest" (
      "id", "organizationId", "jobId", "attemptId", "spaceId",
      "baseCommit", "headCommit", "branchName", "status",
      "diffSummary", "diffMetadataJson", "revision", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?, 1, ?, ?)`,
    args: [
      input.changeRequestId,
      ORGANIZATION_ID,
      `knowledge-browser-job-${input.suffix}`,
      `knowledge-browser-attempt-${input.suffix}`,
      input.spaceId,
      input.proposal.baseCommit,
      input.proposal.headCommit,
      input.proposal.branchName,
      `Browser knowledge proposal ${input.suffix}`,
      JSON.stringify({
        files: ["README.md"],
        patchSha256: input.proposal.patchSha256,
      }),
      now,
      now,
    ],
  });
}

async function readId(
  database: Client,
  table: "KnowledgeSpace",
  column: "repoPath",
  value: string,
): Promise<string> {
  const result = await executeWithBusyRetry(database, {
    sql: `SELECT "id" FROM "${table}" WHERE "${column}" = ? LIMIT 1`,
    args: [value],
  });
  const id = String(result.rows[0]?.id || "");
  if (!id) throw new Error(`Could not find ${table} for ${value}.`);
  return id;
}

async function executeWithBusyRetry(
  database: Client,
  statement: string | { sql: string; args: (string | number | null)[] },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await database.execute(statement);
    } catch (error) {
      lastError = error;
      if (!isSqliteBusyError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function cleanupDatabase(
  database: Client,
  ids: { bindingId: string | null; changeRequestId: string | null; spaceId: string | null },
): Promise<void> {
  await executeWithBusyRetry(database, "PRAGMA busy_timeout = 5000");
  if (ids.changeRequestId) {
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "KnowledgeSnapshot" WHERE "changeRequestId" = ?`,
      args: [ids.changeRequestId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "KnowledgeMergeOperation" WHERE "changeRequestId" = ?`,
      args: [ids.changeRequestId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "KnowledgeChangeRequest" WHERE "id" = ?`,
      args: [ids.changeRequestId],
    });
  }
  if (ids.bindingId) {
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "KnowledgeBinding" WHERE "id" = ?`,
      args: [ids.bindingId],
    });
  }
  if (ids.spaceId) {
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "KnowledgeSpace" WHERE "id" = ?`,
      args: [ids.spaceId],
    });
  }
}

async function cleanupExecutionArtifacts(
  database: Client,
  ids: {
    agentProfileId: string | null;
    jobId: string | null;
    runtimeId: string | null;
  },
): Promise<void> {
  if (ids.jobId) {
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionOutbox" WHERE "jobId" = ?`,
      args: [ids.jobId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionRecoveryIncident" WHERE "jobId" = ?`,
      args: [ids.jobId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionEvent" WHERE "jobId" = ?`,
      args: [ids.jobId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionArtifact" WHERE "jobId" = ?`,
      args: [ids.jobId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionInputRequest" WHERE "jobId" = ?`,
      args: [ids.jobId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionAttempt" WHERE "jobId" = ?`,
      args: [ids.jobId],
    });
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionJob" WHERE "id" = ?`,
      args: [ids.jobId],
    });
  }
  if (ids.runtimeId) {
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "ExecutionRuntime" WHERE "id" = ? AND "organizationId" = ?`,
      args: [ids.runtimeId, ORGANIZATION_ID],
    });
  }
  if (ids.agentProfileId) {
    await executeWithBusyRetry(database, {
      sql: `DELETE FROM "AgentProfile" WHERE "id" = ? AND "organizationId" = ?`,
      args: [ids.agentProfileId, ORGANIZATION_ID],
    });
  }
}

function resolveIterationDatabaseUrl(): string {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
  const iterationRoot = resolveIterationRoot();
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, "app-data");
  return `file:${path.join(appDataRoot, "dev.db")}`;
}

function resolveIterationAppDataRoot(): string {
  if (process.env.DAO_APP_DATA_ROOT?.trim()) {
    return process.env.DAO_APP_DATA_ROOT.trim();
  }
  const iterationRoot = resolveIterationRoot();
  return path.join(iterationRoot, "app-data");
}

function resolveIterationRoot(): string {
  return (
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), ".tmp", "iteration-regression")
  );
}

async function runKnowledgeMergeWorker(input: {
  artifactRoot: string;
  databaseUrl: string;
  workerId: string;
}): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const workerEnvironment = { ...process.env };
  delete workerEnvironment.FORCE_COLOR;
  delete workerEnvironment.NO_COLOR;
  const workerEntry = path.join(
    process.cwd(),
    ".vite",
    "knowledge-merge-worker",
    "index.mjs",
  );
  try {
    const result = await run(process.execPath, [workerEntry], {
      cwd: process.cwd(),
      env: {
        ...workerEnvironment,
        DATABASE_URL: input.databaseUrl,
        DAO_KNOWLEDGE_INDEX_ROOT: input.artifactRoot,
        DAO_KNOWLEDGE_LEASE_DURATION_MS: "10000",
        DAO_KNOWLEDGE_MAX_ATTEMPTS: "3",
        DAO_KNOWLEDGE_ORGANIZATION_ID: ORGANIZATION_ID,
        DAO_KNOWLEDGE_POLL_INTERVAL_MS: "25",
        DAO_KNOWLEDGE_RUN_ONCE: "1",
        DAO_KNOWLEDGE_WORKER_ID: input.workerId,
        NODE_ENV: "test",
      },
      maxBuffer: 8 * 1024 * 1024,
      timeout: WORKER_TIMEOUT_MS,
    });
    return { exitCode: 0, stderr: result.stderr, stdout: result.stdout };
  } catch (error) {
    const failure = error as Error & { code?: number; stderr?: string; stdout?: string };
    throw new Error(
      `Knowledge merge worker failed with code ${String(failure.code ?? "unknown")}: ` +
        `${failure.message}; stdout=${failure.stdout || ""}; stderr=${failure.stderr || ""}`,
    );
  }
}

async function initializeKnowledgeRepository(repositoryPath: string): Promise<string> {
  await mkdir(repositoryPath, { recursive: true });
  await git(repositoryPath, ["init"]);
  await git(repositoryPath, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  await writeFile(
    path.join(repositoryPath, "README.md"),
    "# Execution knowledge repository\n",
  );
  await git(repositoryPath, ["add", "--all"]);
  await git(repositoryPath, [
    "-c",
    "user.name=Knowledge Execution Seed",
    "-c",
    "user.email=knowledge-execution-seed@example.test",
    "commit",
    "-m",
    "Seed execution knowledge repository",
  ]);
  return git(repositoryPath, ["rev-parse", "HEAD"]);
}

function baseURL(testInfo: TestInfo) {
  return String(testInfo.project.use.baseURL);
}

async function createAlignedVersion(
  base: string,
  workspaceId: string,
  title: string,
): Promise<string> {
  const versionResult = await requestJson(base, `/api/workspaces/${encodeURIComponent(workspaceId)}/versions`, {
    body: { title },
    method: "POST",
  });
  expect(versionResult.response.status).toBe(200);
  const versionId = String(record(versionResult.payload).id || "");
  expect(versionId).not.toBe("");

  const alignmentResult = await requestJson(base, `/api/workspaces/${encodeURIComponent(workspaceId)}/alignment`, {
    body: { versionId },
    method: "POST",
  });
  expect(alignmentResult.response.status).toBe(200);
  expect(record(record(alignmentResult.payload).version).aligned).toBe(true);
  return versionId;
}

async function createKnowledgeSpace(
  base: string,
  input: {
    defaultBranch: string;
    repoPath: string;
    scope: "team" | "agent";
  },
): Promise<{ id: string }> {
  const result = await requestJson(base, "/api/knowledge/spaces", {
    body: input,
    method: "POST",
  });
  expect(result.response.status).toBe(201);
  const space = record(result.payload).space;
  const id = String(record(space).id || "");
  if (!id) throw new Error(`Knowledge space creation failed: ${JSON.stringify(result.payload)}`);
  return { id };
}

async function createKnowledgeBinding(
  base: string,
  input: {
    access: "read" | "propose";
    spaceId: string;
    workspaceId: string;
  },
): Promise<{ id: string }> {
  const result = await requestJson(base, "/api/knowledge/bindings", {
    body: input,
    method: "POST",
  });
  expect(result.response.status).toBe(201);
  const binding = record(result.payload).binding;
  const id = String(record(binding).id || "");
  if (!id) throw new Error(`Knowledge binding creation failed: ${JSON.stringify(result.payload)}`);
  return { id };
}

async function createExecutionJob(
  base: string,
  input: {
    conversationId: string;
    documentVersionId: string;
    goal: string;
    kind: "coding";
    projectId: string;
    requirements: Record<string, unknown>;
    runtimeId: string;
    workspaceId: string;
  },
): Promise<{ jobId: string; status: string }> {
  const result = await poll(
    async () => {
      const response = await requestJson(base, "/api/execution-jobs", {
        body: {
          conversationId: input.conversationId,
          documentVersionId: input.documentVersionId,
          goal: input.goal,
          kind: input.kind,
          projectId: input.projectId,
          requirements: input.requirements,
          runtimeSelection: {
            mode: "explicit",
            runtimeId: input.runtimeId,
          },
          workspaceId: input.workspaceId,
        },
        headers: {
          "x-dao-idempotency-key": `knowledge-e2e-execution-${input.runtimeId}`,
        },
        method: "POST",
      });
      return response.response.status === 500 && isSqliteBusyPayload(response.payload)
        ? null
        : response;
    },
    PROCESS_TIMEOUT_MS,
    `execution job creation for runtime ${input.runtimeId}`,
  );
  if (result.response.status !== 202) {
    throw new Error(
      `Execution job creation failed with ${result.response.status}: ${JSON.stringify(result.payload)}`,
    );
  }
  const receipt = record(record(result.payload).receipt);
  const jobId = String(receipt.jobId || "");
  if (!jobId) {
    throw new Error(`Execution job creation failed: ${JSON.stringify(result.payload)}`);
  }
  return {
    jobId,
    status: String(receipt.status || ""),
  };
}

async function waitForExecutionKnowledgeProposal(
  database: Client,
  jobId: string,
  runtimeId: string,
): Promise<ExecutionKnowledgeProposal> {
  return poll(async () => {
    const result = await executeWithBusyRetry(database, {
      sql: `SELECT attempt."id" AS "attemptId",
                   attempt."status" AS "attemptStatus",
                   attempt."runtimeId" AS "runtimeId",
                   attempt."runtimeRunId" AS "runtimeRunId",
                   attempt."workspaceLifecycleJson" AS "workspaceLifecycleJson",
                   job."status" AS "jobStatus",
                   change_request."id" AS "changeRequestId",
                   change_request."status" AS "changeRequestStatus",
                   change_request."headCommit" AS "headCommit",
                   change_request."diffMetadataJson" AS "diffMetadataJson"
            FROM "ExecutionJob" AS job
            JOIN "ExecutionAttempt" AS attempt ON attempt."jobId" = job."id"
            LEFT JOIN "KnowledgeChangeRequest" AS change_request
              ON change_request."attemptId" = attempt."id"
            WHERE job."id" = ?
            ORDER BY attempt."number" DESC
            LIMIT 1`,
      args: [jobId],
    });
    const row = record(result.rows[0]);
    const lifecycleRaw = row.workspaceLifecycleJson;
    const lifecycle =
      typeof lifecycleRaw === "string" && lifecycleRaw
        ? record(JSON.parse(lifecycleRaw))
        : null;
    if (
      row.attemptStatus !== "succeeded" ||
      row.jobStatus !== "succeeded" ||
      row.runtimeId !== runtimeId ||
      typeof row.runtimeRunId !== "string" ||
      typeof row.changeRequestId !== "string" ||
      row.changeRequestStatus !== "pending_review" ||
      typeof row.headCommit !== "string" ||
      !lifecycle ||
      lifecycle.changeRequestId !== row.changeRequestId ||
      record(lifecycle.finalized).changed !== true
    ) {
      return null;
    }
    return {
      attemptId: String(row.attemptId),
      attemptStatus: String(row.attemptStatus),
      changeRequestId: String(row.changeRequestId),
      changeRequestStatus: String(row.changeRequestStatus),
      diffMetadata: record(
        typeof row.diffMetadataJson === "string"
          ? JSON.parse(row.diffMetadataJson)
          : null,
      ),
      headCommit: String(row.headCommit),
      jobStatus: String(row.jobStatus),
      lifecycle,
      runtimeId: String(row.runtimeId),
      runtimeRunId: String(row.runtimeRunId),
    } satisfies ExecutionKnowledgeProposal;
  }, PROCESS_TIMEOUT_MS, `execution job ${jobId} to produce a knowledge proposal`);
}

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
            // Keep raw output for timeout diagnostics.
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
              `Process exited before ${type}: stdout=${output.stdout}; stderr=${output.stderr}`,
            );
          }
          return null;
        },
        timeoutMs,
        `daemon event ${type}`,
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
): Promise<{ payload: unknown; response: Response }> {
  const response = await fetch(new URL(pathname, base), {
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      ...LOCAL_PLATFORM_HEADERS,
      ...init?.headers,
    },
    method: init?.method || "GET",
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `API ${init?.method || "GET"} ${pathname} returned non-JSON content (${response.status}): ${text.slice(0, 1_000)}`,
      );
    }
  }
  return { payload, response };
}

async function poll<T>(
  read: () => Promise<T | null> | T | null,
  timeoutMs: number,
  description: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
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
    await waitForExit(processHandle.child, 2_000);
  });
}

async function runTeardown(
  tasks: Array<{ label: string; run: () => Promise<unknown> | unknown }>,
): Promise<void> {
  const failures: Error[] = [];
  for (const task of tasks) {
    try {
      await task.run();
    } catch (error) {
      failures.push(
        new Error(
          `${task.label} cleanup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        ),
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Knowledge E2E teardown failed.");
  }
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

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function isSqliteBusyPayload(payload: unknown): boolean {
  const root = record(payload);
  const error = typeof root.error === "string" ? root.error : "";
  const detail = typeof root.detail === "string" ? root.detail : "";
  return (
    error.includes("SQLITE_BUSY") ||
    detail.includes("SQLITE_BUSY") ||
    detail.includes("database is locked") ||
    detail.includes("Operation has timed out")
  );
}

function isSqliteBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("SQLITE_BUSY") ||
    message.includes("database is locked") ||
    message.includes("Operation has timed out")
  );
}
