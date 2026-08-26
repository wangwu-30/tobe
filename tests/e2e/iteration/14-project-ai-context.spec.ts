import { expect, test } from '@playwright/test';
import { buildWorkspaceRoute } from '@/lib/workspace/route';
import {
  apiRequest,
  primeClientState,
} from './helpers';

test('project AI context exposes sibling node summaries and explicit cross-node reads', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const projectTitle = `品牌官网项目 ${suffix}`;
  const faqTitle = `FAQ ${suffix}`;
  const homepageCopy = '首页主视觉强调亮色品牌感与立即咨询按钮。';
  const faqCopy = 'FAQ 当前 node 需要沿用首页 CTA 和品牌语调来组织答案。';
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
  const faqView = await getWorkspaceView(baseURL, faq.id, faq.conversationId);
  const faqFileId = getPrimaryWorkspaceFileId(faqView);

  expect(faqFileId).toBeTruthy();
  if (!faqFileId) {
    throw new Error('FAQ primary file should exist for current node context coverage.');
  }

  await updateWorkspaceFile(baseURL, faq.id, faqFileId, {
    content: faqCopy,
    kind: 'text',
  });

  const debugContext = await inspectAiContext(baseURL, faq.id, faq.conversationId, [
    { name: 'get_workspace_context' },
    { name: 'list_project_nodes' },
    {
      name: 'read_node_content',
      params: {
        nodeId: homepage.id,
      },
    },
  ]);

  expect(debugContext.systemPrompt).toContain('## Current Project Context');
  expect(debugContext.systemPrompt).toContain('The content is the product.');
  expect(debugContext.systemPrompt).toContain(projectTitle);
  expect(debugContext.systemPrompt).toContain(faqTitle);
  expect(debugContext.systemPrompt).toContain('(shape: web, status:');
  expect(debugContext.systemPrompt).toContain('(shape: document, status:');
  expect(debugContext.systemPrompt).toContain(projectKnowledge);
  expect(debugContext.systemPrompt).toContain(projectMemory);
  expect(debugContext.systemPrompt).toContain(userKnowledge);
  expect(debugContext.systemPrompt).toContain(userMemory);
  expect(debugContext.systemPrompt).toContain(faqCopy);
  expect(debugContext.systemPrompt).toContain('`list_project_nodes`');
  expect(debugContext.systemPrompt).toContain('`read_node_content`');
  expect(debugContext.systemPrompt).not.toContain('`list_project_deliverables`');
  expect(debugContext.systemPrompt).not.toContain('`read_project_deliverable_file`');

  const projectListTool = debugContext.toolResults.find(
    (result) => result.name === 'list_project_nodes'
  );
  expect(projectListTool?.text).toContain(projectTitle);
  expect(projectListTool?.text).toContain(faqTitle);
  expect(projectListTool?.text).toContain(homepage.id);

  const workspaceContextTool = debugContext.toolResults.find(
    (result) => result.name === 'get_workspace_context'
  );
  expect(workspaceContextTool?.text).toContain('Current project nodes:');
  expect(workspaceContextTool?.text).toContain(projectTitle);
  expect(workspaceContextTool?.text).toContain(faqTitle);
  expect(workspaceContextTool?.text).toContain('- Result shape: document');
  expect(workspaceContextTool?.text).toContain(projectKnowledge);
  expect(workspaceContextTool?.text).toContain(projectMemory);
  expect(workspaceContextTool?.text).toContain(userKnowledge);
  expect(workspaceContextTool?.text).toContain(userMemory);

  const siblingReadTool = debugContext.toolResults.find(
    (result) => result.name === 'read_node_content'
  );
  expect(siblingReadTool?.text).toContain(`Node: ${projectTitle}`);
  expect(siblingReadTool?.text).toContain(`Node ID: ${homepage.id}`);
  expect(siblingReadTool?.text).toContain('Result shape: web');
  expect(siblingReadTool?.text).toContain(homepageCopy);
});

