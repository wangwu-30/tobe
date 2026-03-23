import type {
  BrowserEvaluator,
  BrowserLocator,
} from '../../infra/browser-operator';
import type { ChengxingBlackboxScenario } from './types';

const FIRST_USE_GUIDE_LOCATOR: BrowserLocator = {
  description: 'first use guide',
  kind: 'test-id',
  value: 'first-use-guide-home',
};

const START_WITH_GOAL_LOCATOR: BrowserLocator = {
  description: 'start with a goal button',
  kind: 'role',
  name: '从目标开始',
  role: 'button',
};

const GOAL_INPUT_LOCATOR: BrowserLocator = {
  description: 'goal input',
  kind: 'css',
  value: '#goal',
};

const CREATE_PROJECT_LOCATOR: BrowserLocator = {
  description: 'create project button',
  kind: 'role',
  name: '创建项目',
  role: 'button',
};

const WEB_DELIVERABLE_CANVAS_LOCATOR: BrowserLocator = {
  description: 'web deliverable canvas',
  kind: 'test-id',
  value: 'web-deliverable-canvas',
};

const WEB_PREVIEW_IFRAME_LOCATOR: BrowserLocator = {
  description: 'web preview iframe',
  kind: 'css',
  value: 'iframe[src*="preview/bridge"]',
};

const INTENT_CLARIFY_CARD_LOCATOR: BrowserLocator = {
  description: 'intent clarify cards',
  kind: 'test-id',
  value: 'goal-intent-clarify',
};

const INTENT_DOCUMENT_OPTION_LOCATOR: BrowserLocator = {
  description: 'document intent option',
  kind: 'test-id',
  value: 'goal-intent-option-document',
};

const INTENT_WEB_OPTION_LOCATOR: BrowserLocator = {
  description: 'web intent option',
  kind: 'test-id',
  value: 'goal-intent-option-web',
};

const INTENT_DOCUMENT_SELECT_BUTTON_LOCATOR: BrowserLocator = {
  description: 'select document intent button',
  kind: 'css',
  value: '[data-testid="goal-intent-option-document"] button',
};

const VERSION_TREE_BUTTON_LOCATOR: BrowserLocator = {
  description: 'version tree button',
  kind: 'test-id',
  value: 'version-tree-button',
};

const VERSION_TREE_DIALOG_LOCATOR: BrowserLocator = {
  description: 'version tree dialog',
  kind: 'role',
  name: '版本树',
  role: 'dialog',
};

const SAVE_MILESTONE_BUTTON_LOCATOR: BrowserLocator = {
  description: 'save milestone button',
  kind: 'role',
  name: '保存里程碑',
  role: 'button',
};

const COMPARE_BUTTON_LOCATOR: BrowserLocator = {
  description: 'compare button',
  kind: 'role',
  name: '比较',
  role: 'button',
};

const COMPARE_DIALOG_LOCATOR: BrowserLocator = {
  description: 'compare dialog',
  kind: 'role',
  name: '比较版本',
  role: 'dialog',
};

const COMPARE_LEFT_SELECT_LOCATOR: BrowserLocator = {
  description: 'compare left select',
  kind: 'test-id',
  value: 'version-compare-left-select',
};

const ASSISTANT_CHAT_TAB_LOCATOR: BrowserLocator = {
  description: 'assistant chat tab',
  kind: 'test-id',
  value: 'assistant-tab-chat',
};

const ASSISTANT_STATUS_TAB_LOCATOR: BrowserLocator = {
  description: 'assistant status tab',
  kind: 'test-id',
  value: 'assistant-tab-status',
};

const ASSISTANT_CONTEXT_TAB_LOCATOR: BrowserLocator = {
  description: 'assistant context tab',
  kind: 'test-id',
  value: 'assistant-tab-context',
};

const CHAT_COMPOSER_INPUT_LOCATOR: BrowserLocator = {
  description: 'chat composer input',
  kind: 'css',
  value: '[data-testid="chat-composer"] textarea',
};

const CHAT_BASE_VERSION_LABEL_LOCATOR: BrowserLocator = {
  description: 'chat base version label',
  kind: 'test-id',
  value: 'chat-base-version-label',
};

const DOCUMENT_EDITOR_LOCATOR: BrowserLocator = {
  description: 'document editor',
  kind: 'css',
  value: '[data-slate-editor="true"]',
};

const CONTEXT_KNOWLEDGE_SCOPE_PROJECT_LOCATOR: BrowserLocator = {
  description: 'project scope knowledge button',
  kind: 'test-id',
  value: 'context-knowledge-scope-project',
};

const CONTEXT_KNOWLEDGE_TITLE_LOCATOR: BrowserLocator = {
  description: 'context knowledge title input',
  kind: 'test-id',
  value: 'context-knowledge-title',
};

const CONTEXT_KNOWLEDGE_CONTENT_LOCATOR: BrowserLocator = {
  description: 'context knowledge content textarea',
  kind: 'test-id',
  value: 'context-knowledge-content',
};

const CONTEXT_SAVE_KNOWLEDGE_LOCATOR: BrowserLocator = {
  description: 'save knowledge button',
  kind: 'test-id',
  value: 'context-save-knowledge',
};

const CONTEXT_WORKFLOW_NOTICE_LOCATOR: BrowserLocator = {
  description: 'context workflow notice',
  kind: 'test-id',
  value: 'context-workflow-notice',
};

const BUILTIN_WORKFLOW_TITLE = '需求规格到网页上线';

