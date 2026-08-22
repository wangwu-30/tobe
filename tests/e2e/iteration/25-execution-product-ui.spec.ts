import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@libsql/client";
import { expect, test, type Locator, type TestInfo } from "@playwright/test";

import { apiRequest, readSeedState } from "./helpers";

type ExecutionUiFixtures = {
  answer: string;
  artifactContent: string;
  artifactMetadata: string;
  artifactName: string;
  cancelJobId: string;
  cancelGoal: string;
  inputRequestId: string;
  logText: string;
  progressText: string;
  richGoal: string;
  richJobId: string;
  retryRecoveryAttemptId: string;
  retryRecoveryClassification: string;
  retryRecoveryGoal: string;
  retryRecoveryIncidentId: string;
  retryRecoveryJobId: string;
  retryRecoveryReasonCode: string;
  retryRecoveryStage: string;
  discardRecoveryAttemptId: string;
  discardRecoveryClassification: string;
  discardRecoveryGoal: string;
  discardRecoveryIncidentId: string;
  discardRecoveryJobId: string;
  discardRecoveryReasonCode: string;
  discardRecoveryStage: string;
  waitingGoal: string;
  waitingJobId: string;
  waitingPrompt: string;
};

type CreateJobResponse = {
  receipt?: {
    jobId?: unknown;
    revision?: unknown;
    status?: unknown;
  };
};

let fixtures: ExecutionUiFixtures;