test('project AI context injects current node content and limits sibling previews to the five most recent nodes', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const currentTitle = `Current Node ${suffix}`;
  const currentCopy = `Current node content ${suffix}: 这是当前正文，应该被完整注入到默认项目上下文里。`;

  const currentWorkspace = await createWorkspace(baseURL, currentTitle);
  const currentView = await getWorkspaceView(
    baseURL,
    currentWorkspace.id,
    currentWorkspace.conversationId
  );
  const projectId =
    currentView.currentProject?.id || currentView.workspace?.projectId || null;
  const currentFileId = getPrimaryWorkspaceFileId(currentView);

  expect(projectId).toBeTruthy();
  expect(currentFileId).toBeTruthy();
  if (!projectId || !currentFileId) {
    throw new Error('Current project context coverage requires a project id and primary file.');
  }

  await updateWorkspaceFile(baseURL, currentWorkspace.id, currentFileId, {
    content: currentCopy,
    kind: 'text',
  });

  const siblingTitles = Array.from({ length: 6 }, (_, index) => `Sibling ${index + 1} ${suffix}`);
  for (const [index, title] of siblingTitles.entries()) {
    const siblingWorkspace = await createWorkspace(baseURL, title, {
      goal: `${title} 需要进入同项目上下文摘要。`,
      projectId,
      projectTitle: currentTitle,
    });
    const siblingView = await getWorkspaceView(
      baseURL,
      siblingWorkspace.id,
      siblingWorkspace.conversationId
    );
    const siblingFileId = getPrimaryWorkspaceFileId(siblingView);

    expect(siblingFileId).toBeTruthy();
    if (!siblingFileId) {
      throw new Error(`Primary file missing for sibling ${title}.`);
    }

    await updateWorkspaceFile(baseURL, siblingWorkspace.id, siblingFileId, {
      content:
        index === siblingTitles.length - 1
          ? `${title} summary ${suffix} ${'A'.repeat(210)} OMIT-TAIL-${suffix}`
          : `${title} summary ${suffix} ${'B'.repeat(48)}`,
      kind: 'text',
    });
  }

  const debugContext = await inspectAiContext(
    baseURL,
    currentWorkspace.id,
    currentWorkspace.conversationId,
    []
  );

  expect(debugContext.systemPrompt).toContain(currentCopy);
  expect(debugContext.systemPrompt).toContain('Sibling node summaries (top 5 recent):');
  expect(debugContext.systemPrompt).toContain(`Sibling 2 ${suffix}`);
  expect(debugContext.systemPrompt).toContain(`Sibling 3 ${suffix}`);
  expect(debugContext.systemPrompt).toContain(`Sibling 4 ${suffix}`);
  expect(debugContext.systemPrompt).toContain(`Sibling 5 ${suffix}`);
  expect(debugContext.systemPrompt).toContain(`Sibling 6 ${suffix}`);
  expect(debugContext.systemPrompt).not.toContain(`Sibling 1 ${suffix}`);
  expect(debugContext.systemPrompt).toContain('1 more node omitted from default context.');
  expect(debugContext.systemPrompt).not.toContain(`OMIT-TAIL-${suffix}`);
});

