import { expect, test } from '@playwright/test';
import {
  apiRequest,
  primeClientState,
} from './helpers';

test('project AI context exposes sibling deliverable summaries and explicit cross-deliverable reads', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `品牌官网项目 ${suffix}`;
  const faqTitle = `FAQ ${suffix}`;
  const homepageCopy = '首页主视觉强调亮色品牌感与立即咨询按钮。';
  const projectKnowledge = '项目级知识：整体品牌语调保持明亮、直接、可信。';
  const projectMemory = '项目级记忆：所有交付物统一使用“立即咨询”作为主 CTA。';
  const userKnowledge = '用户级知识：默认用简洁、务实的中文表达。';
  const userMemory = '用户级记忆：避免浮夸口号。';
  const userScopeId = 'local-user';

  const homepage = await createWorkspace(baseURL, projectTitle);
  const homepageView = await getWorkspaceView(
    baseURL,
    homepage.id,
    homepage.conversationId
  );
  const projectId = homepageView.currentProject?.id || homepageView.workspace?.projectId || null;

  expect(projectId).toBeTruthy();
  if (!projectId) {
    throw new Error('Project id should exist for project AI context coverage.');
  }

  const homepageFileId =
    homepageView.files.find((file) => file.nodeType === 'file' && file.isPrimary)?.id ||
    homepageView.files.find((file) => file.nodeType === 'file')?.id ||
    null;

  expect(homepageFileId).toBeTruthy();
  if (!homepageFileId) {
    throw new Error('A primary file should exist for the root deliverable.');
  }

  await updateWorkspacePlan(baseURL, homepage.id, {
    deliverableType: 'web',
    goal: '沉淀首页视觉与核心转化动线。',
  });
  await updateWorkspaceFile(baseURL, homepage.id, homepageFileId, {
    content: homepageCopy,
    kind: 'text',
  });
  await createNote(baseURL, {
    content: projectKnowledge,
    kind: 'knowledge',
    scope: 'project',
    scopeId: projectId,
    title: '品牌语调',
  });
  await createNote(baseURL, {
    content: projectMemory,
    kind: 'copy',
    scope: 'project',
    scopeId: projectId,
  });
  await createNote(baseURL, {
    content: userKnowledge,
    kind: 'knowledge',
    scope: 'user',
    scopeId: userScopeId,
    title: '表达风格',
  });
  await createNote(baseURL, {
    content: userMemory,
    kind: 'constraint',
    scope: 'user',
    scopeId: userScopeId,
  });

  const faq = await createWorkspace(baseURL, faqTitle, {
    goal: '整理同一项目里的常见问题说明。',
    projectId,
    projectTitle,
  });
  await updateWorkspacePlan(baseURL, faq.id, {
    deliverableType: 'document',
    goal: '整理常见问题并保持与首页一致的品牌风格。',
  });

  const debugContext = await inspectAiContext(baseURL, faq.id, faq.conversationId, [
    { name: 'get_workspace_context' },
    { name: 'list_project_deliverables' },
    {
      name: 'read_project_deliverable_file',
      params: {
        targetWorkspaceId: homepage.id,
      },
    },
  ]);

  expect(debugContext.systemPrompt).toContain('## Current Project Context');
  expect(debugContext.systemPrompt).toContain(projectTitle);
  expect(debugContext.systemPrompt).toContain(faqTitle);
  expect(debugContext.systemPrompt).toContain('(shape: web, status:');
  expect(debugContext.systemPrompt).toContain('(shape: document, status:');
  expect(debugContext.systemPrompt).toContain(projectKnowledge);
  expect(debugContext.systemPrompt).toContain(projectMemory);
  expect(debugContext.systemPrompt).toContain(userKnowledge);
  expect(debugContext.systemPrompt).toContain(userMemory);

  const projectListTool = debugContext.toolResults.find(
    (result) => result.name === 'list_project_deliverables'
  );
  expect(projectListTool?.text).toContain(projectTitle);
  expect(projectListTool?.text).toContain(faqTitle);
  expect(projectListTool?.text).toContain(homepage.id);

  const workspaceContextTool = debugContext.toolResults.find(
    (result) => result.name === 'get_workspace_context'
  );
  expect(workspaceContextTool?.text).toContain('Current project deliverables:');
  expect(workspaceContextTool?.text).toContain(projectTitle);
  expect(workspaceContextTool?.text).toContain(faqTitle);
  expect(workspaceContextTool?.text).toContain('- Result shape: document');
  expect(workspaceContextTool?.text).toContain(projectKnowledge);
  expect(workspaceContextTool?.text).toContain(projectMemory);
  expect(workspaceContextTool?.text).toContain(userKnowledge);
  expect(workspaceContextTool?.text).toContain(userMemory);

  const siblingReadTool = debugContext.toolResults.find(
    (result) => result.name === 'read_project_deliverable_file'
  );
  expect(siblingReadTool?.text).toContain(`Deliverable: ${projectTitle}`);
  expect(siblingReadTool?.text).toContain(`Workspace ID: ${homepage.id}`);
  expect(siblingReadTool?.text).toContain('Result shape: web');
  expect(siblingReadTool?.text).toContain(homepageCopy);
});

