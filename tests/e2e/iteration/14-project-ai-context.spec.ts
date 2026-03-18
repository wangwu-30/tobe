import { expect, test } from '@playwright/test';
import { apiRequest } from './helpers';

test('project AI context exposes sibling deliverable summaries and explicit cross-deliverable reads', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `品牌官网项目 ${suffix}`;
  const faqTitle = `FAQ ${suffix}`;
  const homepageCopy = '首页主视觉强调亮色品牌感与立即咨询按钮。';
  const projectKnowledge = '项目级知识：整体品牌语调保持明亮、直接、可信。';
  const projectMemory = '项目级记忆：所有交付物统一使用“立即咨询”作为主 CTA。';

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
  await createKnowledge(baseURL, {
    content: projectKnowledge,
    title: '品牌语调',
    wikiId: projectId,
  });
  await createMemory(baseURL, {
    category: 'copy',
    content: projectMemory,
    wikiId: projectId,
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
  expect(debugContext.systemPrompt).toContain('(web, status:');
  expect(debugContext.systemPrompt).toContain('(document, status:');
  expect(debugContext.systemPrompt).toContain(projectKnowledge);
  expect(debugContext.systemPrompt).toContain(projectMemory);

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
  expect(workspaceContextTool?.text).toContain(projectKnowledge);
  expect(workspaceContextTool?.text).toContain(projectMemory);

  const siblingReadTool = debugContext.toolResults.find(
    (result) => result.name === 'read_project_deliverable_file'
  );
  expect(siblingReadTool?.text).toContain(`Deliverable: ${projectTitle}`);
  expect(siblingReadTool?.text).toContain(`Workspace ID: ${homepage.id}`);
  expect(siblingReadTool?.text).toContain(homepageCopy);
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

async function createKnowledge(
  baseURL: string,
  body: {
    content: string;
    title: string;
    wikiId: string;
  }
) {
  return apiRequest(baseURL, '/api/knowledge', {
    body,
    method: 'POST',
  });
}

async function createMemory(
  baseURL: string,
  body: {
    category: string;
    content: string;
    wikiId: string;
  }
) {
  return apiRequest(baseURL, '/api/memories', {
    body,
    method: 'POST',
  });
}