test('project AI context injects mounted node titles without mounted content and supports explicit mounted reads', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const sourceProjectTitle = `Mounted Source ${suffix}`;
  const sourceNodeTitle = `Mounted Source Note ${suffix}`;
  const consumerProjectTitle = `Mounted Consumer ${suffix}`;
  const mountedCopy = `Mounted node content ${suffix}: 这是挂载项目里的正文，只能按需读取。`;

  const sourceProject = await createWorkspace(baseURL, sourceProjectTitle);
  const sourceProjectView = await getWorkspaceView(
    baseURL,
    sourceProject.id,
    sourceProject.conversationId
  );
  const sourceProjectId =
    sourceProjectView.currentProject?.id || sourceProjectView.workspace?.projectId || null;

  expect(sourceProjectId).toBeTruthy();
  if (!sourceProjectId) {
    throw new Error('Mounted source project should expose a project id.');
  }

  const sourceNode = await createWorkspace(baseURL, sourceNodeTitle, {
    goal: '这是被 mount 项目里的参考内容。',
    projectId: sourceProjectId,
    projectTitle: sourceProjectTitle,
  });
  const sourceNodeView = await getWorkspaceView(
    baseURL,
    sourceNode.id,
    sourceNode.conversationId
  );
  const sourceNodeFileId = getPrimaryWorkspaceFileId(sourceNodeView);

  expect(sourceNodeFileId).toBeTruthy();
  if (!sourceNodeFileId) {
    throw new Error('Mounted source node should have a primary file.');
  }

  await updateWorkspaceFile(baseURL, sourceNode.id, sourceNodeFileId, {
    content: mountedCopy,
    kind: 'text',
  });

  const consumerProject = await createWorkspace(baseURL, consumerProjectTitle);
  const consumerProjectView = await getWorkspaceView(
    baseURL,
    consumerProject.id,
    consumerProject.conversationId
  );
  const consumerProjectId =
    consumerProjectView.currentProject?.id || consumerProjectView.workspace?.projectId || null;

  expect(consumerProjectId).toBeTruthy();
  if (!consumerProjectId) {
    throw new Error('Mounted consumer project should expose a project id.');
  }

  await createProjectMount(baseURL, consumerProjectId, sourceProjectId);

  const debugContext = await inspectAiContext(
    baseURL,
    consumerProject.id,
    consumerProject.conversationId,
    [
      {
        name: 'list_project_nodes',
        params: {
          projectId: sourceProjectId,
        },
      },
      {
        name: 'read_node_content',
        params: {
          nodeId: sourceNode.id,
          projectId: sourceProjectId,
        },
      },
    ]
  );

  expect(debugContext.systemPrompt).toContain('Mounted project node titles:');
  expect(debugContext.systemPrompt).toContain(sourceProjectTitle);
  expect(debugContext.systemPrompt).toContain(sourceNodeTitle.slice(0, 20));
  expect(debugContext.systemPrompt).toContain(`projectId: ${sourceProjectId}`);
  expect(debugContext.systemPrompt).toContain(`nodeId: ${sourceNode.id}`);
  expect(debugContext.systemPrompt).not.toContain(mountedCopy);

  const mountedNodeList = debugContext.toolResults.find(
    (result) => result.name === 'list_project_nodes'
  );
  expect(mountedNodeList?.text).toContain(sourceProjectTitle);
  expect(mountedNodeList?.text).toContain(sourceNodeTitle.slice(0, 20));
  expect(mountedNodeList?.text).toContain(sourceNode.id);

  const mountedRead = debugContext.toolResults.find(
    (result) => result.name === 'read_node_content'
  );
  expect(mountedRead?.text).toContain(`Project ID: ${sourceProjectId}`);
  expect(mountedRead?.text).toContain(sourceNodeTitle.slice(0, 20));
  expect(mountedRead?.text).toContain(mountedCopy);
});