export function buildA1FirstUseScenario(params: {
  baseURL: string;
  goal: string;
}): ChengxingBlackboxScenario {
  return {
    acceptanceFocus: '从打开到进入是否连贯',
    createEvaluator: () => createA1FirstUseEvaluator(params.baseURL, params.goal),
    expectedVisibleText: 'AI 正在启动第一版 live draft',
    id: 'A1',
    journey: '首次使用',
    target: {
      baseURL: params.baseURL,
      bootstrap: {
        appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || null,
        description: 'Open the homepage from a blank state and create the first project.',
        seedName: null,
      },
      id: 'chengxing-first-use-home',
      label: '成形首页首次使用',
      locators: {
        createProject: CREATE_PROJECT_LOCATOR,
        firstUseGuide: FIRST_USE_GUIDE_LOCATOR,
        goalInput: GOAL_INPUT_LOCATOR,
        startWithGoal: START_WITH_GOAL_LOCATOR,
      },
      readiness: {
        locator: FIRST_USE_GUIDE_LOCATOR,
      },
    },
    task: `从空白首页开始，打开 Goal Composer，输入“${params.goal}”，创建项目并进入 workspace。`,
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: '空白起步：首页 → Goal Composer → 输入目标 → 进入 workspace',
  };
}

export function buildA2WebFirstUseScenario(params: {
  baseURL: string;
  goal: string;
}): ChengxingBlackboxScenario {
  return {
    acceptanceFocus: '是否需要额外操作才看到预览',
    createEvaluator: () => createA2WebFirstUseEvaluator(params.baseURL, params.goal),
    id: 'A2',
    journey: '首次使用',
    target: {
      ...createSharedHomeFirstUseTarget(params.baseURL),
      id: 'chengxing-first-use-web-preview',
      label: '成形首页网页首次使用',
      locators: {
        ...createSharedHomeFirstUseTarget(params.baseURL).locators,
        webDeliverableCanvas: WEB_DELIVERABLE_CANVAS_LOCATOR,
        webPreviewIframe: WEB_PREVIEW_IFRAME_LOCATOR,
      },
    },
    task: `从空白首页开始，输入“${params.goal}”，创建网页项目，并确认进入 workspace 后预览会自动启动。`,
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: '网页创建：输入网页类目标 → 确认 web 交付物 → 预览自动启动',
  };
}

export function buildA3IntentClarifyScenario(params: {
  baseURL: string;
  goal: string;
}): ChengxingBlackboxScenario {
  return {
    acceptanceFocus: '追问是否清晰',
    createEvaluator: () => createA3IntentClarifyEvaluator(params.baseURL, params.goal),
    expectedVisibleText: 'AI 正在启动第一版 live draft',
    id: 'A3',
    journey: '首次使用',
    target: {
      ...createSharedHomeFirstUseTarget(params.baseURL),
      id: 'chengxing-first-use-intent-clarify',
      label: '成形首页意图追问首次使用',
      locators: {
        ...createSharedHomeFirstUseTarget(params.baseURL).locators,
        intentClarifyCard: INTENT_CLARIFY_CARD_LOCATOR,
        intentDocumentOption: INTENT_DOCUMENT_OPTION_LOCATOR,
        intentDocumentSelectButton: INTENT_DOCUMENT_SELECT_BUTTON_LOCATOR,
        intentWebOption: INTENT_WEB_OPTION_LOCATOR,
      },
    },
    task: `从空白首页开始，输入“${params.goal}”，遇到结果形态追问后完成选择，并成功进入 workspace。`,
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: '歧义追问：输入模糊目标 → 追问卡片 → 选择 → 创建',
  };
}

export function buildB2ChatAdvanceScenario(params: {
  baseURL: string;
  conversationId: string;
  requiredMarker: string;
  workspaceId: string;
}): ChengxingBlackboxScenario {
  return {
    acceptanceFocus: '对话到结果是否一气呵成',
    createEvaluator: () => createB2ChatAdvanceEvaluator(params),
    expectedVisibleText: params.requiredMarker,
    id: 'B2',
    journey: '日常创作',
    target: {
      baseURL: params.baseURL,
      bootstrap: {
        appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || null,
        description: 'Open a seeded workspace and push the current draft forward from chat.',
        seedName: 'chat-advance',
      },
      id: 'chengxing-daily-chat-advance',
      label: '成形工作区对话推进当前草稿',
      locators: {
        assistantChatTab: ASSISTANT_CHAT_TAB_LOCATOR,
        assistantStatusTab: ASSISTANT_STATUS_TAB_LOCATOR,
        chatComposerInput: CHAT_COMPOSER_INPUT_LOCATOR,
        documentEditor: DOCUMENT_EDITOR_LOCATOR,
        documentEditorMarker: createCssLocator(
          'document editor marker',
          `[data-slate-editor="true"]:has-text("${params.requiredMarker}")`
        ),
        implementingStatusPanel: createCssLocator(
          'implementing status panel',
          '[role="tabpanel"][data-state="active"]:has-text("AI 正在渲染下一版")'
        ),
        reviewingStatusPanel: createCssLocator(
          'reviewing status panel',
          '[role="tabpanel"][data-state="active"]:has-text("审阅当前草稿")'
        ),
      },
      metadata: {
        localStorage: createWorkspaceGuideDismissals(),
      },
      readiness: {
        locator: CHAT_COMPOSER_INPUT_LOCATOR,
      },
    },
    task: '在已有草稿的工作区里通过 Chat 提一个明确修改请求，确认 Status 会进入 implementing，随后返回 reviewing，并且修改直接写进当前草稿。',
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: '对话推进：Chat 输入修改请求 → 状态进入 implementing → 草稿直接更新',
  };
}