test.describe.serial("Execution product UI with the real backend", () => {
  test.beforeAll(async ({}, testInfo) => {
    fixtures = await seedExecutionUiFixtures(baseURL(testInfo));
  });

  test("lists, filters, and opens a durable execution job", async ({
    page,
  }) => {
    await page.goto("/jobs");

    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
    const richRow = page.getByTestId(`execution-job-${fixtures.richJobId}`);
    await expect(richRow).toBeVisible();
    await expect(richRow).toContainText(fixtures.richGoal);
    await expect(richRow).toContainText("Succeeded");
    await expect(richRow).toContainText("1/2 attempts");

    await page.getByLabel("Search execution jobs").fill(fixtures.richGoal);
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/jobs" &&
        url.searchParams.get("q") === fixtures.richGoal &&
        url.search.includes("C%2B%2B"),
    );
    await expect(richRow).toBeVisible();
    await expect(
      page.getByTestId(`execution-job-${fixtures.waitingJobId}`),
    ).toHaveCount(0);

    await page.reload();
    await expect(page.getByLabel("Search execution jobs")).toHaveValue(
      fixtures.richGoal,
    );
    await expect(richRow).toBeVisible();
    await expect(
      page.getByTestId(`execution-job-${fixtures.waitingJobId}`),
    ).toHaveCount(0);

    await richRow.click();
    await expect(page).toHaveURL(`/jobs/${fixtures.richJobId}`);
    const detail = page.getByTestId("execution-job-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(fixtures.richJobId);
    await expect(detail).toContainText(fixtures.richGoal);
    await expect(jobStatusBadge(detail, "Succeeded")).toBeVisible();
  });

  test("shows runtime events, projected logs, and safe artifact content", async ({
    page,
  }) => {
    await page.goto(`/jobs/${fixtures.richJobId}`);

    const detail = page.getByTestId("execution-job-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByText("text-delta", { exact: true })).toBeVisible();
    await expect(detail).toContainText(fixtures.logText);

    await page.getByTestId("execution-job-logs-tab").click();
    await expect(page).toHaveURL(`/jobs/${fixtures.richJobId}?tab=logs`);
    const logs = page.getByTestId("execution-job-logs");
    await expect(logs).toBeVisible();
    await expect(logs.getByTestId("execution-log-entry")).toHaveCount(2, {
      timeout: 15_000,
    });
    await expect(logs).toContainText(fixtures.logText);
    await expect(logs).toContainText(fixtures.progressText);
    await expect(logs).toContainText("67%");

    await page.getByRole("tab", { name: /^Artifacts \(1\)$/ }).click();
    await expect(page).toHaveURL(`/jobs/${fixtures.richJobId}?tab=artifacts`);
    const artifactCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: fixtures.artifactName });
    await expect(artifactCard).toBeVisible();
    await expect(artifactCard).toContainText(fixtures.artifactMetadata);
    await artifactCard
      .getByRole("button", { name: "View safe content" })
      .click();
    await expect(
      artifactCard.getByText("Content", { exact: true }),
    ).toBeVisible();
    await expect(artifactCard).toContainText(fixtures.artifactContent);
  });

  test("answers a waiting-input request and resumes the same job", async ({
    page,
  }) => {
    await page.goto(`/jobs/${fixtures.waitingJobId}`);

    const detail = page.getByTestId("execution-job-detail");
    await expect(detail).toBeVisible();
    await expect(
      detail.getByText("Needs input", { exact: true }),
    ).toBeVisible();
    const inputRequest = page
      .getByTestId("execution-input-request")
      .filter({ hasText: fixtures.waitingPrompt });
    await expect(inputRequest).toContainText(fixtures.waitingPrompt);
    const answer = inputRequest.getByLabel("Execution input answer");
    const resume = inputRequest.getByRole("button", { name: "Resume job" });
    await expect(resume).toBeDisabled();
    await answer.fill(`  ${fixtures.answer}  `);

    const answerResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .includes(
            `/api/execution-jobs/${fixtures.waitingJobId}/input-requests/${fixtures.inputRequestId}/answer`,
          ),
    );
    await resume.click();
    expect((await answerResponse).status()).toBe(200);

    await expect(inputRequest).toHaveCount(0);
    await expect(jobStatusBadge(detail, "Queued")).toBeVisible();
    await expect(readAnswerState(fixtures)).resolves.toMatchObject({
      attemptStatus: "pending",
      inputRevision: 2,
      inputStatus: "answered",
      jobRevision: 2,
      jobStatus: "queued",
      respondedById: "local-user",
      responseId: `response:${fixtures.inputRequestId}`,
      responseJson: JSON.stringify(fixtures.answer),
    });
  });

  test("cancels a queued control-plane job from its detail page", async ({
    page,
  }) => {
    await page.goto(`/jobs/${fixtures.cancelJobId}`);

    const detail = page.getByTestId("execution-job-detail");
    await expect(detail).toBeVisible();
    await expect(jobStatusBadge(detail, "Blocked")).toBeVisible();
    const cancel = page.getByRole("button", { name: "Cancel" });
    await expect(cancel).toBeVisible();

    await cancel.click();
    const confirmation = page.getByTestId("execution-cancel-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(
      confirmation.getByRole("heading", { name: "Cancel execution job?" }),
    ).toBeVisible();
    await expect(
      confirmation.getByRole("button", { name: "Keep running" }),
    ).toBeVisible();
    const cancelResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/execution-jobs/${fixtures.cancelJobId}/cancel`),
    );
    await confirmation.getByRole("button", { name: "Cancel job" }).click();
    expect((await cancelResponse).status()).toBe(200);

    await expect(confirmation).toHaveCount(0);
    await expect(jobStatusBadge(detail, "Cancelled")).toBeVisible();
    await expect(cancel).toHaveCount(0);
    await expect(
      readCancelledState(fixtures.cancelJobId),
    ).resolves.toMatchObject({
      revision: 2,
      status: "cancelled",
    });
    const cancelled = await readCancelledState(fixtures.cancelJobId);
    expect(cancelled.cancelRequestedAt).toBeTruthy();
    expect(cancelled.finishedAt).toBeTruthy();
  });

  test("shows recovery details, blocks unsafe discard, and records retry audit", async ({
    page,
  }) => {
    await page.goto(`/jobs/${fixtures.retryRecoveryJobId}`);

    const detail = page.getByTestId("execution-job-detail");
    await expect(detail).toBeVisible();
    await expect(jobStatusBadge(detail, "Blocked")).toBeVisible();

    const panel = page.getByTestId("execution-recovery-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("Workspace recovery");
    await expect(panel).toContainText(fixtures.retryRecoveryClassification);
    await expect(panel).toContainText(fixtures.retryRecoveryStage);
    await expect(panel).toContainText(fixtures.retryRecoveryReasonCode);
    const discard = panel.getByRole("button", { name: "Discard workspace" });
    await expect(discard).toBeDisabled();
    await expect(panel).toContainText(
      "This state cannot be safely discarded automatically.",
    );

    const retryResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/execution-jobs/${fixtures.retryRecoveryJobId}/recovery`),
    );
    await panel.getByRole("button", { name: "Retry recovery" }).click();
    expect((await retryResponse).status()).toBe(200);

    await expect(jobStatusBadge(detail, "Queued")).toBeVisible();
    const history = page.getByTestId("execution-recovery-history");
    const incident = history.getByTestId(
      `execution-recovery-incident-${fixtures.retryRecoveryIncidentId}`,
    );
    await expect(incident).toBeVisible();
    await expect(incident).toContainText("rev 2");
    await expect(incident).toContainText("action requested");
    await expect(incident).toContainText("action retry");
    await expect(incident).toContainText("Requested by");
    await expect(incident).toContainText("local-user");

    await expect(
      readRecoveryState(fixtures.retryRecoveryIncidentId, fixtures.retryRecoveryJobId),
    ).resolves.toMatchObject({
      actionRequestedById: "local-user",
      attemptStatus: "pending",
      jobRevision: 2,
      jobStatus: "queued",
      requestedAction: "retry",
      revision: 2,
      status: "action_requested",
    });

    await resolveRecoveryIncident({
      action: "retry",
      attemptId: fixtures.retryRecoveryAttemptId,
      incidentId: fixtures.retryRecoveryIncidentId,
    });

    await panel.getByRole("button", { name: "Refresh recovery" }).click();
    await expect(panel).toContainText(
      "No open quarantine. Recovery history remains available for audit.",
    );
    await expect(incident).toContainText("rev 3");
    await expect(incident).toContainText("resolved");
    await expect(incident).toContainText("resolution retried");
    await expect(incident).toContainText("Resolved at");
    await expect(
      readResolvedRecoveryState(fixtures.retryRecoveryIncidentId),
    ).resolves.toMatchObject({
      requestedAction: "retry",
      resolution: "retried",
      revision: 3,
      status: "resolved",
    });
  });

  test("confirms discard for a discardable recovery incident and refreshes resolved audit", async ({
    page,
  }) => {
    await page.goto(`/jobs/${fixtures.discardRecoveryJobId}`);

    const dialogCalls: string[] = [];
    page.on("dialog", (dialog) => {
      dialogCalls.push(dialog.message());
      void dialog.accept();
    });

    const detail = page.getByTestId("execution-job-detail");
    await expect(detail).toBeVisible();
    const panel = page.getByTestId("execution-recovery-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(fixtures.discardRecoveryClassification);
    await expect(panel).toContainText(fixtures.discardRecoveryStage);
    await expect(panel).toContainText(fixtures.discardRecoveryReasonCode);
    const discard = panel.getByRole("button", { name: "Discard workspace" });
    await expect(discard).toBeEnabled();

    const discardResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .endsWith(`/api/execution-jobs/${fixtures.discardRecoveryJobId}/recovery`),
    );
    await discard.click();
    expect((await discardResponse).status()).toBe(200);
    expect(dialogCalls).toEqual([
      "Discard the quarantined workspace? Uncommitted workspace changes will be permanently removed.",
    ]);

    await expect(jobStatusBadge(detail, "Queued")).toBeVisible();
    const history = page.getByTestId("execution-recovery-history");
    const incident = history.getByTestId(
      `execution-recovery-incident-${fixtures.discardRecoveryIncidentId}`,
    );
    await expect(incident).toContainText("rev 2");
    await expect(incident).toContainText("action discard");
    await expect(incident).toContainText("local-user");

    await expect(
      readRecoveryState(
        fixtures.discardRecoveryIncidentId,
        fixtures.discardRecoveryJobId,
      ),
    ).resolves.toMatchObject({
      attemptStatus: "pending",
      jobStatus: "queued",
      requestedAction: "discard",
      revision: 2,
      status: "action_requested",
    });

    await resolveRecoveryIncident({
      action: "discard",
      attemptId: fixtures.discardRecoveryAttemptId,
      incidentId: fixtures.discardRecoveryIncidentId,
    });

    await panel.getByRole("button", { name: "Refresh recovery" }).click();
    await expect(panel).toContainText(
      "No open quarantine. Recovery history remains available for audit.",
    );
    await expect(incident).toContainText("rev 3");
    await expect(incident).toContainText("resolved");
    await expect(incident).toContainText("resolution discarded");
    await expect(
      readResolvedRecoveryState(fixtures.discardRecoveryIncidentId),
    ).resolves.toMatchObject({
      requestedAction: "discard",
      resolution: "discarded",
      revision: 3,
      status: "resolved",
    });
  });
});