test('project-scoped conversations keep raw project/message write fields on projectId and focusNodeId', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const rootTitle = `Focus Root ${suffix}`;
  const siblingTitle = `Focus Sibling ${suffix}`;

  const root = await createWorkspace(baseURL, rootTitle);
  const rootView = await getWorkspaceView(baseURL, root.id, root.conversationId);
  const projectId = rootView.currentProject?.id || rootView.workspace?.projectId || null;

  expect(projectId).toBeTruthy();
  if (!projectId) {
    throw new Error('Project id should exist for focus node coverage.');
  }

  const rootFileId = getPrimaryWorkspaceFileId(rootView);
  expect(rootFileId).toBeTruthy();
  if (!rootFileId) {
    throw new Error('Root workspace should expose a primary file.');
  }

  const conversations = await listProjectConversations(baseURL, projectId);
  const projectConversation = conversations.find(
    (conversation) => conversation.id === root.conversationId
  );

  expect(projectConversation?.projectId).toBe(projectId);
  expect(projectConversation?.wikiId).toBeNull();

  const rawConversationBeforeFileChange = await getRawConversationDebug(
    baseURL,
    root.conversationId
  );
  expect(rawConversationBeforeFileChange.conversation.projectId).toBe(projectId);
  expect(rawConversationBeforeFileChange.conversation.wikiId).toBeNull();
  expect(rawConversationBeforeFileChange.conversation.activeFileId).toBe(rootFileId);

  const replacementFile = await createWorkspaceFile(baseURL, root.id, {
    kind: 'text',
    name: `follow-up-${suffix}.txt`,
  });

  await deleteWorkspaceFile(baseURL, root.id, rootFileId);

  const rawConversationAfterFileChange = await getRawConversationDebug(
    baseURL,
    root.conversationId
  );
  expect(rawConversationAfterFileChange.conversation.activeFileId).toBe(
    replacementFile.id
  );
  expect(rawConversationAfterFileChange.conversation.activeFileWorkspaceId).toBe(root.id);

  const sibling = await createWorkspace(baseURL, siblingTitle, {
    goal: '同项目切换到另一个 node 后继续对话。',
    projectId,
    projectTitle: rootTitle,
  });

  await addConversationMessage(baseURL, root.conversationId, {
    content: '继续在 sibling node 上推进。',
    focusNodeId: sibling.id,
    role: 'user',
  });

  const messages = await listConversationMessages(baseURL, root.conversationId);
  const latestMessage = messages.at(-1);
  const rawConversation = await getRawConversationDebug(baseURL, root.conversationId);
  const latestRawMessage = rawConversation.messages.at(-1);

  expect(latestMessage?.workspaceId).toBe(sibling.id);
  expect(latestMessage?.focusNodeId).toBe(sibling.id);
  expect(latestMessage?.wikiId).toBe(sibling.id);
  expect(latestRawMessage?.focusNodeId).toBe(sibling.id);
  expect(latestRawMessage?.documentId).toBeNull();
});

