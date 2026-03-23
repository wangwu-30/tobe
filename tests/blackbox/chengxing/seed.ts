import fs from 'node:fs';
import path from 'node:path';
import {
  apiRequest,
  buildHeading,
  buildParagraph,
} from '../../e2e/iteration/helpers';

type WorkspaceCreateResponse = {
  conversation: { id: string };
  primaryFile: { id: string };
  workspace: { id: string };
};

type VersionResponse = {
  id: string;
};

type SeedWorkspace = {
  conversationId: string;
  fileId: string;
  workspaceId: string;
};

export type BlackboxVersionSaveSeed = {
  conversationId: string;
  currentText: string;
  existingVersionId: string;
  existingVersionTitle: string;
  previousText: string;
  workspaceId: string;
};

export type BlackboxChatAdvanceSeed = {
  conversationId: string;
  initialText: string;
  requiredMarker: string;
  workspaceId: string;
};

export type BlackboxBranchSwitchSeed = {
  conversationId: string;
  firstVersionId: string;
  firstVersionText: string;
  firstVersionTitle: string;
  secondVersionId: string;
  secondVersionText: string;
  secondVersionTitle: string;
  workspaceId: string;
};

export type BlackboxContextPanelSeed = {
  conversationId: string;
  workspaceId: string;
};

const VERSION_ONE_TITLE = '版本里程碑 V1';
const VERSION_TWO_TITLE = '版本里程碑 V2';

export async function seedChatAdvanceBlackboxScenario(
  baseURL: string
): Promise<BlackboxChatAdvanceSeed> {
  const suffix = createScenarioSuffix();
  const initialText = `当前正文还比较平，缺少对执行节奏的明确强调 ${suffix}`;
  const workspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('黑盒对话推进验证'),
      buildParagraph(initialText),
    ]),
    goal: '验证 Chat 修改请求会直接写入当前草稿，并同步状态反馈。',
    title: `黑盒-对话推进-${suffix}`,
  });

  await seedDefaultReviewPlan(
    baseURL,
    workspace.workspaceId,
    '验证 Chat 修改请求会直接写入当前草稿，并同步状态反馈。'
  );

  return {
    conversationId: workspace.conversationId,
    initialText,
    requiredMarker: `B2-MARK-${suffix.toUpperCase()}`,
    workspaceId: workspace.workspaceId,
  };
}

export async function seedVersionSaveBlackboxScenario(
  baseURL: string
): Promise<BlackboxVersionSaveSeed> {
  const suffix = createScenarioSuffix();
  const previousText = `这个里程碑用于验证保存后可以从历史进入比较视图 ${suffix}`;
  const currentText = `当前草稿用于验证保存后立刻进入比较视图，并看到新的差异 ${suffix}`;
  const workspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('黑盒版本保存验证'),
      buildParagraph(previousText),
    ]),
    goal: '验证保存里程碑后可以从版本树进入比较视图。',
    title: `黑盒-版本保存-${suffix}`,
  });

  await seedDefaultReviewPlan(baseURL, workspace.workspaceId, '验证保存里程碑后可以从版本树进入比较视图。');

  const existingVersion = await createVersion(
    baseURL,
    workspace.workspaceId,
    VERSION_ONE_TITLE
  );

  await updateFileContent(
    baseURL,
    workspace.workspaceId,
    workspace.fileId,
    JSON.stringify([
      buildHeading('黑盒版本保存验证'),
      buildParagraph(currentText),
    ])
  );

  return {
    conversationId: workspace.conversationId,
    currentText,
    existingVersionId: existingVersion.id,
    existingVersionTitle: VERSION_ONE_TITLE,
    previousText,
    workspaceId: workspace.workspaceId,
  };
}