export function buildB3VersionSaveScenario(params: {
  baseURL: string;
  conversationId: string;
  currentText: string;
  existingVersionId: string;
  existingVersionTitle: string;
  previousText: string;
  workspaceId: string;
}): ChengxingBlackboxScenario {
  return {
    acceptanceFocus: '保存到比较是否顺畅',
    createEvaluator: () => createB3VersionSaveEvaluator(params),
    expectedVisibleText: '已保存里程碑 v2。',
    id: 'B3',
    journey: '日常创作',
    target: {
      baseURL: params.baseURL,
      bootstrap: {
        appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || null,
        description: 'Open a seeded workspace with one visible milestone and save the current draft.',
        seedName: 'version-save',
      },
      id: 'chengxing-daily-version-save',
      label: '成形工作区版本保存与比较',
      locators: {
        assistantChatTab: ASSISTANT_CHAT_TAB_LOCATOR,
        compareButton: COMPARE_BUTTON_LOCATOR,
        compareDialog: COMPARE_DIALOG_LOCATOR,
        compareLeftSelect: COMPARE_LEFT_SELECT_LOCATOR,
        existingVersionCard: createTestIdLocator(
          'existing version card',
          `version-history-card-${params.existingVersionId}`
        ),
        existingVersionOption: createRoleLocator(
          'existing version option',
          'option',
          `里程碑 · ${params.existingVersionTitle}`
        ),
        saveMilestoneButton: SAVE_MILESTONE_BUTTON_LOCATOR,
        versionTreeButton: VERSION_TREE_BUTTON_LOCATOR,
        versionTreeDialog: VERSION_TREE_DIALOG_LOCATOR,
      },
      metadata: {
        localStorage: createWorkspaceGuideDismissals(),
      },
      readiness: {
        locator: VERSION_TREE_BUTTON_LOCATOR,
      },
    },
    task: '在已有里程碑的工作区里保存当前草稿，确认历史里能找到旧里程碑，并进入比较视图。',
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: '版本保存：保存里程碑 → 在历史中确认旧版本 → 进入比较视图',
  };
}

export function buildB4BranchSwitchScenario(params: {
  baseURL: string;
  conversationId: string;
  firstVersionId: string;
  firstVersionText: string;
  firstVersionTitle: string;
  secondVersionId: string;
  secondVersionText: string;
  secondVersionTitle: string;
  workspaceId: string;
}): ChengxingBlackboxScenario {
  return {
    acceptanceFocus: '分支后是否清楚自己在哪',
    createEvaluator: () => createB4BranchSwitchEvaluator(params),
    id: 'B4',
    journey: '日常创作',
    target: {
      baseURL: params.baseURL,
      bootstrap: {
        appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || null,
        description: 'Open a seeded workspace on an older milestone, continue from it, then switch branches.',
        seedName: 'branch-switch',
      },
      id: 'chengxing-daily-branch-switch',
      label: '成形工作区分支继续与切换',
      locators: {
        assistantChatTab: ASSISTANT_CHAT_TAB_LOCATOR,
        chatBaseVersionLabel: CHAT_BASE_VERSION_LABEL_LOCATOR,
        continueFromFirstVersion: createTestIdLocator(
          'continue from first version button',
          `version-continue-${params.firstVersionId}`
        ),
        currentSecondBranchBadge: createTestIdLocator(
          'current second branch badge',
          `version-branch-overview-current-${params.secondVersionId}`
        ),
        switchToSecondBranch: createTestIdLocator(
          'switch to second branch button',
          `version-branch-overview-switch-${params.secondVersionId}`
        ),
        versionTreeButton: VERSION_TREE_BUTTON_LOCATOR,
      },
      metadata: {
        localStorage: createWorkspaceGuideDismissals(),
      },
      readiness: {
        locator: VERSION_TREE_BUTTON_LOCATOR,
      },
    },
    task: '从旧里程碑继续出一条新分支，再切回另一条可见分支，确认当前分支基线始终清楚。',
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: '分支操作：从里程碑继续 → 基线变化 → 切到另一条可见分支',
  };
}

export function buildC1KnowledgeManageScenario(params: {
  baseURL: string;
  conversationId: string;
  noteTitle: string;
  noteContent: string;
  updatedNoteContent: string;
  workspaceId: string;
}): ChengxingBlackboxScenario {
  const noteCard = createCssLocator(
    'context knowledge note card',
    `[data-testid^="context-note-"]:has-text("${params.noteTitle}")`
  );

  return {
    acceptanceFocus: '创建编辑保存是否直觉',
    createEvaluator: () => createC1KnowledgeManageEvaluator({
      ...params,
      noteCard,
    }),
    expectedVisibleText: params.updatedNoteContent,
    id: 'C1',
    journey: '上下文',
    target: {
      baseURL: params.baseURL,
      bootstrap: {
        appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || null,
        description: 'Open a seeded workspace and create, edit, then persist one knowledge note.',
        seedName: 'knowledge-manage',
      },
      id: 'chengxing-context-knowledge-manage',
      label: '成形工作区上下文知识创建与编辑',
      locators: {
        assistantContextTab: ASSISTANT_CONTEXT_TAB_LOCATOR,
        contextKnowledgeContent: CONTEXT_KNOWLEDGE_CONTENT_LOCATOR,
        contextKnowledgeNoteCard: noteCard,
        contextKnowledgeProjectScope: CONTEXT_KNOWLEDGE_SCOPE_PROJECT_LOCATOR,
        contextKnowledgeTitle: CONTEXT_KNOWLEDGE_TITLE_LOCATOR,
        contextSaveKnowledge: CONTEXT_SAVE_KNOWLEDGE_LOCATOR,
        editKnowledgeButton: createCssLocator(
          'edit context knowledge button',
          `[data-testid^="context-note-"]:has-text("${params.noteTitle}") button[data-testid^="context-edit-knowledge-"]`
        ),
      },
      metadata: {
        localStorage: createWorkspaceGuideDismissals(),
      },
      readiness: {
        locator: ASSISTANT_CONTEXT_TAB_LOCATOR,
      },
    },
    task: '在已有工作区里打开 Context，创建一条项目级知识，随后编辑并刷新验证内容仍然持久化。',
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: '知识管理：Context → 创建 note → 编辑 → 保存 → 持久化',
  };
}