test('deleting a sibling node preserves the shared project conversation and falls back to a remaining node', async ({
}, testInfo) => {
  const baseURL = String(testInfo.project.use.baseURL);
  const suffix = Date.now();
  const rootTitle = `Delete Root ${suffix}`;
  const siblingTitle = `Delete Sibling ${suffix}`;

  const root = await createWorkspace(baseURL, rootTitle);
  const rootView = await getWorkspaceView(baseURL, root.id, root.conversationId);
  const projectId = rootView.currentProject?.id || rootView.workspace?.projectId || null;

  expect(projectId).toBeTruthy();
  if (!projectId) {
    throw new Error('Project id should exist for workspace delete coverage.');
  }

  const sibling = await createWorkspace(baseURL, siblingTitle, {
    goal: '删除 sibling node 后继续沿用项目级对话。',
    projectId,
    projectTitle: rootTitle,
  });
  const siblingView = await getWorkspaceView(baseURL, sibling.id, root.conversationId);
  const siblingFileId = getPrimaryWorkspaceFileId(siblingView);

  expect(siblingFileId).toBeTruthy();
  if (!siblingFileId) {
    throw new Error('Sibling workspace should expose a primary file.');
  }

  await addConversationMessage(baseURL, root.conversationId, {
    activeFileId: siblingFileId,
    content: '把当前项目级对话切到 sibling node 上。',
    focusNodeId: sibling.id,
    role: 'user',
  });

  const rawConversationBeforeDelete = await getRawConversationDebug(
    baseURL,
    root.conversationId
  );
  expect(rawConversationBeforeDelete.conversation.activeFileId).toBe(siblingFileId);
  expect(rawConversationBeforeDelete.conversation.activeFileWorkspaceId).toBe(sibling.id);

  await deleteWorkspace(baseURL, sibling.id);

  const projectConversations = await listProjectConversations(baseURL, projectId);
  expect(projectConversations.some((conversation) => conversation.id === root.conversationId)).toBe(
    true
  );

  const rawConversationAfterDelete = await getRawConversationDebug(
    baseURL,
    root.conversationId
  );
  expect(rawConversationAfterDelete.conversation.projectId).toBe(projectId);
  expect(rawConversationAfterDelete.conversation.activeFileId).toBeNull();
  expect(rawConversationAfterDelete.messages.at(-1)?.focusNodeId).toBe(sibling.id);

  const recoveredConversation = await getConversationWorkspaceByConversationId(
    baseURL,
    root.conversationId
  );
  expect(recoveredConversation.conversation?.id).toBe(root.conversationId);
  expect(recoveredConversation.workspace?.id).toBe(root.id);
  expect(recoveredConversation.workspace?.projectId).toBe(projectId);
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
  await page.goto(buildWorkspaceRoute({
    assistant: 'context',
    conversationId: workspace.conversationId,
    nodeId: workspace.id,
    projectId,
  }));
  await expect(page.getByTestId('assistant-tab-context')).toHaveAttribute(
    'aria-selected',
    'true'
  );

  await expect(page.getByTestId(`context-note-${deliverableNote.id}`)).toContainText(
    deliverableKnowledge
  );
  await expect(page.getByTestId(`context-note-${projectNote.id}`)).toContainText(
    projectKnowledge
  );
  await expect(page.getByTestId(`context-note-${userNote.id}`)).toContainText(userMemory);
  await expect(page.getByTestId(`context-note-scope-${deliverableNote.id}`)).toHaveText(
    '当前页面'
  );
  await expect(page.getByTestId(`context-note-scope-${projectNote.id}`)).toHaveText(
    'Wiki 空间'
  );
  await expect(page.getByTestId(`context-note-scope-${userNote.id}`)).toHaveText('用户');
  await expect(page.getByText('这里新建的知识会保存到当前页面。')).toBeVisible();
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
  await page.goto(buildWorkspaceRoute({
    assistant: 'context',
    conversationId: seededKnowledge.conversationId,
    nodeId: seededKnowledge.id,
    projectId,
  }));
  await expect(page.getByTestId('assistant-tab-context')).toHaveAttribute(
    'aria-selected',
    'true'
  );

  await expect(page.getByTestId(`context-edit-knowledge-${seedNote.id}`)).toBeVisible();
  await expect(page.getByTestId(`context-delete-knowledge-${seedNote.id}`)).toBeVisible();
  await page.getByTestId(`context-edit-knowledge-${seedNote.id}`).click();
  await page.getByTestId('context-knowledge-title').fill('项目级术语');
  await page.getByTestId('context-knowledge-content').fill(updatedProjectKnowledge);
  await page.getByTestId('context-knowledge-scope-project').click();
  await expect(page.getByText('保存后这条知识会归到Wiki 空间。')).toBeVisible();
  await page.getByTestId('context-save-knowledge').click();

  await expect(page.getByTestId(`context-note-${seedNote.id}`)).toContainText(
    updatedProjectKnowledge
  );
  await expect(page.getByTestId(`context-note-scope-${seedNote.id}`)).toHaveText('Wiki 空间');

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

  await expect
    .poll(async () => {
      const userNotes = await listNotesForScope(baseURL, { scope: 'user' });
      return userNotes.some((note) => note.content === newUserKnowledge);
    })
    .toBe(true);

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
    [{ name: 'list_project_nodes' }, { name: 'get_workspace_context' }]
  );

  expect(debugContext.systemPrompt).toContain(projectTitle);
  expect(debugContext.systemPrompt).toContain(referenceTitle);
  expect(debugContext.systemPrompt).toContain(currentTitle);
  expect(debugContext.systemPrompt).toContain(`- ${referenceTitle} (shape: document, status:`);
  expect(debugContext.systemPrompt).not.toContain(`- ${referenceTitle} (shape: web, status:`);

  const projectListTool = debugContext.toolResults.find(
    (result) => result.name === 'list_project_nodes'
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

async function addConversationMessage(
  baseURL: string,
  conversationId: string,
  params: {
    activeFileId?: string | null;
    content: string;
    focusNodeId?: string | null;
    role: 'assistant' | 'user';
    workspaceId?: string | null;
  }
) {
  return apiRequest<{ id: string }>(baseURL, `/api/conversations/${conversationId}/messages`, {
    body: {
      activeFileId: params.activeFileId || null,
      content: params.content,
      focusNodeId: params.focusNodeId || null,
      role: params.role,
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    },
    method: 'POST',
  });
}

async function createWorkspaceFile(
  baseURL: string,
  workspaceId: string,
  params: {
    kind: 'markdown' | 'text' | 'code' | 'richtext';
    name: string;
  }
) {
  return apiRequest<{ id: string }>(baseURL, `/api/workspaces/${workspaceId}/files`, {
    body: {
      kind: params.kind,
      name: params.name,
      nodeType: 'file',
    },
    method: 'POST',
  });
}

async function deleteWorkspaceFile(baseURL: string, workspaceId: string, fileId: string) {
  return apiRequest<{ deleted: true }>(
    baseURL,
    `/api/workspaces/${workspaceId}/files/${fileId}`,
    {
      method: 'DELETE',
    }
  );
}

async function deleteWorkspace(baseURL: string, workspaceId: string) {
  return apiRequest<{ ok: true }>(baseURL, `/api/workspaces/${workspaceId}`, {
    method: 'DELETE',
  });
}

async function getRawConversationDebug(baseURL: string, conversationId: string) {
  return apiRequest<{
    conversation: {
      activeFileId: string | null;
      activeFileWorkspaceId: string | null;
      projectId: string | null;
      wikiId: string | null;
    };
    messages: Array<{
      documentId: string | null;
      focusNodeId: string | null;
      id: string;
      role: 'assistant' | 'user';
    }>;
  }>(baseURL, `/api/debug/conversations/${conversationId}`);
}

async function listConversationMessages(baseURL: string, conversationId: string) {
  return apiRequest<
    Array<{
      focusNodeId?: string | null;
      id: string;
      wikiId?: string | null;
      workspaceId: string | null;
    }>
  >(baseURL, `/api/conversations/${conversationId}/messages`);
}

async function listProjectConversations(baseURL: string, projectId: string) {
  const response = await apiRequest<{
    items: Array<{
      id: string;
      projectId?: string | null;
      wikiId?: string | null;
      workspaceId: string | null;
    }>;
  }>(baseURL, `/api/conversations?projectId=${projectId}`);

  return response.items;
}

async function getConversationWorkspaceByConversationId(
  baseURL: string,
  conversationId: string
) {
  return apiRequest<{
    conversation: { id: string } | null;
    workspace: { id: string; projectId: string | null } | null;
  }>(baseURL, `/api/conversations?id=${conversationId}`);
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
    workspace: { id: string; projectId: string | null } | null;
  }>(baseURL, `/api/workspaces/${workspaceId}?conversationId=${conversationId}`);
}

function getPrimaryWorkspaceFileId(workspaceView: Awaited<ReturnType<typeof getWorkspaceView>>) {
  return (
    workspaceView.files.find((file) => file.nodeType === 'file' && file.isPrimary)?.id ||
    workspaceView.files.find((file) => file.nodeType === 'file')?.id ||
    null
  );
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

async function createProjectMount(
  baseURL: string,
  sourceProjectId: string,
  targetProjectId: string
) {
  return apiRequest<{
    id: string;
    sourceProjectId: string;
    targetProjectId: string;
  }>(baseURL, `/api/projects/${sourceProjectId}/mounts`, {
    body: {
      targetProjectId,
    },
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
