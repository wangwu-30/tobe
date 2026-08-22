import { expect, test, type TestInfo } from "@playwright/test";

import { apiRequest, primeClientState, readSeedState } from "./helpers";

type TaskStatus =
  | "open"
  | "claimed"
  | "in_progress"
  | "blocked"
  | "review"
  | "done"
  | "cancelled";

type TaskKind = "execution" | "help";

type AgentProfile = {
  id: string;
  name: string;
  organizationId: string;
};

type TaskActivity = {
  actorId: string;
  actorType: "user" | "agent";
  id: string;
  message: string;
  taskId: string;
  type: string;
};

type TeamTask = {
  activities?: TaskActivity[];
  assigneeId: string | null;
  assigneeType: "user" | "agent" | null;
  createdById: string;
  createdByType: "user" | "agent";
  description: string;
  id: string;
  kind: TaskKind;
  organizationId: string;
  priority: number;
  projectId: string | null;
  revision: number;
  status: TaskStatus;
  threadId: string | null;
  title: string;
  updatedAt: string;
  workspaceId: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function unwrapItem<T>(payload: unknown): T {
  const record = asRecord(payload);
  return (record.item || record.task || payload) as T;
}

function unwrapItems<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  const record = asRecord(payload);
  const items = record.items || record.tasks || record.agents || [];
  return Array.isArray(items) ? (items as T[]) : [];
}

function uniqueSuffix(testInfo: TestInfo) {
  return `${Date.now()}-${testInfo.workerIndex}`;
}

async function createTask(
  baseURL: string,
  input: {
    description: string;
    kind: TaskKind;
    priority?: number;
    title: string;
  },
): Promise<TeamTask> {
  const payload = await apiRequest<unknown>(baseURL, "/api/tasks", {
    body: input,
    method: "POST",
  });

  return unwrapItem<TeamTask>(payload);
}

async function transitionTask(
  baseURL: string,
  taskId: string,
  status: TaskStatus,
  details?: Record<string, unknown>,
): Promise<TeamTask> {
  const payload = await apiRequest<unknown>(baseURL, `/api/tasks/${taskId}`, {
    body: { status, ...details },
    method: "PATCH",
  });

  const task = unwrapItem<TeamTask>(payload);
  expect(task.status).toBe(status);
  return task;
}

test("team task API creates and filters centralized task records", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);
  const helpTitle = `E2E 团队求助 ${suffix}`;
  const executionTitle = `E2E 执行任务 ${suffix}`;

  const helpTask = await createTask(baseURL, {
    description: "需要另一位团队成员核对验收边界。",
    kind: "help",
    priority: 3,
    title: helpTitle,
  });
  await createTask(baseURL, {
    description: "完成任务中心的常规执行工作。",
    kind: "execution",
    priority: 1,
    title: executionTitle,
  });

  expect(helpTask).toMatchObject({
    createdById: "local-user",
    createdByType: "user",
    description: "需要另一位团队成员核对验收边界。",
    kind: "help",
    organizationId: "local-org",
    priority: 3,
    projectId: null,
    status: "open",
    title: helpTitle,
    workspaceId: null,
  });

  const filteredPayload = await apiRequest<unknown>(
    baseURL,
    "/api/tasks?status=open&kind=help",
  );
  const filteredTasks = unwrapItems<TeamTask>(filteredPayload);

  expect(filteredTasks.some((task) => task.id === helpTask.id)).toBe(true);
  expect(filteredTasks.some((task) => task.title === executionTitle)).toBe(
    false,
  );
  expect(filteredTasks.every((task) => task.status === "open")).toBe(true);
  expect(filteredTasks.every((task) => task.kind === "help")).toBe(true);

  const agentPayload = await apiRequest<unknown>(baseURL, "/api/agents");
  const agents = unwrapItems<AgentProfile>(agentPayload);

  expect(agents.length).toBeGreaterThan(0);
  expect(agents[0]).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      name: expect.any(String),
      organizationId: "local-org",
    }),
  );
});

