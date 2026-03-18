import { expect, test } from '@playwright/test';
import { apiRequest, primeClientState, readSeedState } from './helpers';

test('status and context surfaces show draft, active, and archived workflows', async ({
  page,
}, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();

  const draftTitle = `草稿 Workflow ${suffix}`;
  const activeTitle = `激活 Workflow ${suffix}`;
  const archivedTitle = `归档 Workflow ${suffix}`;

  const draftWorkflow = await createWorkflow(baseURL, workspace.id, draftTitle);
  const activeWorkflow = await createWorkflow(baseURL, workspace.id, activeTitle);
  const archivedWorkflow = await createWorkflow(baseURL, workspace.id, archivedTitle);

  await apiRequest(baseURL, '/api/workflows', {
    body: {
      forceActivate: true,
      id: activeWorkflow.id,
      status: 'active',
    },
    method: 'PATCH',
  });
  await apiRequest(baseURL, '/api/workflows', {
    body: {
      id: archivedWorkflow.id,
      status: 'archived',
    },
    method: 'PATCH',
  });
  await apiRequest(baseURL, `/api/workspaces/${workspace.id}/plan`, {
    body: {
      activeWorkflowPlaybookId: activeWorkflow.id,
    },
    method: 'PATCH',
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${workspace.id}?conversationId=${workspace.conversationId}`
  );

  await expect(
    page.getByRole('tabpanel', { name: /状态|Status/ }).getByText(activeTitle, {
      exact: true,
    })
  ).toBeVisible();
  await page.getByRole('tab', { name: /上下文|Context/ }).click();

  const contextPanel = page.getByRole('tabpanel', { name: /上下文|Context/ });
  await expect(contextPanel.getByText(/已激活 Workflow（\d+）/)).toBeVisible();
  await expect(contextPanel.getByText('草稿 Workflow（1）')).toBeVisible();
  await expect(contextPanel.getByText('已归档 Workflow（1）')).toBeVisible();
  await expect(contextPanel.getByText(activeTitle, { exact: true })).toBeVisible();
  await expect(contextPanel.getByText(draftTitle, { exact: true })).toBeVisible();
  await expect(contextPanel.getByText(archivedTitle, { exact: true })).toBeVisible();
  expect(draftWorkflow.id).toBeTruthy();
});

test('built-in workflows can be applied from context and become the active method', async ({
  page,
}, testInfo) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /上下文|Context/ }).click();

  const contextPanel = page.getByRole('tabpanel', { name: /上下文|Context/ });
  await expect(contextPanel.getByText('内置 Workflow（2）')).toBeVisible();

  const builtinCard = contextPanel
    .locator('div.rounded-lg.border.p-3.text-xs')
    .filter({ hasText: /需求规格到网页上线/ })
    .first();
  await expect(builtinCard).toBeVisible();
  await expect(builtinCard).toContainText(/Tools/);
  await expect(builtinCard).toContainText(/MCP/);
  await expect(builtinCard).toContainText(/Skills/);
  await builtinCard.getByRole('button', { name: /用于当前任务|Use for Task/ }).click();

  await page.getByRole('tab', { name: /状态|Status/ }).click();
  await expect(
    page.getByRole('tabpanel', { name: /状态|Status/ }).getByText(/需求规格到网页上线/)
  ).toBeVisible();
  await expect(
    page.getByRole('tabpanel', { name: /状态|Status/ }).getByText(/开放扩展|Open Extensions/)
  ).toBeVisible();
});

test('custom workflow extension hints persist across context and status surfaces', async ({
  page,
}) => {
  const seedState = readSeedState();
  const workspace = seedState.baseWorkspace;
  const suffix = Date.now();
  const title = `开放扩展 Workflow ${suffix}`;
  const toolsHint = '调用页面预览与自动验收工具。';
  const mcpHint = '接入部署平台与设计系统。';
  const skillsHint = '沉淀实现与验收方法。';

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByRole('tab', { name: /上下文|Context/ }).click();

  const contextPanel = page.getByRole('tabpanel', { name: /上下文|Context/ });
  await contextPanel.getByPlaceholder(/Workflow title|Workflow 标题/).fill(title);
  await contextPanel.getByLabel(/步骤|Steps/).fill('澄清目标\n实现结果\n确认交付');
  await contextPanel.getByLabel(/约束|Constraints/).fill('保持范围收敛\n沿用当前项目语境');
  await contextPanel.getByLabel(/检查项|Checklist/).fill('确认结果可复用\n确认验收闭环');
  await contextPanel.getByLabel(/^Tools$/).fill(toolsHint);
  await contextPanel.getByLabel(/^MCP$/).fill(mcpHint);
  await contextPanel.getByLabel(/^Skills$/).fill(skillsHint);
  await contextPanel.getByRole('button', { name: /保存 Workflow|Save Workflow/ }).click();

  const draftCard = contextPanel
    .locator('div.rounded-lg.border.p-3.text-xs')
    .filter({ hasText: title })
    .first();
  await expect(draftCard).toBeVisible();
  await expect(draftCard).toContainText(toolsHint);
  await expect(draftCard).toContainText(mcpHint);
  await expect(draftCard).toContainText(skillsHint);
  await draftCard.getByRole('button', { name: /激活|Activate/ }).click();

  const activeCard = contextPanel
    .locator('div.rounded-lg.border.p-3.text-xs')
    .filter({ hasText: title })
    .first();
  await expect(activeCard).toContainText(/已激活|Active/);
  await activeCard.getByRole('button', { name: /用于当前任务|Use for Task/ }).click();

  await page.reload();
  await page.getByRole('tab', { name: /上下文|Context/ }).click();

  const reloadedContextPanel = page.getByRole('tabpanel', { name: /上下文|Context/ });
  const persistedCard = reloadedContextPanel
    .locator('div.rounded-lg.border.p-3.text-xs')
    .filter({ hasText: title })
    .first();
  await expect(persistedCard).toContainText(toolsHint);
  await expect(persistedCard).toContainText(mcpHint);
  await expect(persistedCard).toContainText(skillsHint);

  await page.getByRole('tab', { name: /状态|Status/ }).click();
  const statusPanel = page.getByRole('tabpanel', { name: /状态|Status/ });
  await expect(statusPanel.getByText(title, { exact: true })).toBeVisible();
  await expect(statusPanel.getByText(/^开放扩展$|^Open Extensions$/)).toBeVisible();
  await expect(statusPanel).toContainText(/Tools/);
  await expect(statusPanel).toContainText(/MCP/);
  await expect(statusPanel).toContainText(/Skills/);
});

test('finalized deliverables can start the next deliverable in the same project with the active workflow', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const workspace = await createWorkspace(baseURL, `下一交付物项目 ${suffix}`);
  const activeWorkflow = await createWorkflow(
    baseURL,
    workspace.id,
    `延续方法 Workflow ${suffix}`
  );

  await apiRequest(baseURL, '/api/workflows', {
    body: {
      forceActivate: true,
      id: activeWorkflow.id,
      status: 'active',
    },
    method: 'PATCH',
  });
  await apiRequest(baseURL, `/api/workspaces/${workspace.id}/plan`, {
    body: {
      activeWorkflowPlaybookId: activeWorkflow.id,
    },
    method: 'PATCH',
  });
  await createVersion(baseURL, workspace.id, `完成稿 ${suffix}`);

  const originalView = await getWorkspaceView(baseURL, workspace.id, workspace.conversationId);

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);

  const nextDeliverableCard = page.getByTestId('plan-next-deliverable-card');
  await expect(nextDeliverableCard).toBeVisible();
  await expect(nextDeliverableCard).toContainText(activeWorkflow.title);

  await page.getByTestId('plan-next-deliverable-action').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(activeWorkflow.title);
  await expect(dialog.getByTestId('goal-deliverable-pill')).toContainText(/文档|Document/);
  await expect(
    dialog.getByRole('button', { name: /创建交付物|Create Deliverable/ })
  ).toBeVisible();

  await dialog
    .getByLabel(/目标|Goal/)
    .fill('为同一项目继续创建下一份执行摘要。');
  await dialog.getByRole('button', { name: /创建交付物|Create Deliverable/ }).click();

  await expect
    .poll(() => {
      const currentUrl = new URL(page.url());
      return currentUrl.pathname.split('/').pop() || '';
    })
    .not.toBe(workspace.id);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('conversationId') || '')
    .not.toBe(workspace.conversationId);

  const nextUrl = new URL(page.url());
  const nextWorkspaceId = nextUrl.pathname.split('/').pop() || '';
  const nextConversationId = nextUrl.searchParams.get('conversationId') || '';

  expect(nextWorkspaceId).toBeTruthy();
  expect(nextConversationId).toBeTruthy();

  const nextView = await getWorkspaceView(baseURL, nextWorkspaceId, nextConversationId);

  expect(nextView.currentProject?.id).toBe(originalView.currentProject?.id);
  expect(nextView.workspace?.projectId).toBe(originalView.workspace?.projectId);
  expect(nextView.workspace?.projectFolderId).toBe(originalView.workspace?.projectFolderId);
  expect(nextView.workspacePlan?.activeWorkflowPlaybookId).toBe(activeWorkflow.id);
  await expect(
    page.getByRole('tabpanel', { name: /状态|Status/ }).getByText(activeWorkflow.title, {
      exact: true,
    })
  ).toBeVisible();
});

test('workspace header shows the project path and keeps sibling creation in the same folder', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `项目路径 ${suffix}`;
  const folderTitle = `执行摘要 ${suffix}`;
  const siblingTitle = `同级交付物 ${suffix}`;

  const projectWorkspace = await createWorkspace(baseURL, projectTitle);
  const projectView = await getWorkspaceView(
    baseURL,
    projectWorkspace.id,
    projectWorkspace.conversationId
  );
  const projectId = projectView.currentProject?.id || projectView.workspace?.projectId || null;

  expect(projectId).toBeTruthy();
  if (!projectId) {
    throw new Error('Project id should exist for project path coverage.');
  }

  const projectFolder = await createProjectFolder(baseURL, projectId, folderTitle);
  const currentWorkspace = await createWorkspace(baseURL, siblingTitle, {
    goal: '当前交付物属于项目子目录，需要继续创建同级交付物。',
    projectFolderId: projectFolder.id,
    projectId,
    projectTitle,
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${currentWorkspace.id}?conversationId=${currentWorkspace.conversationId}`
  );

  await expect(page.getByText(`${projectTitle} / ${folderTitle}`)).toBeVisible();
  await expect(page.getByTestId('workspace-new-sibling-deliverable')).toBeVisible();

  await page.getByTestId('workspace-new-sibling-deliverable').click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(projectTitle);
  await dialog.getByLabel(/目标|Goal/).fill('沿着同一项目目录继续创建下一份交付物。');
  await dialog.getByRole('button', { name: /创建交付物|Create Deliverable/ }).click();

  await expect
    .poll(() => {
      const currentUrl = new URL(page.url());
      return currentUrl.pathname.split('/').pop() || '';
    })
    .not.toBe(currentWorkspace.id);
  await expect
    .poll(() => new URL(page.url()).searchParams.get('conversationId') || '')
    .not.toBe(currentWorkspace.conversationId);

  const nextUrl = new URL(page.url());
  const nextWorkspaceId = nextUrl.pathname.split('/').pop() || '';
  const nextConversationId = nextUrl.searchParams.get('conversationId') || '';

  expect(nextWorkspaceId).toBeTruthy();
  expect(nextConversationId).toBeTruthy();

  const nextView = await getWorkspaceView(baseURL, nextWorkspaceId, nextConversationId);

  expect(nextView.currentProject?.id).toBe(projectId);
  expect(nextView.workspace?.projectId).toBe(projectId);
  expect(nextView.workspace?.projectFolderId).toBe(projectFolder.id);
  await expect(page.getByText(`${projectTitle} / ${folderTitle}`)).toBeVisible();
});

test('workspace header can switch to another deliverable in the same project', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `项目切换 ${suffix}`;
  const secondTitle = `后续交付物 ${suffix}`;

  const firstWorkspace = await createWorkspace(baseURL, projectTitle);
  const firstView = await getWorkspaceView(
    baseURL,
    firstWorkspace.id,
    firstWorkspace.conversationId
  );
  const projectId = firstView.currentProject?.id || firstView.workspace?.projectId || null;

  expect(projectId).toBeTruthy();
  if (!projectId) {
    throw new Error('Project id should exist for deliverable switch coverage.');
  }

  const secondWorkspace = await createWorkspace(baseURL, secondTitle, {
    goal: '同一项目里还有另一份交付物，需要直接切换过去继续工作。',
    projectId,
    projectTitle,
  });

  await primeClientState(page);
  await page.goto(`/workspace/${firstWorkspace.id}?conversationId=${firstWorkspace.conversationId}`);

  const switcher = page.getByTestId('workspace-switch-deliverable');
  await expect(switcher).toContainText(projectTitle);

  await switcher.click();
  await page
    .getByTestId(`workspace-switch-deliverable-${secondWorkspace.id}`)
    .click();

  await expect
    .poll(() => {
      const currentUrl = new URL(page.url());
      return currentUrl.pathname.split('/').pop() || '';
    })
    .toBe(secondWorkspace.id);
  await expect(switcher).toContainText(secondTitle);
});