test('context panel shows deliverable, project, and user scope notes together', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `Context Panel 项目 ${suffix}`;
  const workspaceTitle = `Context Panel 交付物 ${suffix}`;
  const deliverableKnowledge = `交付物级知识 ${suffix}：当前交付物要保留本地案例细节。`;
  const projectKnowledge = `项目级知识 ${suffix}：整个项目都保持统一品牌术语。`;
  const userMemory = `用户级记忆 ${suffix}：默认使用简洁、克制的中文表达。`;
  const userScopeId = 'local-user';

  const workspace = await createWorkspace(baseURL, workspaceTitle, {
    goal: '验证 context panel 会一起展示多 scope note。',
    projectTitle,
  });
  const workspaceView = await getWorkspaceView(
    baseURL,
    workspace.id,
    workspace.conversationId
  );
  const projectId =
    workspaceView.currentProject?.id || workspaceView.workspace?.projectId || null;

  expect(projectId).toBeTruthy();
  if (!projectId) {
    throw new Error('Project id should exist for context panel scope coverage.');
  }

  const deliverableNote = await createNote(baseURL, {
    content: deliverableKnowledge,
    kind: 'knowledge',
    scope: 'deliverable',
    scopeId: workspace.id,
    title: '交付物细节',
  });
  const projectNote = await createNote(baseURL, {
    content: projectKnowledge,
    kind: 'knowledge',
    scope: 'project',
    scopeId: projectId,
    title: '项目术语',
  });
  const userNote = await createNote(baseURL, {
    content: userMemory,
    kind: 'preference',
    scope: 'user',
    scopeId: userScopeId,
  });

  await primeClientState(page);
  await page.goto(`/workspace/${workspace.id}?conversationId=${workspace.conversationId}`);
  await page.getByTestId('assistant-tab-context').click();

  await expect(page.getByTestId(`context-note-${deliverableNote.id}`)).toContainText(
    deliverableKnowledge
  );
  await expect(page.getByTestId(`context-note-${projectNote.id}`)).toContainText(
    projectKnowledge
  );
  await expect(page.getByTestId(`context-note-${userNote.id}`)).toContainText(userMemory);
  await expect(page.getByTestId(`context-note-scope-${deliverableNote.id}`)).toHaveText(
    '交付物'
  );
  await expect(page.getByTestId(`context-note-scope-${projectNote.id}`)).toHaveText(
    '项目'
  );
  await expect(page.getByTestId(`context-note-scope-${userNote.id}`)).toHaveText('用户');
  await expect(page.getByText('这里新建的知识会保存到交付物。')).toBeVisible();
});