test("publish_team_task creates an agent-owned help task linked to the current workspace", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const workspace = readSeedState().baseWorkspace;
  const title = `E2E Agent 求助 ${uniqueSuffix(testInfo)}`;
  const debugPayload = await apiRequest<{
    toolResults?: Array<{ details?: unknown; name?: string }>;
  }>(baseURL, "/api/debug/ai/context", {
    body: {
      conversationId: workspace.conversationId,
      toolCalls: [
        {
          name: "publish_team_task",
          params: {
            description: "当前执行被专业问题阻塞，需要团队成员协助。",
            kind: "help",
            priority: 2,
            title,
          },
        },
      ],
      workspaceId: workspace.id,
    },
    method: "POST",
  });
  const toolResult = debugPayload.toolResults?.find(
    (result: { name?: string }) => result.name === "publish_team_task",
  );
  const task = toolResult?.details as TeamTask | undefined;

  expect(task).toMatchObject({
    createdByType: "agent",
    kind: "help",
    organizationId: "local-org",
    projectId: workspace.id,
    threadId: null,
    title,
    workspaceId: workspace.id,
  });

  const listPayload = await apiRequest<unknown>(
    baseURL,
    `/api/tasks?workspaceId=${encodeURIComponent(workspace.id)}&kind=help`,
  );
  const persisted = unwrapItems<TeamTask>(listPayload).find(
    (candidate) => candidate.id === task?.id,
  );

  expect(persisted).toMatchObject({
    createdByType: "agent",
    id: task?.id,
    kind: "help",
    projectId: workspace.id,
    threadId: null,
    workspaceId: workspace.id,
  });
});

test("task and activity APIs derive user identity instead of trusting caller-supplied actors", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);
  const createPayload = await apiRequest<unknown>(baseURL, "/api/tasks", {
    body: {
      createdById: "spoofed-agent",
      createdByType: "agent",
      description: "调用方不能伪造任务创建身份。",
      kind: "execution",
      priority: 1,
      title: `E2E 身份防伪 ${suffix}`,
    },
    method: "POST",
  });
  const task = unwrapItem<TeamTask>(createPayload);

  expect(task).toMatchObject({
    createdById: "local-user",
    createdByType: "user",
  });

  const message = `调用方不能伪造活动身份 ${suffix}`;
  const activityPayload = await apiRequest<unknown>(
    baseURL,
    `/api/tasks/${task.id}/activities`,
    {
      body: {
        actorId: "spoofed-agent",
        actorType: "agent",
        message,
        type: "comment",
      },
      method: "POST",
    },
  );
  const activityResponse = asRecord(activityPayload);
  const activity = unwrapItem<TaskActivity>(
    activityResponse.activity || activityPayload,
  );

  expect(activity).toMatchObject({
    actorId: "local-user",
    actorType: "user",
    message,
    taskId: task.id,
    type: "comment",
  });
});

test("task assignment rejects unknown organization members and agents", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);

  for (const assignment of [
    { assigneeId: `missing-user-${suffix}`, assigneeType: "user" },
    { assigneeId: `missing-agent-${suffix}`, assigneeType: "agent" },
  ]) {
    const response = await fetch(`${baseURL}/api/tasks`, {
      body: JSON.stringify({
        ...assignment,
        description: "无效负责人不应写入任务。",
        kind: "execution",
        title: `E2E 无效负责人 ${suffix}`,
      }),
      headers: {
        "content-type": "application/json",
        "x-dao-device-id": "local-device",
        "x-dao-organization-id": "local-org",
        "x-dao-user-id": "local-user",
      },
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ kind: "validation" }),
    );
  }
});

test("task PATCH rejects a stale expectedUpdatedAt even when status is unchanged", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);
  const task = await createTask(baseURL, {
    description: "验证同状态详情更新不会覆盖并发结果。",
    kind: "execution",
    title: `E2E 并发版本 ${suffix}`,
  });
  const originalUpdatedAt = task.updatedAt;
  const originalRevision = task.revision;
  const first = await apiRequest<unknown>(baseURL, `/api/tasks/${task.id}`, {
    body: {
      description: "第一个更新已经提交。",
      expectedUpdatedAt: originalUpdatedAt,
      expectedRevision: originalRevision,
    },
    method: "PATCH",
  });
  expect(unwrapItem<TeamTask>(first).description).toBe("第一个更新已经提交。");

  const staleResponse = await fetch(`${baseURL}/api/tasks/${task.id}`, {
    body: JSON.stringify({
      description: "陈旧更新不应覆盖。",
      expectedUpdatedAt: originalUpdatedAt,
      expectedRevision: originalRevision,
    }),
    headers: {
      "content-type": "application/json",
      "x-dao-device-id": "local-device",
      "x-dao-organization-id": "local-org",
      "x-dao-user-id": "local-user",
    },
    method: "PATCH",
  });

  expect(staleResponse.status).toBe(409);
  await expect(staleResponse.json()).resolves.toEqual(
    expect.objectContaining({ kind: "conflict" }),
  );
});