export function buildC2WorkflowApplyScenario(params: {
  baseURL: string;
  conversationId: string;
  workspaceId: string;
}): ChengxingBlackboxScenario {
  const workflowCard = createCssLocator(
    'builtin workflow card',
    `div.rounded-lg.border.p-3.text-xs:has-text("${BUILTIN_WORKFLOW_TITLE}")`
  );

  return {
    acceptanceFocus: '模板应用是否一键',
    createEvaluator: () => createC2WorkflowApplyEvaluator({
      ...params,
      workflowCard,
    }),
    expectedVisibleText: BUILTIN_WORKFLOW_TITLE,
    id: 'C2',
    journey: '上下文',
    target: {
      baseURL: params.baseURL,
      bootstrap: {
        appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || null,
        description: 'Open a seeded workspace, apply a builtin workflow from Context, then confirm it in Status.',
        seedName: 'workflow-apply',
      },
      id: 'chengxing-context-workflow-apply',
      label: '成形工作区上下文 Workflow 应用',
      locators: {
        assistantContextTab: ASSISTANT_CONTEXT_TAB_LOCATOR,
        assistantStatusTab: ASSISTANT_STATUS_TAB_LOCATOR,
        builtinWorkflowCard: workflowCard,
        builtinWorkflowUseButton: createCssLocator(
          'builtin workflow use button',
          `div.rounded-lg.border.p-3.text-xs:has-text("${BUILTIN_WORKFLOW_TITLE}") button:has-text("用于当前任务")`
        ),
        contextWorkflowNotice: CONTEXT_WORKFLOW_NOTICE_LOCATOR,
        statusPanel: createCssLocator(
          'active status panel',
          '[role="tabpanel"][data-state="active"]'
        ),
      },
      metadata: {
        localStorage: createWorkspaceGuideDismissals(),
      },
      readiness: {
        locator: ASSISTANT_CONTEXT_TAB_LOCATOR,
      },
    },
    task: '在已有工作区里从 Context 查看内置 Workflow，并把它用于当前任务，确认 Status 立即同步。',
    threshold: {
      minAverageScore: 4,
      minDimensionScore: 3,
    },
    title: 'Workflow：查看模板 → 应用到任务 → Status 更新',
  };
}

function createSharedHomeFirstUseTarget(baseURL: string) {
  return {
    baseURL,
    bootstrap: {
      appDataRoot: process.env.DAO_APP_DATA_ROOT?.trim() || null,
      description: 'Open the homepage from a blank state and create the first project.',
      seedName: null,
    },
    id: 'chengxing-first-use-home',
    label: '成形首页首次使用',
    locators: {
      createProject: CREATE_PROJECT_LOCATOR,
      firstUseGuide: FIRST_USE_GUIDE_LOCATOR,
      goalInput: GOAL_INPUT_LOCATOR,
      startWithGoal: START_WITH_GOAL_LOCATOR,
    },
    readiness: {
      locator: FIRST_USE_GUIDE_LOCATOR,
    },
  } satisfies ChengxingBlackboxScenario['target'];
}

function createWorkspaceGuideDismissals() {
  return {
    'dao-first-use-guide:assistant-chat': 'true',
    'dao-first-use-guide:assistant-context': 'true',
    'dao-first-use-guide:assistant-review': 'true',
    'dao-first-use-guide:assistant-status': 'true',
    'dao-first-use-guide:context-workflow': 'true',
    'dao-first-use-guide:version-surface': 'true',
    'dao-has-seen-onboarding': 'true',
  } as const;
}

function createC1KnowledgeManageEvaluator(params: {
  baseURL: string;
  conversationId: string;
  noteCard: BrowserLocator;
  noteContent: string;
  noteTitle: string;
  updatedNoteContent: string;
  workspaceId: string;
}): BrowserEvaluator {
  const workspaceUrl = new URL(
    `/workspace/${params.workspaceId}?conversationId=${params.conversationId}`,
    params.baseURL
  ).toString();

  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open seeded workspace',
            reason: 'The knowledge-management flow starts from an existing workspace.',
            url: workspaceUrl,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'click',
            label: 'Open context tab',
            reason: 'Knowledge creation happens inside the context surface.',
            target: locators.assistantContextTab || ASSISTANT_CONTEXT_TAB_LOCATOR,
          };
        case 3:
          return {
            kind: 'wait_for',
            label: 'Wait for knowledge title input',
            reason: 'The knowledge composer must be ready before entering the note.',
            target: locators.contextKnowledgeTitle || CONTEXT_KNOWLEDGE_TITLE_LOCATOR,
          };
        case 4:
          return {
            kind: 'click',
            label: 'Choose project knowledge scope',
            reason: 'Use project scope so the saved note reads as reusable project context.',
            target:
              locators.contextKnowledgeProjectScope || CONTEXT_KNOWLEDGE_SCOPE_PROJECT_LOCATOR,
          };
        case 5:
          return {
            kind: 'fill',
            label: 'Enter knowledge title',
            reason: 'Create one explicit knowledge note with a unique title.',
            target: locators.contextKnowledgeTitle || CONTEXT_KNOWLEDGE_TITLE_LOCATOR,
            value: params.noteTitle,
          };
        case 6:
          return {
            kind: 'fill',
            label: 'Enter knowledge content',
            reason: 'Provide the initial knowledge content before saving.',
            target: locators.contextKnowledgeContent || CONTEXT_KNOWLEDGE_CONTENT_LOCATOR,
            value: params.noteContent,
          };
        case 7:
          return {
            kind: 'click',
            label: 'Save knowledge note',
            reason: 'Save the new knowledge note from the composer.',
            target: locators.contextSaveKnowledge || CONTEXT_SAVE_KNOWLEDGE_LOCATOR,
          };
        case 8:
          return {
            kind: 'wait_for',
            label: 'Wait for saved note card',
            reason: 'The new note should appear in the knowledge list immediately.',
            target: params.noteCard,
          };
        case 9:
          return {
            kind: 'click',
            label: 'Edit saved knowledge note',
            reason: 'Reopen the saved note from the list to verify editing stays direct.',
            target: locators.editKnowledgeButton,
          };
        case 10:
          return {
            kind: 'fill',
            label: 'Update knowledge content',
            reason: 'Change the note content and save again.',
            target: locators.contextKnowledgeContent || CONTEXT_KNOWLEDGE_CONTENT_LOCATOR,
            value: params.updatedNoteContent,
          };
        case 11:
          return {
            kind: 'click',
            label: 'Save updated knowledge note',
            reason: 'Persist the edited note content.',
            target: locators.contextSaveKnowledge || CONTEXT_SAVE_KNOWLEDGE_LOCATOR,
          };
        case 12:
          return {
            kind: 'goto',
            label: 'Reload workspace route',
            reason: 'Re-enter the workspace to verify the note persists after reload.',
            url: workspaceUrl,
            waitFor: 'domcontentloaded',
          };
        case 13:
          return {
            kind: 'click',
            label: 'Reopen context tab',
            reason: 'The persisted note should still be discoverable from the context surface.',
            target: locators.assistantContextTab || ASSISTANT_CONTEXT_TAB_LOCATOR,
          };
        case 14:
          return {
            kind: 'wait_for',
            label: 'Wait for persisted note card',
            reason: 'Reloading should bring the saved note card back before checking its content.',
            target: params.noteCard,
          };
        case 15:
          return {
            condition: 'contains-text',
            kind: 'assert',
            label: 'Assert persisted note after reload',
            reason: 'Reloading should not lose the edited knowledge note.',
            target: params.noteCard,
            value: params.updatedNoteContent,
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'Context knowledge could be created, edited, and found again after reload.',
          };
      }
    },
  };
}