async function seedExecutionUiFixtures(
  base: string,
): Promise<ExecutionUiFixtures> {
  const suffix = randomUUID();
  const workspace = readSeedState().baseWorkspace;
  const versionId = await createAlignedVersion(
    base,
    workspace.id,
    `Execution UI source ${suffix}`,
  );
  const richGoal = `Inspect a finished C++ execution in the browser ${suffix}`;
  const waitingGoal = `Resume a paused execution in the browser ${suffix}`;
  const cancelGoal = `Cancel a queued execution in the browser ${suffix}`;
  const retryRecoveryGoal = `Retry a quarantined execution in the browser ${suffix}`;
  const discardRecoveryGoal = `Discard a quarantined execution in the browser ${suffix}`;
  const richJobId = await createBlockedJob(base, {
    goal: richGoal,
    maxAttempts: 2,
    suffix: `${suffix}-rich`,
    workspaceId: workspace.id,
    versionId,
  });
  const waitingJobId = await createBlockedJob(base, {
    goal: waitingGoal,
    maxAttempts: 2,
    suffix: `${suffix}-waiting`,
    workspaceId: workspace.id,
    versionId,
  });
  const cancelJobId = await createBlockedJob(base, {
    goal: cancelGoal,
    maxAttempts: 1,
    suffix: `${suffix}-cancel`,
    workspaceId: workspace.id,
    versionId,
  });
  const retryRecoveryJobId = await createBlockedJob(base, {
    goal: retryRecoveryGoal,
    maxAttempts: 2,
    suffix: `${suffix}-retry-recovery`,
    workspaceId: workspace.id,
    versionId,
  });
  const discardRecoveryJobId = await createBlockedJob(base, {
    goal: discardRecoveryGoal,
    maxAttempts: 2,
    suffix: `${suffix}-discard-recovery`,
    workspaceId: workspace.id,
    versionId,
  });

  const richAttemptId = `e2e-ui-rich-attempt-${suffix}`;
  const waitingAttemptId = `e2e-ui-waiting-attempt-${suffix}`;
  const retryRecoveryAttemptId = `e2e-ui-retry-recovery-attempt-${suffix}`;
  const discardRecoveryAttemptId = `e2e-ui-discard-recovery-attempt-${suffix}`;
  const inputRequestId = `e2e-ui-input-${suffix}`;
  const retryRecoveryIncidentId = `e2e-ui-retry-recovery-incident-${suffix}`;
  const discardRecoveryIncidentId = `e2e-ui-discard-recovery-incident-${suffix}`;
  const artifactId = `e2e-ui-artifact-${suffix}`;
  const artifactName = `execution-report-${suffix}.json`;
  const artifactContent = `artifact-content-${suffix}`;
  const artifactMetadata = `browser-fixture-${suffix}`;
  const artifactPayload = JSON.stringify({
    checks: ["list", "detail", "logs"],
    summary: artifactContent,
  });
  const logText = `runtime-log-${suffix}`;
  const progressText = `Compiling execution fixture ${suffix}`;
  const waitingPrompt = `Which release channel should continue ${suffix}?`;
  const answer = `stable-${suffix}`;
  const retryRecoveryStage = "prepare";
  const retryRecoveryReasonCode = "worktree-path-conflict";
  const retryRecoveryClassification = "partial";
  const discardRecoveryStage = "cleanup";
  const discardRecoveryReasonCode = "worktree-state-changed";
  const discardRecoveryClassification = "prepared-dirty";
  const now = new Date().toISOString();
  const client = createClient({ url: resolveIterationDatabaseUrl() });

  try {
    await client.batch(
      [
        {
          sql: `UPDATE "ExecutionJob"
                SET "status" = 'succeeded', "startedAt" = ?,
                    "finishedAt" = ?, "resultJson" = ?,
                    "errorJson" = NULL, "updatedAt" = ?
                WHERE "id" = ? AND "organizationId" = 'local-org'`,
          args: [
            now,
            now,
            JSON.stringify({ delivered: true, fixture: suffix }),
            now,
            richJobId,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionAttempt" (
                  "id", "organizationId", "jobId", "number",
                  "status", "generation", "resultJson", "startedAt",
                  "finishedAt", "createdAt", "updatedAt"
                ) VALUES (?, 'local-org', ?, 1, 'succeeded', 1, ?, ?, ?, ?, ?)`,
          args: [
            richAttemptId,
            richJobId,
            JSON.stringify({ ok: true }),
            now,
            now,
            now,
            now,
          ],
        },
        executionEvent({
          attemptId: richAttemptId,
          id: `e2e-ui-text-event-${suffix}`,
          jobId: richJobId,
          now,
          payload: { text: logText },
          runtimeEventId: `e2e-ui-runtime-text-${suffix}`,
          sequence: 1,
          type: "text-delta",
        }),
        executionEvent({
          attemptId: richAttemptId,
          id: `e2e-ui-progress-event-${suffix}`,
          jobId: richJobId,
          now,
          payload: { message: progressText, percent: 67 },
          runtimeEventId: `e2e-ui-runtime-progress-${suffix}`,
          sequence: 2,
          type: "progress",
        }),
        executionEvent({
          attemptId: richAttemptId,
          id: `e2e-ui-checkpoint-event-${suffix}`,
          jobId: richJobId,
          now,
          payload: { checkpointRef: `checkpoint-${suffix}` },
          runtimeEventId: `e2e-ui-runtime-checkpoint-${suffix}`,
          sequence: 3,
          type: "checkpoint",
        }),
        {
          sql: `INSERT INTO "ExecutionArtifact" (
                  "id", "organizationId", "jobId", "attemptId",
                  "kind", "name", "payloadJson", "mimeType",
                  "sizeBytes", "sha256", "metadataJson", "createdAt"
                ) VALUES (?, 'local-org', ?, ?, 'report', ?, ?,
                  'application/json', ?, ?, ?, ?)`,
          args: [
            artifactId,
            richJobId,
            richAttemptId,
            artifactName,
            artifactPayload,
            Buffer.byteLength(artifactPayload, "utf8"),
            createHash("sha256").update(artifactPayload).digest("hex"),
            JSON.stringify({ fixture: artifactMetadata }),
            now,
          ],
        },
        {
          sql: `UPDATE "ExecutionJob"
                SET "status" = 'waiting_input', "startedAt" = ?,
                    "errorJson" = NULL, "updatedAt" = ?
                WHERE "id" = ? AND "organizationId" = 'local-org'`,
          args: [now, now, waitingJobId],
        },
        {
          sql: `INSERT INTO "ExecutionAttempt" (
                  "id", "organizationId", "jobId", "number",
                  "status", "generation", "checkpointJson",
                  "startedAt", "createdAt", "updatedAt"
                ) VALUES (?, 'local-org', ?, 1, 'waiting_input', 1, ?, ?, ?, ?)`,
          args: [
            waitingAttemptId,
            waitingJobId,
            JSON.stringify({ step: "approval" }),
            now,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionInputRequest" (
                  "id", "organizationId", "jobId", "attemptId",
                  "requestKey", "prompt", "schemaJson", "status",
                  "requestedAt", "revision", "createdAt", "updatedAt"
                ) VALUES (?, 'local-org', ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?)`,
          args: [
            inputRequestId,
            waitingJobId,
            waitingAttemptId,
            inputRequestId,
            waitingPrompt,
            JSON.stringify({ type: "string" }),
            now,
            now,
            now,
          ],
        },
        {
          sql: `UPDATE "ExecutionJob"
                SET "status" = 'blocked', "startedAt" = ?,
                    "errorJson" = ?, "updatedAt" = ?
                WHERE "id" = ? AND "organizationId" = 'local-org'`,
          args: [
            now,
            JSON.stringify({
              code: "workspace-recovery-quarantined",
              incidentId: retryRecoveryIncidentId,
              reasonCode: retryRecoveryReasonCode,
            }),
            now,
            retryRecoveryJobId,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionAttempt" (
                  "id", "organizationId", "jobId", "number", "runtimeId",
                  "status", "generation", "capacityReserved", "errorJson",
                  "startedAt", "finishedAt", "createdAt", "updatedAt"
                ) VALUES (?, 'local-org', ?, 1, NULL, 'quarantined', 1, FALSE, ?, ?, NULL, ?, ?)`,
          args: [
            retryRecoveryAttemptId,
            retryRecoveryJobId,
            JSON.stringify({
              code: "workspace-recovery-quarantined",
              incidentId: retryRecoveryIncidentId,
              reasonCode: retryRecoveryReasonCode,
            }),
            now,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionRecoveryIncident" (
                  "id", "organizationId", "jobId", "attemptId", "generation",
                  "stage", "reasonCode", "classification", "discardable",
                  "status", "revision", "createdAt", "updatedAt"
                ) VALUES (?, 'local-org', ?, ?, 1, ?, ?, ?, FALSE,
                  'open', 1, ?, ?)`,
          args: [
            retryRecoveryIncidentId,
            retryRecoveryJobId,
            retryRecoveryAttemptId,
            retryRecoveryStage,
            retryRecoveryReasonCode,
            retryRecoveryClassification,
            now,
            now,
          ],
        },
        {
          sql: `UPDATE "ExecutionJob"
                SET "status" = 'blocked', "startedAt" = ?,
                    "errorJson" = ?, "updatedAt" = ?
                WHERE "id" = ? AND "organizationId" = 'local-org'`,
          args: [
            now,
            JSON.stringify({
              code: "workspace-recovery-quarantined",
              incidentId: discardRecoveryIncidentId,
              reasonCode: discardRecoveryReasonCode,
            }),
            now,
            discardRecoveryJobId,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionAttempt" (
                  "id", "organizationId", "jobId", "number", "runtimeId",
                  "status", "generation", "capacityReserved", "errorJson",
                  "startedAt", "finishedAt", "createdAt", "updatedAt"
                ) VALUES (?, 'local-org', ?, 1, NULL, 'quarantined', 1, FALSE, ?, ?, NULL, ?, ?)`,
          args: [
            discardRecoveryAttemptId,
            discardRecoveryJobId,
            JSON.stringify({
              code: "workspace-recovery-quarantined",
              incidentId: discardRecoveryIncidentId,
              reasonCode: discardRecoveryReasonCode,
            }),
            now,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO "ExecutionRecoveryIncident" (
                  "id", "organizationId", "jobId", "attemptId", "generation",
                  "stage", "reasonCode", "classification", "discardable",
                  "status", "revision", "createdAt", "updatedAt"
                ) VALUES (?, 'local-org', ?, ?, 1, ?, ?, ?, TRUE,
                  'open', 1, ?, ?)`,
          args: [
            discardRecoveryIncidentId,
            discardRecoveryJobId,
            discardRecoveryAttemptId,
            discardRecoveryStage,
            discardRecoveryReasonCode,
            discardRecoveryClassification,
            now,
            now,
          ],
        },
      ],
      "write",
    );
  } finally {
    await client.close();
  }

  return {
    answer,
    artifactContent,
    artifactMetadata,
    artifactName,
    cancelGoal,
    cancelJobId,
    discardRecoveryAttemptId,
    discardRecoveryClassification,
    discardRecoveryGoal,
    discardRecoveryIncidentId,
    discardRecoveryJobId,
    discardRecoveryReasonCode,
    discardRecoveryStage,
    inputRequestId,
    logText,
    progressText,
    richGoal,
    richJobId,
    retryRecoveryAttemptId,
    retryRecoveryClassification,
    retryRecoveryGoal,
    retryRecoveryIncidentId,
    retryRecoveryJobId,
    retryRecoveryReasonCode,
    retryRecoveryStage,
    waitingGoal,
    waitingJobId,
    waitingPrompt,
  };
}