test("task activity API rejects forged system lifecycle events", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);
  const task = await createTask(baseURL, {
    description: "系统活动只能由任务命令生成。",
    kind: "execution",
    title: `E2E 活动白名单 ${suffix}`,
  });
  const response = await fetch(`${baseURL}/api/tasks/${task.id}/activities`, {
    body: JSON.stringify({
      message: "伪造任务已经完成。",
      type: "status_changed",
    }),
    headers: {
      "content-type": "application/json",
      "x-dao-device-id": "local-device",
      "x-dao-organization-id": "local-org",
      "x-dao-user-id": "local-user",
    },
    method: "POST",
  });

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ kind: "validation" }),
  );
});

test("draft execution action fails closed until an immutable version exists", async ({
  page,
}) => {
  const workspace = readSeedState().baseWorkspace;
  let submittedBody: Record<string, unknown> | null = null;

  await page.route("**/api/execution-runtimes", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ schemaVersion: 1, runtimes: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/execution-jobs", async (route) => {
    expect(route.request().method()).toBe("POST");
    submittedBody = asRecord(route.request().postDataJSON());
    await route.abort();
  });

  await primeClientState(page);
  await page.goto(
    "/workspace/" +
      encodeURIComponent(workspace.id) +
      "?conversationId=" +
      encodeURIComponent(workspace.conversationId),
  );

  const statusTab = page.getByTestId("assistant-tab-status");
  await expect(statusTab).toHaveAttribute("data-state", "active");
  await page.getByTestId("workspace-start-agent").click();

  const dialog = page.getByTestId("workspace-execution-dialog");
  await expect(dialog).toBeVisible();
  await expect(statusTab).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("assistant-tab-chat")).toHaveAttribute(
    "data-state",
    "inactive",
  );

  const goalInput = dialog.getByTestId("workspace-execution-goal-input");
  await expect(goalInput).not.toHaveValue("");
  const submittedGoal = await goalInput.inputValue();
  await expect(
    dialog.getByTestId("workspace-execution-runtime-select"),
  ).toContainText(/Auto/);
  await expect(dialog.getByTestId("workspace-execution-alignment")).toContainText(
    /草稿还不能用于执行|Draft is not ready for execution/,
  );
  await expect(
    dialog.getByTestId("workspace-execution-create-version"),
  ).toBeVisible();
  await expect(
    dialog.getByTestId("workspace-execution-create-version"),
  ).not.toBeFocused();
  await expect(dialog.getByTestId("workspace-execution-submit")).toBeDisabled();
  expect(submittedGoal).not.toBe("");
  expect(submittedBody).toBeNull();
});

test("selected-version Start Agent request preserves the immutable version context", async ({
  page,
}) => {
  const workspace = readSeedState().branchVersionWorkspace;
  if (!workspace.versionId) {
    throw new Error("Expected the branch-version workspace to have a version");
  }

  const selectedVersionId = workspace.versionId;
  const jobId = "e2e-versioned-execution-job";
  let submittedBody: Record<string, unknown> | null = null;

  await page.route("**/api/execution-runtimes", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ schemaVersion: 1, runtimes: [] }),
      contentType: "application/json",
      status: 200,
    });
  });
  await page.route("**/api/execution-jobs", async (route) => {
    expect(route.request().method()).toBe("POST");
    submittedBody = asRecord(route.request().postDataJSON());
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        receipt: {
          schemaVersion: 1,
          acceptedAt: "2026-08-21T12:00:00.000Z",
          jobId,
          revision: 1,
          selectedRuntimeId: null,
          selection: {
            schemaVersion: 1,
            evaluations: [],
            failure: {
              code: "no-compatible-runtime",
              message: "No compatible runtime is registered.",
            },
            matched: false,
            selected: null,
          },
          status: "blocked",
          teamTaskId: null,
        },
      }),
      contentType: "application/json",
      status: 202,
    });
  });
  await page.route("**/api/workspaces/*/alignment", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(asRecord(route.request().postDataJSON())).toEqual({
      versionId: selectedVersionId,
    });
    await route.fulfill({
      body: JSON.stringify({
        schemaVersion: 1,
        version: { aligned: true, id: selectedVersionId, visible: true },
      }),
      contentType: "application/json",
      status: 200,
    });
  });

  await primeClientState(page);
  await page.goto(
    "/workspace/" +
      encodeURIComponent(workspace.id) +
      "?conversationId=" +
      encodeURIComponent(workspace.conversationId) +
      "&versionId=" +
      encodeURIComponent(selectedVersionId),
  );

  await expect(page.getByTestId("first-use-guide-version")).toBeVisible();
  await page.getByTestId("workspace-start-agent").click();

  const dialog = page.getByTestId("workspace-execution-dialog");
  await expect(dialog).toBeVisible();
  const goalInput = dialog.getByTestId("workspace-execution-goal-input");
  await expect(goalInput).not.toHaveValue("");
  const submittedGoal = await goalInput.inputValue();
  await dialog.getByTestId("workspace-execution-align-version").click();
  await expect(dialog.getByTestId("workspace-execution-alignment")).toContainText(
    /已对齐版本|Aligned version ready/,
  );
  await expect(dialog.getByTestId("workspace-execution-submit")).toBeEnabled();
  await dialog.getByTestId("workspace-execution-submit").click();
  await expect(dialog.getByTestId("workspace-execution-result")).toBeVisible();

  expect(submittedBody).toEqual({
    conversationId: workspace.conversationId,
    documentVersionId: selectedVersionId,
    goal: submittedGoal,
    kind: "coding",
    projectId: workspace.id,
    requirements: {},
    runtimeSelection: { mode: "auto" },
    workspaceId: workspace.id,
  });
  expect(submittedBody).not.toHaveProperty("contextManifest");
  expect(submittedBody).not.toHaveProperty("organizationPolicy");
  expect(submittedBody).not.toHaveProperty("agentPreference");
});