export async function seedBranchSwitchBlackboxScenario(
  baseURL: string
): Promise<BlackboxBranchSwitchSeed> {
  const suffix = createScenarioSuffix();
  const firstVersionText = `这个工作区用于验证从旧里程碑继续后，会清楚显示当前分支基线 ${suffix}`;
  const secondVersionText = `这个工作区用于验证切到另一条可见分支后，当前草稿和基线都会同步更新 ${suffix}`;
  const workspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('黑盒分支切换验证'),
      buildParagraph(firstVersionText),
    ]),
    goal: '验证从旧里程碑继续并切换到另一条分支后，当前分支感知仍然清楚。',
    title: `黑盒-分支切换-${suffix}`,
  });

  await seedDefaultReviewPlan(
    baseURL,
    workspace.workspaceId,
    '验证从旧里程碑继续并切换到另一条分支后，当前分支感知仍然清楚。'
  );

  const firstVersion = await createVersion(
    baseURL,
    workspace.workspaceId,
    VERSION_ONE_TITLE
  );

  await updateFileContent(
    baseURL,
    workspace.workspaceId,
    workspace.fileId,
    JSON.stringify([
      buildHeading('黑盒分支切换验证'),
      buildParagraph(secondVersionText),
    ])
  );

  const secondVersion = await createVersion(
    baseURL,
    workspace.workspaceId,
    VERSION_TWO_TITLE
  );

  return {
    conversationId: workspace.conversationId,
    firstVersionId: firstVersion.id,
    firstVersionText,
    firstVersionTitle: VERSION_ONE_TITLE,
    secondVersionId: secondVersion.id,
    secondVersionText,
    secondVersionTitle: VERSION_TWO_TITLE,
    workspaceId: workspace.workspaceId,
  };
}

export async function seedContextPanelBlackboxScenario(
  baseURL: string,
  params: {
    goal: string;
    titlePrefix: string;
  }
): Promise<BlackboxContextPanelSeed> {
  const suffix = createScenarioSuffix();
  const title = `${params.titlePrefix}-${suffix}`;
  const workspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading(title),
      buildParagraph(`${params.goal} ${suffix}`),
    ]),
    goal: params.goal,
    title,
  });

  await seedDefaultReviewPlan(baseURL, workspace.workspaceId, params.goal);

  return {
    conversationId: workspace.conversationId,
    workspaceId: workspace.workspaceId,
  };
}

function createScenarioSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createWorkspace(
  baseURL: string,
  params: {
    content: string;
    goal: string;
    title: string;
  }
): Promise<SeedWorkspace> {
  const projectParentPath = resolveBlackboxProjectsRoot();
  fs.mkdirSync(projectParentPath, { recursive: true });

  const payload = await apiRequest<WorkspaceCreateResponse>(baseURL, '/api/workspaces', {
    body: {
      content: params.content,
      deliverableType: 'document',
      goal: params.goal,
      projectParentPath,
      title: params.title,
    },
    method: 'POST',
  });

  await updateFileContent(
    baseURL,
    payload.workspace.id,
    payload.primaryFile.id,
    params.content
  );

  return {
    conversationId: payload.conversation.id,
    fileId: payload.primaryFile.id,
    workspaceId: payload.workspace.id,
  };
}

async function updateFileContent(
  baseURL: string,
  workspaceId: string,
  fileId: string,
  content: string
) {
  await apiRequest(baseURL, `/api/workspaces/${workspaceId}/files/${fileId}`, {
    body: { content },
    method: 'PATCH',
  });
}

async function createVersion(baseURL: string, workspaceId: string, title: string) {
  return apiRequest<VersionResponse>(baseURL, `/api/workspaces/${workspaceId}/versions`, {
    body: { title },
    method: 'POST',
  });
}

function resolveBlackboxProjectsRoot() {
  const appDataRoot = process.env.DAO_APP_DATA_ROOT?.trim();
  if (appDataRoot) {
    return path.join(path.resolve(appDataRoot), 'projects');
  }

  return path.join(process.cwd(), '.tmp', 'blackbox-acceptance', 'app-data', 'projects');
}

async function seedDefaultReviewPlan(
  baseURL: string,
  workspaceId: string,
  goal: string
) {
  await apiRequest(baseURL, `/api/workspaces/${workspaceId}/plan`, {
    body: {
      activeStageId: 'review-2',
      goal,
      stages: [
        {
          checkpoint: true,
          description: '明确目标和边界',
          id: 'review-1',
          kind: 'milestone',
          status: 'completed',
          title: '确认范围',
        },
        {
          checkpoint: true,
          description: '当前草稿已准备好进入局部审阅',
          id: 'review-2',
          kind: 'milestone',
          status: 'in_progress',
          title: '审阅当前草稿',
        },
        {
          checkpoint: true,
          description: '完成确认并保存稳定版本',
          id: 'review-3',
          kind: 'milestone',
          status: 'pending',
          title: '定稿保存',
        },
      ],
      status: 'reviewing',
    },
    method: 'PATCH',
  });
}