async function createBlockedJob(
  base: string,
  input: {
    goal: string;
    maxAttempts: number;
    suffix: string;
    versionId: string;
    workspaceId: string;
  },
) {
  const response = await apiRequest<CreateJobResponse>(
    base,
    "/api/execution-jobs",
    {
      body: {
        documentVersionId: input.versionId,
        goal: input.goal,
        kind: "coding",
        maxAttempts: input.maxAttempts,
        projectId: input.workspaceId,
        requirements: {},
        runtimeSelection: {
          mode: "explicit",
          runtimeId: `e2e-ui-missing-runtime-${input.suffix}`,
        },
        workspaceId: input.workspaceId,
      },
      headers: {
        "x-dao-idempotency-key": `e2e-ui-create-${input.suffix}`,
      },
      method: "POST",
    },
  );
  const jobId = response.receipt?.jobId;
  if (
    response.receipt?.status !== "blocked" ||
    response.receipt?.revision !== 1 ||
    typeof jobId !== "string" ||
    !jobId
  ) {
    throw new Error(
      `Expected a blocked execution receipt, received ${JSON.stringify(response)}`,
    );
  }
  return jobId;
}

async function createAlignedVersion(
  base: string,
  workspaceId: string,
  title: string,
) {
  const version = await apiRequest<{ id?: unknown }>(
    base,
    `/api/workspaces/${encodeURIComponent(workspaceId)}/versions`,
    { body: { title }, method: "POST" },
  );
  if (typeof version.id !== "string" || !version.id) {
    throw new Error(`Expected an immutable version, received ${JSON.stringify(version)}`);
  }
  const alignment = await apiRequest<{ version?: { aligned?: unknown } }>(
    base,
    `/api/workspaces/${encodeURIComponent(workspaceId)}/alignment`,
    { body: { versionId: version.id }, method: "POST" },
  );
  if (alignment.version?.aligned !== true) {
    throw new Error(`Expected an aligned version, received ${JSON.stringify(alignment)}`);
  }
  return version.id;
}