function createC2WorkflowApplyEvaluator(params: {
  baseURL: string;
  conversationId: string;
  workflowCard: BrowserLocator;
  workspaceId: string;
}): BrowserEvaluator {
  const workspaceUrl = new URL(
    `/workspace/${params.workspaceId}?conversationId=${params.conversationId}`,
    params.baseURL
  ).toString();

  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open seeded workspace',
            reason: 'The workflow-apply flow starts from a regular workspace with Context available.',
            url: workspaceUrl,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'click',
            label: 'Open context tab',
            reason: 'Builtin workflow templates live in the Context surface.',
            target: locators.assistantContextTab || ASSISTANT_CONTEXT_TAB_LOCATOR,
          };
        case 3:
          return {
            kind: 'wait_for',
            label: 'Wait for builtin workflow card',
            reason: 'The builtin workflow card should be visible without additional setup.',
            target: locators.builtinWorkflowCard || params.workflowCard,
          };
        case 4:
          return {
            kind: 'click',
            label: 'Apply builtin workflow',
            reason: 'Applying the builtin workflow should be a one-click action from Context.',
            target: locators.builtinWorkflowUseButton,
          };
        case 5:
          return {
            kind: 'wait_for',
            label: 'Wait for workflow applied notice',
            reason: 'Context should acknowledge that the workflow is now attached to the task.',
            text: '已把 Workflow 应用到当前任务。',
          };
        case 6:
          return {
            kind: 'click',
            label: 'Open status tab',
            reason: 'Status should reflect the newly attached workflow immediately.',
            target: locators.assistantStatusTab || ASSISTANT_STATUS_TAB_LOCATOR,
          };
        case 7:
          return {
            condition: 'contains-text',
            kind: 'assert',
            label: 'Assert workflow title in status',
            reason: 'The active task should now show the builtin workflow title.',
            target: locators.statusPanel,
            value: BUILTIN_WORKFLOW_TITLE,
          };
        case 8:
          return {
            condition: 'contains-text',
            kind: 'assert',
            label: 'Assert extension hints in status',
            reason: 'Status should also surface the workflow extension hints, not just the title.',
            target: locators.statusPanel,
            value: '开放扩展',
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'Builtin workflow applied from Context and showed up in Status immediately.',
          };
      }
    },
  };
}

function createRoleLocator(
  description: string,
  role: string,
  name: string
): BrowserLocator {
  return {
    description,
    kind: 'role',
    name,
    role,
  };
}

function createCssLocator(description: string, value: string): BrowserLocator {
  return {
    description,
    kind: 'css',
    value,
  };
}

function createTestIdLocator(description: string, value: string): BrowserLocator {
  return {
    description,
    kind: 'test-id',
    value,
  };
}

function createA1FirstUseEvaluator(baseURL: string, goal: string): BrowserEvaluator {
  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open homepage',
            reason: 'The first-use blackbox flow starts from the blank home surface.',
            url: baseURL,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'wait_for',
            label: 'Wait for first use guide',
            reason: 'The blank-state home guide should be visible before interacting.',
            target: locators.firstUseGuide || FIRST_USE_GUIDE_LOCATOR,
          };
        case 3:
          return {
            kind: 'click',
            label: 'Open Goal Composer',
            reason: 'The first action a new user takes is starting from a goal.',
            target: locators.startWithGoal || START_WITH_GOAL_LOCATOR,
          };
        case 4:
          return {
            kind: 'wait_for',
            label: 'Wait for goal input',
            reason: 'The goal dialog must be ready before entering the user goal.',
            target: locators.goalInput || GOAL_INPUT_LOCATOR,
          };
        case 5:
          return {
            kind: 'fill',
            label: 'Enter goal',
            reason: 'Provide the first-use goal in the composer.',
            target: locators.goalInput || GOAL_INPUT_LOCATOR,
            value: goal,
          };
        case 6:
          return {
            kind: 'click',
            label: 'Create project',
            reason: 'Submit the goal to create the first project.',
            target: locators.createProject || CREATE_PROJECT_LOCATOR,
          };
        case 7:
          return {
            kind: 'wait_for',
            label: 'Wait for workspace launch feedback',
            reason: 'A first-use run should land in workspace and show startup feedback.',
            text: 'AI 正在启动第一版 live draft',
          };
        case 8:
          return {
            condition: 'url-includes',
            kind: 'assert',
            label: 'Assert workspace route',
            reason: 'The user should be taken into the workspace route.',
            value: '/workspace/',
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'First-use project creation reached the workspace surface.',
          };
      }
    },
  };
}