async function createWorkflow(baseURL: string, workspaceId: string, title: string) {
  return apiRequest<{ id: string; title: string }>(baseURL, '/api/workflows', {
    body: {
      checklist: ['检查关键信息', '确认最终输出'],
      constraints: ['保持中文输出', '避免重复表达'],
      content: `${title} 的完整方法说明`,
      steps: ['澄清目标', '整理结构', '输出最终稿'],
      summary: `${title} 的摘要`,
      title,
      workspaceId,
    },
    method: 'POST',
  });
}

async function createVersion(baseURL: string, workspaceId: string, title: string) {
  return apiRequest<{ id: string }>(baseURL, `/api/workspaces/${workspaceId}/versions`, {
    body: { title },
    method: 'POST',
  });
}

async function createProjectFolder(baseURL: string, projectId: string, title: string) {
  return apiRequest<{ id: string; title: string }>(baseURL, `/api/projects/${projectId}/folders`, {
    body: { title },
    method: 'POST',
  });
}

type CreateWorkspaceOptions = {
  goal?: string;
  projectFolderId?: string | null;
  projectId?: string | null;
  projectTitle?: string | null;
};

async function createWorkspace(
  baseURL: string,
  title: string,
  options?: CreateWorkspaceOptions
) {
  const payload = await apiRequest<{
    conversation: { id: string };
    workspace: { id: string };
  }>(baseURL, '/api/workspaces', {
    body: {
      deliverableType: 'document',
      goal:
        options?.goal ||
        `${title} 的当前交付物已经完成，需要继续下一个交付物。`,
      projectFolderId: options?.projectFolderId || null,
      projectId: options?.projectId || null,
      projectTitle: options?.projectTitle || null,
      title,
    },
    method: 'POST',
  });

  return {
    conversationId: payload.conversation.id,
    id: payload.workspace.id,
  };
}

async function getWorkspaceView(
  baseURL: string,
  workspaceId: string,
  conversationId: string
) {
  return apiRequest<{
    currentProject: { id: string; title: string } | null;
    workspace: { projectFolderId: string | null; projectId: string; projectTitle?: string | null } | null;
    workspacePlan: { activeWorkflowPlaybookId: string | null } | null;
  }>(baseURL, `/api/workspaces/${workspaceId}?conversationId=${conversationId}`);
}