function executionEvent(input: {
  attemptId: string;
  id: string;
  jobId: string;
  now: string;
  payload: Record<string, unknown>;
  runtimeEventId: string;
  sequence: number;
  type: string;
}) {
  return {
    sql: `INSERT INTO "ExecutionEvent" (
            "id", "organizationId", "jobId", "attemptId",
            "sequence", "type", "source", "runtimeEventId",
            "payloadJson", "occurredAt", "createdAt"
          ) VALUES (?, 'local-org', ?, ?, ?, ?, 'runtime', ?, ?, ?, ?)`,
    args: [
      input.id,
      input.jobId,
      input.attemptId,
      input.sequence,
      input.type,
      input.runtimeEventId,
      JSON.stringify(input.payload),
      input.now,
      input.now,
    ],
  };
}

async function readAnswerState(input: ExecutionUiFixtures) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `SELECT job."status" AS "jobStatus",
                   job."revision" AS "jobRevision",
                   attempt."status" AS "attemptStatus",
                   request."status" AS "inputStatus",
                   request."revision" AS "inputRevision",
                   request."responseJson", request."responseId",
                   request."respondedById"
            FROM "ExecutionJob" AS job
            JOIN "ExecutionAttempt" AS attempt ON attempt."jobId" = job."id"
            JOIN "ExecutionInputRequest" AS request
              ON request."attemptId" = attempt."id"
            WHERE job."id" = ? AND request."id" = ?`,
      args: [input.waitingJobId, input.inputRequestId],
    });
    return result.rows[0] || null;
  } finally {
    await client.close();
  }
}