function createA2WebFirstUseEvaluator(baseURL: string, goal: string): BrowserEvaluator {
  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open homepage',
            reason: 'The web first-use flow starts from the blank home surface.',
            url: baseURL,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'wait_for',
            label: 'Wait for first use guide',
            reason: 'The blank-state home guide should be visible before interacting.',
            target: locators.firstUseGuide || FIRST_USE_GUIDE_LOCATOR,
          };
        case 3:
          return {
            kind: 'click',
            label: 'Open Goal Composer',
            reason: 'A first-time user starts from the goal entrypoint.',
            target: locators.startWithGoal || START_WITH_GOAL_LOCATOR,
          };
        case 4:
          return {
            kind: 'wait_for',
            label: 'Wait for goal input',
            reason: 'The goal dialog must be ready before entering the web goal.',
            target: locators.goalInput || GOAL_INPUT_LOCATOR,
          };
        case 5:
          return {
            kind: 'fill',
            label: 'Enter web goal',
            reason: 'Provide an explicit website goal so the result shape resolves to web.',
            target: locators.goalInput || GOAL_INPUT_LOCATOR,
            value: goal,
          };
        case 6:
          return {
            kind: 'click',
            label: 'Create project',
            reason: 'Submit the website goal to create the project.',
            target: locators.createProject || CREATE_PROJECT_LOCATOR,
          };
        case 7:
          return {
            kind: 'wait_for',
            label: 'Wait for web canvas',
            reason: 'The web deliverable surface should become visible without extra clicks.',
            target: locators.webDeliverableCanvas || WEB_DELIVERABLE_CANVAS_LOCATOR,
            timeoutMs: 25_000,
          };
        case 8:
          return {
            condition: 'url-includes',
            kind: 'assert',
            label: 'Assert workspace route',
            reason: 'The user should be taken into the workspace route.',
            value: '/workspace/',
          };
        case 9:
          return {
            kind: 'wait_for',
            label: 'Wait for preview iframe',
            reason: 'A clear web goal should auto-start preview and mount the iframe.',
            target: locators.webPreviewIframe || WEB_PREVIEW_IFRAME_LOCATOR,
            timeoutMs: 25_000,
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'Web first-use flow reached the workspace and auto-started preview.',
          };
      }
    },
  };
}

function createA3IntentClarifyEvaluator(baseURL: string, goal: string): BrowserEvaluator {
  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open homepage',
            reason: 'The intent-clarify flow starts from the blank home surface.',
            url: baseURL,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'wait_for',
            label: 'Wait for first use guide',
            reason: 'The home guide should be ready before opening the composer.',
            target: locators.firstUseGuide || FIRST_USE_GUIDE_LOCATOR,
          };
        case 3:
          return {
            kind: 'click',
            label: 'Open Goal Composer',
            reason: 'The user starts from the goal entrypoint.',
            target: locators.startWithGoal || START_WITH_GOAL_LOCATOR,
          };
        case 4:
          return {
            kind: 'wait_for',
            label: 'Wait for goal input',
            reason: 'The dialog needs to be ready before entering the ambiguous request.',
            target: locators.goalInput || GOAL_INPUT_LOCATOR,
          };
        case 5:
          return {
            kind: 'fill',
            label: 'Enter ambiguous goal',
            reason: 'Use an ambiguous request so the app must clarify the result shape.',
            target: locators.goalInput || GOAL_INPUT_LOCATOR,
            value: goal,
          };
        case 6:
          return {
            kind: 'click',
            label: 'Submit ambiguous goal',
            reason: 'This should surface clarify cards instead of creating immediately.',
            target: locators.createProject || CREATE_PROJECT_LOCATOR,
          };
        case 7:
          return {
            kind: 'wait_for',
            label: 'Wait for clarify cards',
            reason: 'The user should see explicit result-shape choices.',
            target: locators.intentClarifyCard || INTENT_CLARIFY_CARD_LOCATOR,
          };
        case 8:
          return {
            condition: 'visible',
            kind: 'assert',
            label: 'Assert document option visible',
            reason: 'The clarify cards should expose a document option.',
            target: locators.intentDocumentOption || INTENT_DOCUMENT_OPTION_LOCATOR,
          };
        case 9:
          return {
            condition: 'visible',
            kind: 'assert',
            label: 'Assert web option visible',
            reason: 'The clarify cards should expose a web option.',
            target: locators.intentWebOption || INTENT_WEB_OPTION_LOCATOR,
          };
        case 10:
          return {
            kind: 'click',
            label: 'Choose document result shape',
            reason: 'Select a concrete shape so the flow can proceed into workspace creation.',
            target:
              locators.intentDocumentSelectButton || INTENT_DOCUMENT_SELECT_BUTTON_LOCATOR,
          };
        case 11:
          return {
            kind: 'wait_for',
            label: 'Wait for workspace launch feedback',
            reason: 'After choosing a shape, the app should continue into workspace creation.',
            text: 'AI 正在启动第一版 live draft',
          };
        case 12:
          return {
            condition: 'url-includes',
            kind: 'assert',
            label: 'Assert workspace route',
            reason: 'The clarify flow should still land inside the workspace route.',
            value: '/workspace/',
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'Intent-clarify flow surfaced result-shape cards and still reached workspace.',
          };
      }
    },
  };
}