test("aligned document action preserves the active chat and its existing draft", async ({
  page,
}) => {
  const workspace = readSeedState().baseWorkspace;
  const existingDraft = "Keep this unsent draft exactly as written.";

  await page.route("**/api/execution-runtimes", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ schemaVersion: 1, runtimes: [] }),
      contentType: "application/json",
      status: 200,
    });
  });

  await primeClientState(page);
  await page.goto(
    "/workspace/" +
      encodeURIComponent(workspace.id) +
      "?conversationId=" +
      encodeURIComponent(workspace.conversationId),
  );

  const chatTab = page.getByTestId("assistant-tab-chat");
  const composerInput = page.getByTestId("agent-composer-input");
  await chatTab.click();
  await composerInput.fill(existingDraft);
  await page.getByTestId("workspace-start-agent").click();

  await expect(page.getByTestId("workspace-execution-dialog")).toBeVisible();
  await expect(chatTab).toHaveAttribute("data-state", "active");
  await expect(composerInput).toHaveValue(existingDraft);
});

test("document task composer loads organization Agents", async ({ page }) => {
  const workspace = readSeedState().baseWorkspace;

  await primeClientState(page);
  await page.goto(
    "/workspace/" +
      encodeURIComponent(workspace.id) +
      "?conversationId=" +
      encodeURIComponent(workspace.conversationId),
  );

  await page.getByTestId("workspace-publish-task").click();
  const composer = page.getByTestId("task-composer-dialog");
  await composer.getByTestId("task-assignee-select").click();

  await expect(page.getByRole("option", { name: /assistant/i })).toBeVisible();
});

test("team task API enforces the centralized lifecycle and records activity", async ({}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);
  const task = await createTask(baseURL, {
    description: "覆盖领取、执行、受阻、恢复、评审和完成。",
    kind: "execution",
    title: `E2E 状态流转 ${suffix}`,
  });

  const claimed = await transitionTask(baseURL, task.id, "claimed");
  expect(claimed).toMatchObject({
    assigneeId: "local-user",
    assigneeType: "user",
  });
  await transitionTask(baseURL, task.id, "in_progress");
  await transitionTask(baseURL, task.id, "blocked", {
    blockedReason: "等待领域专家确认接口约束。",
  });

  const activityText = `等待领域专家确认接口约束 ${suffix}`;
  const activityPayload = await apiRequest<unknown>(
    baseURL,
    `/api/tasks/${task.id}/activities`,
    {
      body: {
        message: activityText,
        type: "comment",
      },
      method: "POST",
    },
  );
  const activityResponse = asRecord(activityPayload);
  const activity = unwrapItem<TaskActivity>(
    activityResponse.activity || activityPayload,
  );
  expect(activity).toMatchObject({
    message: activityText,
    taskId: task.id,
    type: "comment",
  });
  await transitionTask(baseURL, task.id, "in_progress");
  await transitionTask(baseURL, task.id, "review");
  await transitionTask(baseURL, task.id, "done");

  const listPayload = await apiRequest<unknown>(
    baseURL,
    "/api/tasks?status=done",
  );
  const completed = unwrapItems<TeamTask>(listPayload).find(
    (item) => item.id === task.id,
  );

  expect(completed?.status).toBe("done");
});