async function readCancelledState(jobId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `SELECT "status", "revision", "cancelRequestedAt", "finishedAt"
            FROM "ExecutionJob"
            WHERE "id" = ? AND "organizationId" = 'local-org'`,
      args: [jobId],
    });
    return result.rows[0] || {};
  } finally {
    await client.close();
  }
}

async function readRecoveryState(incidentId: string, jobId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `SELECT incident."status", incident."requestedAction",
                   incident."resolution", incident."revision",
                   incident."actionRequestedById", incident."actionRequestedAt",
                   incident."resolvedAt", job."status" AS "jobStatus",
                   job."revision" AS "jobRevision",
                   attempt."status" AS "attemptStatus"
            FROM "ExecutionRecoveryIncident" AS incident
            JOIN "ExecutionJob" AS job ON job."id" = incident."jobId"
            JOIN "ExecutionAttempt" AS attempt ON attempt."id" = incident."attemptId"
            WHERE incident."id" = ? AND job."id" = ?
              AND incident."organizationId" = 'local-org'`,
      args: [incidentId, jobId],
    });
    return result.rows[0] || null;
  } finally {
    await client.close();
  }
}

async function readResolvedRecoveryState(incidentId: string) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const result = await client.execute({
      sql: `SELECT "status", "requestedAction", "resolution", "revision",
                   "resolvedAt"
            FROM "ExecutionRecoveryIncident"
            WHERE "id" = ? AND "organizationId" = 'local-org'`,
      args: [incidentId],
    });
    return result.rows[0] || null;
  } finally {
    await client.close();
  }
}