test('context panel can create scoped knowledge and edit existing knowledge scope', async ({
  page,
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `Context Editor 项目 ${suffix}`;
  const workspaceTitle = `Context Editor 交付物 ${suffix}`;
  const updatedProjectKnowledge = `项目级更新知识 ${suffix}：统一叫成交付物而不是文档。`;
  const newUserKnowledge = `用户级新知识 ${suffix}：默认先给简洁结论。`;
  const seededKnowledge = await createWorkspace(baseURL, workspaceTitle, {
    goal: '验证 context panel 的 note 创建与编辑入口。',
    projectTitle,
  });
  const workspaceView = await getWorkspaceView(
    baseURL,
    seededKnowledge.id,
    seededKnowledge.conversationId
  );
  const projectId =
    workspaceView.currentProject?.id || workspaceView.workspace?.projectId || null;

  expect(projectId).toBeTruthy();
  if (!projectId) {
    throw new Error('Project id should exist for context panel edit coverage.');
  }

  const seedNote = await createNote(baseURL, {
    content: '交付物级旧知识：沿用上一版说法。',
    kind: 'knowledge',
    scope: 'deliverable',
    scopeId: seededKnowledge.id,
    title: '旧说法',
  });

  await primeClientState(page);
  await page.goto(
    `/workspace/${seededKnowledge.id}?conversationId=${seededKnowledge.conversationId}`
  );
  await page.getByTestId('assistant-tab-context').click();

  await page.getByTestId(`context-edit-knowledge-${seedNote.id}`).click();
  await page.getByTestId('context-knowledge-title').fill('项目级术语');
  await page.getByTestId('context-knowledge-content').fill(updatedProjectKnowledge);
  await page.getByTestId('context-knowledge-scope-project').click();
  await expect(page.getByText('保存后这条知识会归到项目。')).toBeVisible();
  await page.getByTestId('context-save-knowledge').click();

  await expect(page.getByTestId(`context-note-${seedNote.id}`)).toContainText(
    updatedProjectKnowledge
  );
  await expect(page.getByTestId(`context-note-scope-${seedNote.id}`)).toHaveText('项目');

  const projectNotes = await listNotesForScope(baseURL, {
    scope: 'project',
    scopeId: projectId,
  });
  const deliverableNotes = await listNotesForScope(baseURL, {
    scope: 'deliverable',
    scopeId: seededKnowledge.id,
  });
  expect(projectNotes.some((note) => note.id === seedNote.id)).toBeTruthy();
  expect(deliverableNotes.some((note) => note.id === seedNote.id)).toBeFalsy();

  await page.getByTestId('context-knowledge-title').fill('个人表达偏好');
  await page.getByTestId('context-knowledge-content').fill(newUserKnowledge);
  await page.getByTestId('context-knowledge-scope-user').click();
  await expect(page.getByText('这里新建的知识会保存到用户。')).toBeVisible();
  await page.getByTestId('context-save-knowledge').click();

  const userNotes = await listNotesForScope(baseURL, { scope: 'user' });
  const createdUserNote = userNotes.find((note) => note.content === newUserKnowledge) || null;
  expect(createdUserNote).toBeTruthy();
  if (!createdUserNote) {
    throw new Error('Created user knowledge note should exist.');
  }
  await expect(page.getByTestId(`context-note-${createdUserNote.id}`)).toContainText(
    newUserKnowledge
  );
});

test('project AI context does not misclassify code-like primary files as web without a plan', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `兼容项目 ${suffix}`;
  const referenceTitle = `历史实现说明 ${suffix}`;
  const currentTitle = `当前说明 ${suffix}`;

  const referenceWorkspace = await createWorkspace(baseURL, referenceTitle);
  const referenceView = await getWorkspaceView(
    baseURL,
    referenceWorkspace.id,
    referenceWorkspace.conversationId
  );
  const projectId =
    referenceView.currentProject?.id || referenceView.workspace?.projectId || null;
  const referencePrimaryFileId =
    referenceView.files.find((file) => file.nodeType === 'file' && file.isPrimary)?.id ||
    referenceView.files.find((file) => file.nodeType === 'file')?.id ||
    null;

  expect(projectId).toBeTruthy();
  expect(referencePrimaryFileId).toBeTruthy();
  if (!projectId || !referencePrimaryFileId) {
    throw new Error('Project context fallback coverage requires a project id and primary file.');
  }

  await updateWorkspaceFile(baseURL, referenceWorkspace.id, referencePrimaryFileId, {
    content: 'export const legacySpec = "keep structured notes for implementation handoff";',
    kind: 'code',
  });
  await deleteWorkspacePlan(baseURL, referenceWorkspace.id);

  const currentWorkspace = await createWorkspace(baseURL, currentTitle, {
    goal: '整理当前交付物说明，并读取同项目里的既有需求背景。',
    projectId,
    projectTitle,
  });
  await updateWorkspacePlan(baseURL, currentWorkspace.id, {
    deliverableType: 'document',
    goal: '整理当前交付物说明，并参考同项目的历史实现背景。',
  });

  const debugContext = await inspectAiContext(
    baseURL,
    currentWorkspace.id,
    currentWorkspace.conversationId,
    [{ name: 'list_project_deliverables' }, { name: 'get_workspace_context' }]
  );

  expect(debugContext.systemPrompt).toContain(projectTitle);
  expect(debugContext.systemPrompt).toContain(referenceTitle);
  expect(debugContext.systemPrompt).toContain(currentTitle);
  expect(debugContext.systemPrompt).toContain(`- ${referenceTitle} (shape: document, status:`);
  expect(debugContext.systemPrompt).not.toContain(`- ${referenceTitle} (shape: web, status:`);

  const projectListTool = debugContext.toolResults.find(
    (result) => result.name === 'list_project_deliverables'
  );
  expect(projectListTool?.text).toContain(`- ${referenceTitle} [workspaceId: ${referenceWorkspace.id}] (shape: document, status:`);
  expect(projectListTool?.text).not.toContain(`- ${referenceTitle} [workspaceId: ${referenceWorkspace.id}] (shape: web, status:`);

  const workspaceContextTool = debugContext.toolResults.find(
    (result) => result.name === 'get_workspace_context'
  );
  expect(workspaceContextTool?.text).toContain(`- ${referenceTitle} [workspaceId: ${referenceWorkspace.id}] (shape: document, status:`);
  expect(workspaceContextTool?.text).not.toContain(`- ${referenceTitle} [workspaceId: ${referenceWorkspace.id}] (shape: web, status:`);
});