function createB2ChatAdvanceEvaluator(params: {
  baseURL: string;
  conversationId: string;
  requiredMarker: string;
  workspaceId: string;
}): BrowserEvaluator {
  const workspaceUrl = new URL(
    `/workspace/${params.workspaceId}?conversationId=${params.conversationId}`,
    params.baseURL
  ).toString();
  const request = `请把正文改写成更适合作为正式稿的一句话，明确强调执行节奏，并在正文里原样保留 ${params.requiredMarker}。不要改标题。`;

  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open seeded workspace',
            reason: 'The chat-advance flow starts from a ready workspace with a reviewable draft.',
            url: workspaceUrl,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'click',
            label: 'Open chat tab',
            reason: 'The user pushes the draft forward from the chat surface.',
            target: locators.assistantChatTab || ASSISTANT_CHAT_TAB_LOCATOR,
          };
        case 3:
          return {
            kind: 'wait_for',
            label: 'Wait for chat composer',
            reason: 'The chat composer must be ready before entering the request.',
            target: locators.chatComposerInput || CHAT_COMPOSER_INPUT_LOCATOR,
          };
        case 4:
          return {
            kind: 'fill',
            label: 'Enter chat request',
            reason: 'Provide one concrete request that should directly update the current draft.',
            target: locators.chatComposerInput || CHAT_COMPOSER_INPUT_LOCATOR,
            value: request,
          };
        case 5:
          return {
            key: 'Enter',
            kind: 'press',
            label: 'Send chat request',
            reason: 'Submitting the request should start an assistant run immediately.',
            target: locators.chatComposerInput || CHAT_COMPOSER_INPUT_LOCATOR,
          };
        case 6:
          return {
            kind: 'click',
            label: 'Open status tab',
            reason: 'Status should reflect that AI is now writing the next pass.',
            target: locators.assistantStatusTab || ASSISTANT_STATUS_TAB_LOCATOR,
          };
        case 7:
          return {
            kind: 'wait_for',
            label: 'Wait for implementing status',
            reason: 'The status surface should switch into the implementing phase during the run.',
            target: locators.implementingStatusPanel,
            timeoutMs: 30_000,
          };
        case 8:
          return {
            kind: 'wait_for',
            label: 'Wait for reviewing status again',
            reason: 'Once the run finishes, the status surface should settle back into review.',
            target: locators.reviewingStatusPanel,
            timeoutMs: 45_000,
          };
        case 9:
          return {
            kind: 'wait_for',
            label: 'Wait for draft marker in editor',
            reason: 'The chat request should have written the requested marker straight into the current draft.',
            target: locators.documentEditorMarker,
            timeoutMs: 15_000,
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'Chat request moved the draft forward and kept status feedback in sync.',
          };
      }
    },
  };
}

function createB3VersionSaveEvaluator(params: {
  baseURL: string;
  conversationId: string;
  currentText: string;
  previousText: string;
  workspaceId: string;
}): BrowserEvaluator {
  const workspaceUrl = new URL(
    `/workspace/${params.workspaceId}?conversationId=${params.conversationId}`,
    params.baseURL
  ).toString();

  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open seeded workspace',
            reason: 'The version-save blackbox flow starts from a workspace with one existing milestone.',
            url: workspaceUrl,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'wait_for',
            label: 'Wait for version tree button',
            reason: 'The workspace should be interactive before saving a new milestone.',
            target: locators.versionTreeButton || VERSION_TREE_BUTTON_LOCATOR,
          };
        case 3:
          return {
            kind: 'click',
            label: 'Save milestone',
            reason: 'Save the current draft as a new visible milestone.',
            target: locators.saveMilestoneButton || SAVE_MILESTONE_BUTTON_LOCATOR,
          };
        case 4:
          return {
            kind: 'wait_for',
            label: 'Wait for saved milestone feedback',
            reason: 'A successful save should give explicit milestone feedback.',
            text: '已保存里程碑 v2。',
          };
        case 5:
          return {
            kind: 'wait_for',
            label: 'Wait for history refresh settle',
            reason: 'Give the workspace a brief settle window before reopening history and compare.',
            timeMs: 1_500,
          };
        case 6:
          return {
            kind: 'click',
            label: 'Open version tree',
            reason: 'The saved milestone should now be discoverable from history.',
            target: locators.versionTreeButton || VERSION_TREE_BUTTON_LOCATOR,
          };
        case 7:
          return {
            kind: 'wait_for',
            label: 'Wait for version tree dialog',
            reason: 'The version tree must open before checking the saved history.',
            target: locators.versionTreeDialog || VERSION_TREE_DIALOG_LOCATOR,
          };
        case 8:
          return {
            kind: 'wait_for',
            label: 'Wait for existing milestone card in history',
            reason: 'The original visible milestone should still be easy to find in history.',
            target: locators.existingVersionCard,
            timeoutMs: 15_000,
          };
        case 9:
          return {
            key: 'Escape',
            kind: 'press',
            label: 'Close version tree',
            reason: 'Return to the workspace header actions before opening compare.',
          };
        case 10:
          return {
            kind: 'click',
            label: 'Open compare',
            reason: 'After checking history, enter the compare surface directly.',
            target: locators.compareButton || COMPARE_BUTTON_LOCATOR,
          };
        case 11:
          return {
            kind: 'wait_for',
            label: 'Wait for compare dialog',
            reason: 'The compare surface must be visible before picking a baseline milestone.',
            target: locators.compareDialog || COMPARE_DIALOG_LOCATOR,
          };
        case 12:
          return {
            kind: 'click',
            label: 'Open left compare select',
            reason: 'Select the earlier milestone as the comparison baseline.',
            target: locators.compareLeftSelect || COMPARE_LEFT_SELECT_LOCATOR,
          };
        case 13:
          return {
            kind: 'click',
            label: 'Select existing milestone',
            reason: 'Use the previously saved milestone as the left comparison side.',
            target: locators.existingVersionOption,
          };
        case 14:
          return {
            condition: 'contains-text',
            kind: 'assert',
            label: 'Assert previous milestone content present',
            reason: 'The compare dialog should still surface the original milestone content.',
            target: locators.compareDialog || COMPARE_DIALOG_LOCATOR,
            value: params.previousText,
          };
        case 15:
          return {
            condition: 'contains-text',
            kind: 'assert',
            label: 'Assert current draft content present',
            reason: 'The compare dialog should also show the current draft side without extra work.',
            target: locators.compareDialog || COMPARE_DIALOG_LOCATOR,
            value: params.currentText,
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'Saving a milestone led cleanly into history and compare.',
          };
      }
    },
  };
}