async function resolveRecoveryIncident(input: {
  action: "retry" | "discard";
  attemptId: string;
  incidentId: string;
}) {
  const client = createClient({ url: resolveIterationDatabaseUrl() });
  try {
    const now = new Date().toISOString();
    const resolution =
      input.action === "discard" ? "discarded" : "retried";
    await client.execute({
      sql: `UPDATE "ExecutionRecoveryIncident"
            SET "status" = 'resolved', "resolution" = ?,
                "resolvedAt" = ?, "revision" = "revision" + 1,
                "updatedAt" = ?
            WHERE "id" = ? AND "attemptId" = ?
              AND "organizationId" = 'local-org'
              AND "status" = 'action_requested'
              AND "requestedAction" = ?`,
      args: [
        resolution,
        now,
        now,
        input.incidentId,
        input.attemptId,
        input.action,
      ],
    });
  } finally {
    await client.close();
  }
}

function baseURL(testInfo: TestInfo) {
  return String(testInfo.project.use.baseURL);
}

function jobStatusBadge(detail: Locator, label: string) {
  return detail
    .locator('[data-slot="card-header"]')
    .first()
    .locator('[data-slot="badge"]')
    .filter({ hasText: new RegExp(`^${label}$`) });
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const iterationRoot =
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), ".tmp", "iteration-regression");
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, "app-data");
  return `file:${path.join(appDataRoot, "dev.db")}`;
}