test('debug AI workspace context details canonicalize legacy stored deliverable types', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const title = `Legacy slides 调试面 ${suffix}`;

  const workspace = await createWorkspace(baseURL, title, {
    goal: '验证 AI debug 详情面不会直接泄漏 legacy slides 类型。',
  });

  await updateWorkspacePlan(baseURL, workspace.id, {
    deliverableType: 'document',
    goal: '把这份交付物作为 slide_page 文档继续推进。',
  });
  await setStoredWorkspaceDeliverableType(baseURL, workspace.id, 'slides');

  const debugContext = await inspectAiContext(
    baseURL,
    workspace.id,
    workspace.conversationId,
    [{ name: 'get_workspace_context' }]
  );

  const workspaceContextTool = debugContext.toolResults.find(
    (result) => result.name === 'get_workspace_context'
  );

  expect(workspaceContextTool?.text).toContain('(shape: slides, status:');
  expect(workspaceContextTool?.text).toContain('- Result shape: slides');
  expect(workspaceContextTool?.details?.workspacePlan?.deliverableType).toBe('document');
  expect(workspaceContextTool?.details?.workspacePlan?.renderAs).toBe('slides');
  expect(workspaceContextTool?.details?.workspacePlan?.storedDeliverableType).toBe('slides');
});

type CreateWorkspaceOptions = {
  goal?: string;
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
      goal: options?.goal || `${title} 的当前交付物需要继续完善。`,
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
    files: Array<{
      id: string;
      isPrimary: boolean;
      nodeType: 'file' | 'folder';
    }>;
    workspace: { projectId: string | null } | null;
  }>(baseURL, `/api/workspaces/${workspaceId}?conversationId=${conversationId}`);
}

async function updateWorkspaceFile(
  baseURL: string,
  workspaceId: string,
  fileId: string,
  body: {
    content: string;
    kind: 'markdown' | 'text' | 'code' | 'richtext';
  }
) {
  return apiRequest(baseURL, `/api/workspaces/${workspaceId}/files/${fileId}`, {
    body,
    method: 'PATCH',
  });
}

async function updateWorkspacePlan(
  baseURL: string,
  workspaceId: string,
  body: {
    deliverableType: 'document' | 'web' | 'slides' | 'code';
    goal: string;
  }
) {
  return apiRequest(baseURL, `/api/workspaces/${workspaceId}/plan`, {
    body,
    method: 'PATCH',
  });
}

async function inspectAiContext(
  baseURL: string,
  workspaceId: string,
  conversationId: string,
  toolCalls: Array<{
    name: string;
    params?: Record<string, unknown>;
  }>
) {
  return apiRequest<{
    systemPrompt: string;
    toolResults: Array<{
      details?: {
        workspacePlan?: {
          deliverableType: 'document' | 'web';
          renderAs: 'document' | 'slides' | 'web';
          storedDeliverableType: 'document' | 'web' | 'slides' | 'code' | null;
        } | null;
      };
      name: string;
      text: string;
    }>;
  }>(baseURL, '/api/debug/ai/context', {
    body: {
      conversationId,
      toolCalls,
      workspaceId,
    },
    method: 'POST',
  });
}

async function deleteWorkspacePlan(baseURL: string, workspaceId: string) {
  return apiRequest<{ ok: true }>(baseURL, `/api/debug/workspaces/${workspaceId}/plan`, {
    method: 'DELETE',
  });
}

async function setStoredWorkspaceDeliverableType(
  baseURL: string,
  workspaceId: string,
  deliverableType: 'document' | 'web' | 'slides' | 'code'
) {
  return apiRequest<{ ok: true }>(baseURL, `/api/debug/workspaces/${workspaceId}/plan`, {
    body: { deliverableType },
    method: 'PATCH',
  });
}

async function createNote(
  baseURL: string,
  body: {
    content: string;
    kind: string;
    scope: 'deliverable' | 'project' | 'user';
    scopeId: string;
    title?: string;
  }
) {
  return apiRequest<{
    id: string;
  }>(baseURL, '/api/notes', {
    body,
    method: 'POST',
  });
}

async function listNotesForScope(
  baseURL: string,
  params: {
    scope: 'deliverable' | 'project' | 'user';
    scopeId?: string;
  }
) {
  const query = new URLSearchParams({
    scope: params.scope,
  });
  if (params.scopeId) {
    query.set('scopeId', params.scopeId);
  }

  return apiRequest<Array<{ content: string; id: string }>>(
    baseURL,
    `/api/notes?${query.toString()}`
  );
}