function createB4BranchSwitchEvaluator(params: {
  baseURL: string;
  conversationId: string;
  firstVersionId: string;
  firstVersionText: string;
  firstVersionTitle: string;
  secondVersionText: string;
  secondVersionTitle: string;
  workspaceId: string;
}): BrowserEvaluator {
  const workspaceUrl = new URL(
    `/workspace/${params.workspaceId}?conversationId=${params.conversationId}&versionId=${params.firstVersionId}`,
    params.baseURL
  ).toString();

  return {
    async nextAction(input) {
      const locators = input.request.target.locators || {};

      switch (input.step) {
        case 1:
          return {
            kind: 'goto',
            label: 'Open older milestone surface',
            reason: 'The branch flow starts from an explicit older visible milestone.',
            url: workspaceUrl,
            waitFor: 'domcontentloaded',
          };
        case 2:
          return {
            kind: 'wait_for',
            label: 'Wait for older milestone content',
            reason: 'The read-only milestone surface should load before continuing from it.',
            text: params.firstVersionText,
          };
        case 3:
          return {
            kind: 'click',
            label: 'Open version tree',
            reason: 'Continue from the older milestone through the version tree.',
            target: locators.versionTreeButton || VERSION_TREE_BUTTON_LOCATOR,
          };
        case 4:
          return {
            kind: 'wait_for',
            label: 'Wait for continue button',
            reason: 'The continue action must be visible before branching.',
            target: locators.continueFromFirstVersion,
          };
        case 5:
          return {
            kind: 'click',
            label: 'Continue from first milestone',
            reason: 'Create a new live-draft branch from the older milestone.',
            target: locators.continueFromFirstVersion,
          };
        case 6:
          return {
            kind: 'wait_for',
            label: 'Wait for branched draft content',
            reason: 'The workspace should land back on a live draft with the ancestor content.',
            text: params.firstVersionText,
          };
        case 7:
          return {
            kind: 'click',
            label: 'Open chat tab',
            reason: 'The chat header exposes the current branch baseline clearly.',
            target: locators.assistantChatTab || ASSISTANT_CHAT_TAB_LOCATOR,
          };
        case 8:
          return {
            condition: 'contains-text',
            kind: 'assert',
            label: 'Assert branched base label',
            reason: 'After continue, the chat baseline should point at the older milestone.',
            target: locators.chatBaseVersionLabel || CHAT_BASE_VERSION_LABEL_LOCATOR,
            value: params.firstVersionTitle,
          };
        case 9:
          return {
            kind: 'click',
            label: 'Reopen version tree',
            reason: 'Switch to the other visible branch from the branch overview.',
            target: locators.versionTreeButton || VERSION_TREE_BUTTON_LOCATOR,
          };
        case 10:
          return {
            kind: 'wait_for',
            label: 'Wait for second-branch switch button',
            reason: 'The other visible branch must be discoverable without extra hunting.',
            target: locators.switchToSecondBranch,
          };
        case 11:
          return {
            kind: 'click',
            label: 'Switch to second branch',
            reason: 'Move the live draft back onto the other visible branch.',
            target: locators.switchToSecondBranch,
          };
        case 12:
          return {
            kind: 'wait_for',
            label: 'Wait for second branch content',
            reason: 'The workspace surface should update to the second branch content.',
            text: params.secondVersionText,
          };
        case 13:
          return {
            kind: 'click',
            label: 'Open chat tab again',
            reason: 'Confirm the baseline label follows the switched branch.',
            target: locators.assistantChatTab || ASSISTANT_CHAT_TAB_LOCATOR,
          };
        case 14:
          return {
            condition: 'contains-text',
            kind: 'assert',
            label: 'Assert switched branch base label',
            reason: 'The chat baseline should now name the second branch milestone.',
            target: locators.chatBaseVersionLabel || CHAT_BASE_VERSION_LABEL_LOCATOR,
            value: params.secondVersionTitle,
          };
        case 15:
          return {
            kind: 'click',
            label: 'Open version tree for confirmation',
            reason: 'The branch overview should explicitly mark the current branch head.',
            target: locators.versionTreeButton || VERSION_TREE_BUTTON_LOCATOR,
          };
        case 16:
          return {
            condition: 'visible',
            kind: 'assert',
            label: 'Assert current branch overview badge',
            reason: 'The branch overview should make the current branch head obvious.',
            target: locators.currentSecondBranchBadge,
          };
        default:
          return {
            kind: 'finish',
            status: 'passed',
            summary: 'Continuing from a milestone and switching branches kept the current branch obvious.',
          };
      }
    },
  };
}