test("/tasks exposes task creation, filters, and visible centralized tasks", async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);
  const seeded = await createTask(baseURL, {
    description: "这条求助任务应当出现在团队任务中心。",
    kind: "help",
    priority: 3,
    title: `E2E 可见任务 ${suffix}`,
  });

  await primeClientState(page);
  await page.goto("/tasks");

  await expect(
    page.getByRole("heading", { name: /团队任务中心/ }),
  ).toBeVisible();
  await expect(page.getByTestId("create-task-button")).toHaveText(/新建任务/);
  await expect(page.getByTestId("task-search-input")).toHaveAttribute(
    "placeholder",
    "搜索任务…",
  );
  await expect(page.getByTestId("task-status-filter")).toBeVisible();
  await expect(page.getByTestId("task-kind-filter")).toBeVisible();
  await expect(page.getByTestId("task-assignee-filter")).toBeVisible();
  await expect(page.getByText(seeded.title, { exact: true })).toBeVisible();

  const uiTitle = `E2E 页面创建 ${suffix}`;
  await page.getByTestId("create-task-button").click();
  const composer = page.getByTestId("task-composer-dialog");
  await expect(composer).toBeVisible();
  await composer.getByTestId("task-title-input").fill(uiTitle);
  await composer
    .getByTestId("task-description-input")
    .fill("由任务中心表单直接创建的中心化任务。");
  await expect(composer.getByTestId("task-title-input")).toHaveValue(uiTitle);
  await composer.getByTestId("task-create-submit").click();

  await expect(composer).toBeHidden();
  await expect(page.getByText(uiTitle, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByText(uiTitle, { exact: true })).toBeVisible();
});

test("/tasks restores shareable filters from URL and falls back invalid params to safe defaults", async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);
  const sharedTitle = `E2E 分享筛选 求助 ${suffix}`;
  const hiddenTitle = `E2E 分享筛选 执行 ${suffix}`;

  await createTask(baseURL, {
    description: "应当通过 URL 筛选稳定命中这条求助任务。",
    kind: "help",
    priority: 2,
    title: sharedTitle,
  });
  await createTask(baseURL, {
    description: "这条执行任务不应出现在 help 筛选结果中。",
    kind: "execution",
    priority: 1,
    title: hiddenTitle,
  });

  await primeClientState(page);
  await page.goto(
    `/tasks?status=open&kind=help&view=board&q=${encodeURIComponent(
      `分享筛选 ${suffix}`,
    )}`,
  );

  await expect(page.getByTestId("task-board")).toBeVisible();
  await expect(page.getByTestId("task-list")).toHaveCount(0);
  await expect(page.getByTestId("task-status-filter")).toHaveText("待领取");
  await expect(page.getByTestId("task-kind-filter")).toHaveText("求助");
  await expect(page.getByTestId("task-search-input")).toHaveValue(
    `分享筛选 ${suffix}`,
  );
  await expect(page.getByText(sharedTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(hiddenTitle, { exact: true })).toHaveCount(0);

  await page.goto("/tasks?status=unsafe&kind=unsafe&view=unsafe");

  await expect(page.getByTestId("task-list")).toBeVisible();
  await expect(page.getByTestId("task-board")).toHaveCount(0);
  await expect(page.getByTestId("task-status-filter")).toHaveText("进行中");
  await expect(page.getByTestId("task-kind-filter")).toHaveText("全部类型");
  await expect(page.getByTestId("task-search-input")).toHaveValue("");
});

test("/tasks board stays usable on mobile without forcing a full-page 960px canvas", async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = uniqueSuffix(testInfo);

  await createTask(baseURL, {
    description: "移动端看板应保持单列或可横向滑动的分栏，而不是把整页撑宽。",
    kind: "execution",
    priority: 1,
    title: `E2E 移动看板 ${suffix}`,
  });

  await primeClientState(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/tasks?view=board");

  const boardRegion = page.getByRole("region", { name: "看板视图" });
  const board = page.getByTestId("task-board");
  await expect(board).toBeVisible();
  await expect(boardRegion).toHaveAttribute("aria-describedby", "task-board-help");
  await expect(page.getByText("On small screens, swipe sideways between columns.")).toBeVisible();

  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(pageOverflow).toBe(false);

  const boardMetrics = await board.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      columnCount: styles.gridTemplateColumns.split(" ").length,
      scrollWidth: element.scrollWidth,
      width: element.clientWidth,
    };
  });
  expect(boardMetrics.columnCount).toBe(1);
  expect(boardMetrics.scrollWidth).toBeLessThanOrEqual(boardMetrics.width + 1);
});
