import fs from 'node:fs/promises';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { createClient } from '@libsql/client';
import { getCommentKey } from '@platejs/comment';
import { stringifyCommentResearchState } from '@/lib/comments/research';
import { stringifyAssistantRunPayload } from '@/lib/workspace/assistant-run-payload';
import {
  apiRequest,
  buildHeading,
  buildParagraph,
  createDocumentSelectionAnchor,
  resolveBaseURL,
  resolveIterationProjectsRoot,
  resolveSeedStatePath,
  type SeedState,
} from './helpers';

type WorkspaceCreateResponse = {
  conversation: { id: string };
  primaryFile: { id: string };
  room: { id: string; projectId: string | null };
  workspace: { id: string };
};

type ThreadResponse = {
  id: string;
};

type VersionResponse = {
  id: string;
};

export default async function globalSetup(config: FullConfig) {
  const baseURL = resolveBaseURL(config);
  const projectsRoot = resolveIterationProjectsRoot();
  const seedStatePath = resolveSeedStatePath();

  await fs.mkdir(projectsRoot, { recursive: true });

  const baseWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify(buildBaseWorkspaceContent()),
    goal: '验证状态面板、大纲和基础交付物表面。',
    projectsRoot,
    title: '迭代回归-主交付物',
  });
  await seedPlan(baseURL, baseWorkspace.id, {
    activeStageId: 'draft-2',
    goal: '验证状态面板、大纲和基础交付物表面。',
    stages: [
      {
        checkpoint: true,
        description: '明确交付物目标与范围',
        id: 'draft-1',
        kind: 'milestone',
        status: 'completed',
        title: '明确目标和范围',
      },
      {
        checkpoint: true,
        description: '整理结构并进入主稿撰写',
        id: 'draft-2',
        kind: 'milestone',
        status: 'in_progress',
        title: '撰写主稿',
      },
      {
        checkpoint: true,
        description: '完成审阅并定稿',
        id: 'draft-3',
        kind: 'milestone',
        status: 'pending',
        title: '定稿保存',
      },
    ],
    status: 'reviewing',
  });

  const supportWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('支持资料树验证'),
      buildParagraph('这个工作区用于验证支持资料的创建、重命名、删除与选中同步。'),
    ]),
    goal: '验证支持资料树操作闭环。',
    projectsRoot,
    title: '迭代回归-支持资料树',
  });
  await seedDefaultReviewPlan(
    baseURL,
    supportWorkspace.id,
    '验证支持资料树操作闭环。'
  );

  const commentsApplyWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('评论应用验证'),
      buildParagraph('原始句子需要被替换成更清晰的表述。'),
      buildParagraph('这里是另一段内容，用于制造跨段评论。'),
    ]),
    goal: '验证评论应用与不可应用提示。',
    projectsRoot,
    title: '迭代回归-评论应用',
  });
  await seedDefaultReviewPlan(
    baseURL,
    commentsApplyWorkspace.id,
    '验证评论应用与不可应用提示。'
  );
  const applyThread = await createThread(baseURL, commentsApplyWorkspace.id, {
    anchorText: '原始句子需要被替换成更清晰的表述。',
    fileId: commentsApplyWorkspace.fileId,
    firstMessage: '请把这句话改成更清晰、更适合作为正式稿的版本。',
    selectionAnchor: createDocumentSelectionAnchor({
      end: { offset: 17, path: [1, 0] },
      excerpt: '原始句子需要被替换成更清晰的表述。',
      fileId: commentsApplyWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
    }),
  });
  const replacementText = '这句话已经改写成更清晰、也更适合作为正式稿的表达。';
  await addThreadMessage(baseURL, applyThread.id, {
    content: replacementText,
    role: 'assistant',
  });

  const commentsBlockedWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('评论阻断验证'),
      buildParagraph('第一段用于跨段评论阻断。'),
      buildParagraph('第二段用于确认跨段线程不会显示可直接应用入口。'),
    ]),
    goal: '验证跨段评论会在操作前直接给出阻断原因。',
    projectsRoot,
    title: '迭代回归-评论阻断',
  });
  await seedDefaultReviewPlan(
    baseURL,
    commentsBlockedWorkspace.id,
    '验证跨段评论会在操作前直接给出阻断原因。'
  );
  const blockedThread = await createThread(baseURL, commentsBlockedWorkspace.id, {
    anchorText: '原始句子需要被替换成更清晰的表述。这里是另一段内容，用于制造跨段评论。',
    fileId: commentsBlockedWorkspace.fileId,
    firstMessage: '这两段需要一起重写。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '第一段用于跨段评论阻断。第二段用于确认跨段线程不会显示可直接应用入口。',
      fileId: commentsBlockedWorkspace.fileId,
      rangeState: 'cross-block',
    }),
  });
  await addThreadMessage(baseURL, blockedThread.id, {
    content: '我建议把这两段合并成一段更紧凑的说明，但这属于跨段改写。',
    role: 'assistant',
  });

  const branchVersionWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('续写对话版本验证'),
      buildParagraph('这个工作区用于验证从消息另开对话后，版本视图仍然保留当前交付物表面。'),
    ]),
    goal: '验证从消息另开对话后，版本视图不空白。',
    projectsRoot,
    title: '迭代回归-版本续写对话',
  });
  await seedDefaultReviewPlan(
    baseURL,
    branchVersionWorkspace.id,
    '验证从消息另开对话后，版本视图不空白。'
  );
  const branchVersion = await createVersion(
    baseURL,
    branchVersionWorkspace.id,
    '版本里程碑 V1'
  );
  const ancestorInheritedThread = await createThread(baseURL, branchVersionWorkspace.id, {
    anchorText: '这个工作区用于验证从消息另开对话后，版本视图仍然保留当前交付物表面。',
    fileId: branchVersionWorkspace.fileId,
    firstMessage: '这个版本上的评论应该在从 V1 继续后继承下来。',
    selectionAnchor: createDocumentSelectionAnchor({
      end: { offset: 29, path: [1, 0] },
      excerpt: '这个工作区用于验证从消息另开对话后，版本视图仍然保留当前交付物表面。',
      fileId: branchVersionWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
    }),
    versionId: branchVersion.id,
  });
  await updateFileContent(
    baseURL,
    branchVersionWorkspace.id,
    branchVersionWorkspace.fileId,
    JSON.stringify([
      buildHeading('续写对话版本验证'),
      buildParagraph('这个工作区用于验证当前草稿已经继续到另一个版本 head。'),
      buildParagraph('V2 用来确认从更早里程碑继续时，live draft 会真正切回那个基点。'),
    ])
  );
  const branchVersionV2 = await createVersion(baseURL, branchVersionWorkspace.id, '版本里程碑 V2');
  const siblingBranchThread = await createThread(baseURL, branchVersionWorkspace.id, {
    anchorText: 'V2 用来确认从更早里程碑继续时，live draft 会真正切回那个基点。',
    fileId: branchVersionWorkspace.fileId,
    firstMessage: '这个只属于 V2 分支的评论不应该泄漏到从 V1 继续出来的新分支。',
    selectionAnchor: createDocumentSelectionAnchor({
      end: { offset: 41, path: [2, 0] },
      excerpt: 'V2 用来确认从更早里程碑继续时，live draft 会真正切回那个基点。',
      fileId: branchVersionWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [2, 0] },
    }),
    versionId: branchVersionV2.id,
  });
  await addConversationMessage(baseURL, branchVersionWorkspace.conversationId, branchVersionWorkspace.id, {
    content: '请把这一版再压缩成更简洁的说明。',
    role: 'user',
  });
  const branchVersionAssistantMessage = await addConversationMessage(
    baseURL,
    branchVersionWorkspace.conversationId,
    branchVersionWorkspace.id,
    {
      content: '已经整理出一个更简洁的方向。',
      role: 'assistant',
    }
  );

  const branchSupportWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('支持资料续写对话验证'),
      buildParagraph('主交付物保持不变，切换对话时应继续显示当前支持资料文件。'),
    ]),
    goal: '验证支持资料表面在切换对话后不丢失。',
    projectsRoot,
    title: '迭代回归-支持资料续写对话',
  });
  await seedDefaultReviewPlan(
    baseURL,
    branchSupportWorkspace.id,
    '验证支持资料表面在切换对话后不丢失。'
  );
  const supportFile = await createSupportFile(baseURL, branchSupportWorkspace.id, '续写对话支持资料');
  await updateFileContent(baseURL, branchSupportWorkspace.id, supportFile.id, JSON.stringify([
    buildHeading('支持资料续写对话文件'),
    buildParagraph('切换到续写对话后，这份支持资料仍然应该留在中央表面。'),
  ]));
  await addConversationMessage(baseURL, branchSupportWorkspace.conversationId, branchSupportWorkspace.id, {
    content: '基于支持资料继续推进这个项目。',
    role: 'user',
  });
  const branchSupportAssistantMessage = await addConversationMessage(
    baseURL,
    branchSupportWorkspace.conversationId,
    branchSupportWorkspace.id,
    {
      content: '我会从这里另开一条对话继续推进。',
      role: 'assistant',
    }
  );
  const branchSupportConversation = await branchConversation(
    baseURL,
    branchSupportWorkspace.conversationId,
    branchSupportAssistantMessage.id,
    '支持资料续写对话'
  );

  const commentsAgentWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('评论角色监听验证'),
      buildParagraph('第一段用于验证不 @ 角色时只保留人工讨论，不会自动触发回复。'),
      buildParagraph('第二段用于验证 @assistant 会进入等待态，并且可以手动停止监听。'),
    ]),
    goal: '验证评论 @角色 与监听窗口的真实语义。',
    projectsRoot,
    title: '迭代回归-评论角色监听',
  });
  await seedDefaultReviewPlan(
    baseURL,
    commentsAgentWorkspace.id,
    '验证评论 @角色 与监听窗口的真实语义。'
  );
  const manualThread = await createThread(baseURL, commentsAgentWorkspace.id, {
    anchorText: '第一段用于验证不 @ 角色时只保留人工讨论，不会自动触发回复。',
    fileId: commentsAgentWorkspace.fileId,
    firstMessage: '先把这个问题记下来，暂时不用叫 AI。',
    selectionAnchor: createDocumentSelectionAnchor({
      end: { offset: 31, path: [1, 0] },
      excerpt: '第一段用于验证不 @ 角色时只保留人工讨论，不会自动触发回复。',
      fileId: commentsAgentWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
    }),
  });
  const waitingThread = await createThread(baseURL, commentsAgentWorkspace.id, {
    anchorText: '第二段用于验证 @assistant 会进入等待态，并且可以手动停止监听。',
    fileId: commentsAgentWorkspace.fileId,
    firstMessage: '@assistant 请先帮我把这句话压缩得更像正式稿。',
    selectionAnchor: createDocumentSelectionAnchor({
      end: { offset: 43, path: [2, 0] },
      excerpt: '第二段用于验证 @assistant 会进入等待态，并且可以手动停止监听。',
      fileId: commentsAgentWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [2, 0] },
    }),
  });
  await addThreadMessage(baseURL, waitingThread.id, {
    agentId: 'assistant',
    agentLabel: 'AI 助手',
    content: '我会先给出一个更短、更正式的改法，并继续留意这个线程。',
    role: 'assistant',
  });
  await addThreadMessage(baseURL, waitingThread.id, {
    content: '@assistant 先保持监听，等我补充上下文。',
    role: 'user',
  });

  const blockDiscussionWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('块级评论映射验证'),
      buildParagraph('第一段要展示跨段线程的块级入口。'),
      buildParagraph('第二段属于同一个跨段线程，但不应该重复显示入口。'),
    ]),
    goal: '验证块级评论映射不会在渲染阶段抛错，并且跨段线程只在首块显示。',
    projectsRoot,
    title: '迭代回归-块级评论映射',
  });
  await seedDefaultReviewPlan(
    baseURL,
    blockDiscussionWorkspace.id,
    '验证块级评论映射不会在渲染阶段抛错，并且跨段线程只在首块显示。'
  );
  const crossBlockThread = await createThread(baseURL, blockDiscussionWorkspace.id, {
    anchorText: '第一段要展示跨段线程的块级入口。第二段属于同一个跨段线程，但不应该重复显示入口。',
    fileId: blockDiscussionWorkspace.fileId,
    firstMessage: '这两段放在一起看，有一个跨段评论。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '第一段要展示跨段线程的块级入口。第二段属于同一个跨段线程，但不应该重复显示入口。',
      fileId: blockDiscussionWorkspace.fileId,
      rangeState: 'cross-block',
    }),
  });
  await updateFileContent(
    baseURL,
    blockDiscussionWorkspace.id,
    blockDiscussionWorkspace.fileId,
    JSON.stringify([
      buildHeading('块级评论映射验证'),
      buildCommentMarkedParagraph('第一段要展示跨段线程的块级入口。', crossBlockThread.id),
      buildCommentMarkedParagraph('第二段属于同一个跨段线程，但不应该重复显示入口。', crossBlockThread.id),
    ])
  );

  const intentSwitchWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('意图切换验证'),
      buildParagraph('第一段内容，用于确认切换意图后不变。'),
    ]),
    goal: '验证在不同交付意图之间切换不丢失数据。',
    projectsRoot,
    title: '迭代回归-意图切换',
  });
  await seedDefaultReviewPlan(baseURL, intentSwitchWorkspace.id, '验证在不同交付意图之间切换不丢失数据。');
  await createSupportFile(baseURL, intentSwitchWorkspace.id, '测试资料');
  await createSupportFile(baseURL, intentSwitchWorkspace.id, '更多资料');
  await createThread(baseURL, intentSwitchWorkspace.id, {
    anchorText: '意图切换验证',
    fileId: intentSwitchWorkspace.fileId,
    firstMessage: '这条评论不应在切换时消失。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '意图切换验证',
      fileId: intentSwitchWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [0, 0] },
      end: { offset: 6, path: [0, 0] },
    }),
  });
  await createThread(baseURL, intentSwitchWorkspace.id, {
    anchorText: '第一段内容',
    fileId: intentSwitchWorkspace.fileId,
    firstMessage: '这是另一条评论。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '第一段内容，用于确认切换意图后不变。',
      fileId: intentSwitchWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
      end: { offset: 17, path: [1, 0] },
    }),
  });
  await createVersion(baseURL, intentSwitchWorkspace.id, '切换前版本');

  const agentMissingWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('角色缺失验证'),
      buildParagraph('这段文字上有一个被删除的角色的绑定线程。'),
    ]),
    goal: '验证当绑定的 Agent 缺失时的阻断表现。',
    projectsRoot,
    title: '迭代回归-角色缺失',
  });
  await seedDefaultReviewPlan(baseURL, agentMissingWorkspace.id, '验证当绑定的 Agent 缺失时的阻断表现。');
  const blockedAgentThread = await createThread(baseURL, agentMissingWorkspace.id, {
    anchorText: '这段文字上有一个被删除的角色的绑定线程。',
    fileId: agentMissingWorkspace.fileId,
    firstMessage: '这是发给一个已经消失的角色的。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '这段文字上有一个被删除的角色的绑定线程。',
      fileId: agentMissingWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
      end: { offset: 19, path: [1, 0] },
    }),
  });
  await addThreadMessage(baseURL, blockedAgentThread.id, {
    agentId: 'deleted-agent',
    agentLabel: '已删除角色',
    content: '我是被删除的角色，我在这里。',
    role: 'assistant',
  });

  const mentionTestWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('Mention 体验测试'),
      buildParagraph('这个工作区用于测试 @ 提及的拉起体验。'),
    ]),
    goal: '测试 mention 弹框功能。',
    projectsRoot,
    title: '迭代回归-提及体验',
  });
  await seedDefaultReviewPlan(baseURL, mentionTestWorkspace.id, '测试 mention 弹框功能。');

  const researchWorkspace = await createWorkspace(baseURL, {
    content: JSON.stringify([
      buildHeading('研究流表面验证'),
      buildParagraph('这个工作区用于验证默认轻搜、深度研究卡片和研究报告打开入口。'),
    ]),
    goal: '验证深度研究的计划卡、进度卡和报告入口。',
    projectsRoot,
    title: '迭代回归-研究流',
  });
  await seedDefaultReviewPlan(
    baseURL,
    researchWorkspace.id,
    '验证深度研究的计划卡、进度卡和报告入口。'
  );
  const researchFolder = await createSupportFolder(baseURL, researchWorkspace.id, '研究');
  const researchReportFile = await createSupportFile(
    baseURL,
    researchWorkspace.id,
    '供应链风险 研究报告',
    researchFolder.id,
    'richtext'
  );
  await updateFileContent(
    baseURL,
    researchWorkspace.id,
    researchReportFile.id,
    JSON.stringify([
      buildHeading('供应链风险 研究报告'),
      buildParagraph('这是研究报告原文，用于验证深度研究完成后可以直接打开完整报告。'),
      buildHeading('参考来源', 2),
      buildParagraph('https://example.com/report'),
    ])
  );
  const proposalThread = await createThread(baseURL, researchWorkspace.id, {
    anchorText: '这个工作区用于验证默认轻搜、深度研究卡片和研究报告打开入口。',
    fileId: researchWorkspace.fileId,
    firstMessage: '@assistant 请帮我研究一下这个问题的外部背景。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '这个工作区用于验证默认轻搜、深度研究卡片和研究报告打开入口。',
      fileId: researchWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
      end: { offset: 28, path: [1, 0] },
    }),
  });
  const completedResearchThread = await createThread(baseURL, researchWorkspace.id, {
    anchorText: '这个工作区用于验证默认轻搜、深度研究卡片和研究报告打开入口。',
    fileId: researchWorkspace.fileId,
    firstMessage: '@assistant 请给我一个研究摘要。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '这个工作区用于验证默认轻搜、深度研究卡片和研究报告打开入口。',
      fileId: researchWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
      end: { offset: 28, path: [1, 0] },
    }),
  });
  const blockedResearchThread = await createThread(baseURL, researchWorkspace.id, {
    anchorText: '这个工作区用于验证默认轻搜、深度研究卡片和研究报告打开入口。',
    fileId: researchWorkspace.fileId,
    firstMessage: '@assistant 这个问题需要更深入的外部资料。',
    selectionAnchor: createDocumentSelectionAnchor({
      excerpt: '这个工作区用于验证默认轻搜、深度研究卡片和研究报告打开入口。',
      fileId: researchWorkspace.fileId,
      rangeState: 'single-block',
      start: { offset: 0, path: [1, 0] },
      end: { offset: 28, path: [1, 0] },
    }),
  });
  await addThreadMessage(baseURL, completedResearchThread.id, {
    agentId: 'assistant',
    agentLabel: 'AI 助手',
    content:
      '外部资料显示这个方向最值得关注的是供应链集中度、区域暴露和监管变化。\n- 关键风险集中在上游原料。\n- 区域政策变化需要持续跟踪。\n完整报告见支持资料：供应链风险 研究报告',
    role: 'assistant',
  });

  const seedDb = createSeedDbClient();
  const proposalResearchState = stringifyCommentResearchState({
    progress: {
      mode: 'deep',
      phase: 'proposal',
      currentStepLabel: '研究计划待确认',
      providerState: 'ready',
      reportFileId: null,
      reportFileName: null,
      stepIndex: null,
      totalSteps: null,
    },
    proposal: {
      status: 'pending',
      title: '供应链风险研究',
      query: '研究供应链风险的外部背景',
      summary: '先拆成几个子问题，再决定要补哪些来源。',
      subquestions: ['关键风险在哪里', '哪些地区暴露最高', '最近监管变化是什么'],
      reportOutline: ['结论摘要', '关键证据', '待验证事项'],
      allowedDomains: [],
      sourceScope: {
        attachments: false,
        web: true,
        workspace: true,
      },
    },
    reportFileId: null,
    reportFileName: null,
    summary: null,
    targetAgentId: 'assistant',
    targetAgentLabel: 'AI 助手',
  });
  const completedResearchState = stringifyCommentResearchState({
    progress: {
      mode: 'deep',
      phase: 'completed',
      currentStepLabel: '研究完成',
      providerState: 'ready',
      reportFileId: researchReportFile.id,
      reportFileName: '供应链风险 研究报告',
      stepIndex: null,
      totalSteps: null,
    },
    proposal: {
      status: 'approved',
      title: '供应链风险研究',
      query: '研究供应链风险的外部背景',
      summary: '已经完成初步研究，并整理成可复用报告。',
      subquestions: ['关键风险在哪里', '哪些地区暴露最高', '最近监管变化是什么'],
      reportOutline: ['结论摘要', '关键证据', '待验证事项'],
      allowedDomains: [],
      sourceScope: {
        attachments: false,
        web: true,
        workspace: true,
      },
    },
    reportFileId: researchReportFile.id,
    reportFileName: '供应链风险 研究报告',
    summary: '最值得关注的是上游集中度、地区暴露和监管变化。',
    targetAgentId: 'assistant',
    targetAgentLabel: 'AI 助手',
  });
  const blockedResearchState = stringifyCommentResearchState({
    progress: {
      mode: 'deep',
      phase: 'blocked',
      currentStepLabel: '联网研究当前不可用',
      providerState: 'unavailable',
      reportFileId: null,
      reportFileName: null,
      stepIndex: null,
      totalSteps: null,
    },
    proposal: {
      status: 'approved',
      title: '供应链风险研究',
      query: '研究供应链风险的外部背景',
      summary: '研究已确认，但当前缺少可用的联网 provider。',
      subquestions: ['关键风险在哪里', '哪些地区暴露最高', '最近监管变化是什么'],
      reportOutline: ['结论摘要', '关键证据', '待验证事项'],
      allowedDomains: [],
      sourceScope: {
        attachments: false,
        web: true,
        workspace: true,
      },
    },
    reportFileId: null,
    reportFileName: null,
    summary: null,
    targetAgentId: 'assistant',
    targetAgentLabel: 'AI 助手',
  });
  await seedDb.execute({
    sql: 'UPDATE "CommentThread" SET "researchStateJson" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?',
    args: [proposalResearchState, proposalThread.id],
  });
  await seedDb.execute({
    sql: 'UPDATE "CommentThread" SET "researchStateJson" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?',
    args: [completedResearchState, completedResearchThread.id],
  });
  await seedDb.execute({
    sql: 'UPDATE "CommentThread" SET "researchStateJson" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?',
    args: [blockedResearchState, blockedResearchThread.id],
  });

  const nowIso = new Date().toISOString();
  const proposalRunPayload = stringifyAssistantRunPayload({
    researchPlanProposal: {
      status: 'pending',
      title: '供应链风险研究计划',
      query: '研究供应链风险的最新外部背景',
      summary: '把研究拆成几个关键问题，再确认是否启动深入调研。',
      subquestions: ['关键风险在哪里', '最近有哪些新增变化', '哪些证据还缺失'],
      reportOutline: ['研究结论', '关键证据', '待验证事项'],
      allowedDomains: [],
      sourceScope: {
        attachments: false,
        web: true,
        workspace: true,
      },
    },
    researchProgress: {
      mode: 'deep',
      phase: 'proposal',
      currentStepLabel: '研究计划待确认',
      providerState: 'ready',
      reportFileId: null,
      reportFileName: null,
      stepIndex: null,
      totalSteps: null,
    },
  });
  const completedRunPayload = stringifyAssistantRunPayload({
    researchPlanProposal: {
      status: 'approved',
      title: '供应链风险研究计划',
      query: '研究供应链风险的最新外部背景',
      summary: '把研究拆成几个关键问题，再确认是否启动深入调研。',
      subquestions: ['关键风险在哪里', '最近有哪些新增变化', '哪些证据还缺失'],
      reportOutline: ['研究结论', '关键证据', '待验证事项'],
      allowedDomains: [],
      sourceScope: {
        attachments: false,
        web: true,
        workspace: true,
      },
    },
    researchProgress: {
      mode: 'deep',
      phase: 'completed',
      currentStepLabel: '研究完成',
      providerState: 'ready',
      reportFileId: researchReportFile.id,
      reportFileName: '供应链风险 研究报告',
      stepIndex: null,
      totalSteps: null,
    },
  });
  const blockedRunPayload = stringifyAssistantRunPayload({
    researchPlanProposal: {
      status: 'approved',
      title: '供应链风险研究计划（阻断）',
      query: '研究供应链风险的最新外部背景',
      summary: '研究计划已确认，但当前没有可用的搜索 provider。',
      subquestions: ['关键风险在哪里', '最近有哪些新增变化', '哪些证据还缺失'],
      reportOutline: ['研究结论', '关键证据', '待验证事项'],
      allowedDomains: [],
      sourceScope: {
        attachments: false,
        web: true,
        workspace: true,
      },
    },
    researchProgress: {
      mode: 'deep',
      phase: 'blocked',
      currentStepLabel: '联网研究当前不可用',
      providerState: 'unavailable',
      reportFileId: null,
      reportFileName: null,
      stepIndex: null,
      totalSteps: null,
    },
  });
  await seedDb.execute({
    sql: `INSERT INTO "AssistantRun" (
      "id", "organizationId", "sessionId", "documentId", "mode", "title", "status",
      "summary", "payloadJson", "createdByUserId", "originDeviceId", "startedAt", "finishedAt", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `seed-research-proposal-${researchWorkspace.id}`,
      'local-org',
      researchWorkspace.conversationId,
      researchWorkspace.id,
      'run',
      '供应链风险研究计划',
      'completed',
      '先确认研究范围，再进入正式搜索。',
      proposalRunPayload,
      'local-user',
      'local-device',
      nowIso,
      nowIso,
      nowIso,
      nowIso,
    ],
  });
  await seedDb.execute({
    sql: `INSERT INTO "AssistantRun" (
      "id", "organizationId", "sessionId", "documentId", "mode", "title", "status",
      "summary", "payloadJson", "createdByUserId", "originDeviceId", "startedAt", "finishedAt", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `seed-research-blocked-${researchWorkspace.id}`,
      'local-org',
      researchWorkspace.conversationId,
      researchWorkspace.id,
      'run',
      '供应链风险研究阻断',
      'failed',
      '当前没有可用的联网 provider。',
      blockedRunPayload,
      'local-user',
      'local-device',
      nowIso,
      nowIso,
      nowIso,
      nowIso,
    ],
  });
  await seedDb.execute({
    sql: `INSERT INTO "AssistantRun" (
      "id", "organizationId", "sessionId", "documentId", "mode", "title", "status",
      "summary", "payloadJson", "createdByUserId", "originDeviceId", "startedAt", "finishedAt", "createdAt", "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `seed-research-completed-${researchWorkspace.id}`,
      'local-org',
      researchWorkspace.conversationId,
      researchWorkspace.id,
      'run',
      '供应链风险研究结果',
      'completed',
      '外部背景已经整理完成，完整报告已写入支持资料。',
      completedRunPayload,
      'local-user',
      'local-device',
      nowIso,
      nowIso,
      nowIso,
      nowIso,
    ],
  });
  await seedDb.close();

  const seedState: SeedState = {
    baseWorkspace,
    blockDiscussionWorkspace: {
      ...blockDiscussionWorkspace,
      crossBlockThreadId: crossBlockThread.id,
    },
    branchSupportWorkspace: {
      ...branchSupportWorkspace,
      branchConversationId: branchSupportConversation.id,
      branchTitle: '支持资料续写对话',
      supportFileId: supportFile.id,
    },
    branchVersionWorkspace: {
      ...branchVersionWorkspace,
      ancestorInheritedThreadId: ancestorInheritedThread.id,
      branchMessageId: branchVersionAssistantMessage.id,
      secondVersionId: branchVersionV2.id,
      siblingBranchThreadId: siblingBranchThread.id,
      versionId: branchVersion.id,
    },
    commentsApplyWorkspace: {
      ...commentsApplyWorkspace,
      applyThreadId: applyThread.id,
      replacementText,
    },
    commentsBlockedWorkspace: {
      ...commentsBlockedWorkspace,
      blockedThreadId: blockedThread.id,
    },
    commentsAgentWorkspace: {
      ...commentsAgentWorkspace,
      manualThreadId: manualThread.id,
      waitingThreadId: waitingThread.id,
    },
    intentSwitchWorkspace,
    agentMissingWorkspace: {
      ...agentMissingWorkspace,
      blockedAgentThreadId: blockedAgentThread.id,
    },
    mentionTestWorkspace,
    researchWorkspace: {
      ...researchWorkspace,
      blockedRunId: `seed-research-blocked-${researchWorkspace.id}`,
      commentResearchBlockedThreadId: blockedResearchThread.id,
      commentResearchCompletedThreadId: completedResearchThread.id,
      commentResearchProposalThreadId: proposalThread.id,
      reportFileId: researchReportFile.id,
    },
    supportWorkspace,
  };

  await fs.writeFile(seedStatePath, JSON.stringify(seedState, null, 2));
}

function createSeedDbClient() {
  return createClient({
    url: resolveIterationDatabaseUrl(),
  });
}

function resolveIterationDatabaseUrl() {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL.trim();
  }

  const iterationRoot =
    process.env.ITERATION_ROOT ||
    path.join(process.cwd(), '.tmp', 'iteration-regression');
  const appDataRoot =
    process.env.DAO_APP_DATA_ROOT || path.join(iterationRoot, 'app-data');

  return `file:${path.join(appDataRoot, 'dev.db')}`;
}

async function addConversationMessage(
  baseURL: string,
  conversationId: string,
  workspaceId: string,
  params: {
    content: string;
    role: 'assistant' | 'user';
  }
) {
  return apiRequest<{ id: string }>(
    baseURL,
    `/api/conversations/${conversationId}/messages`,
    {
      body: {
        content: params.content,
        role: params.role,
        workspaceId,
      },
      method: 'POST',
    }
  );
}

async function addThreadMessage(
  baseURL: string,
  threadId: string,
  params: {
    agentId?: string;
    agentLabel?: string;
    content: string;
    role: 'assistant' | 'user';
  }
) {
  return apiRequest(baseURL, `/api/threads/${threadId}/messages`, {
    body: params,
    method: 'POST',
  });
}

async function branchConversation(
  baseURL: string,
  conversationId: string,
  messageId: string,
  title: string
) {
  const payload = await apiRequest<{ conversation: { id: string } }>(
    baseURL,
    `/api/conversations/${conversationId}/branch`,
    {
      body: { messageId, title },
      method: 'POST',
    }
  );

  return payload.conversation;
}

async function createSupportFile(
  baseURL: string,
  workspaceId: string,
  name: string,
  parentId?: string,
  kind: 'code' | 'markdown' | 'richtext' | 'text' = 'markdown'
) {
  return apiRequest<{ id: string }>(
    baseURL,
    `/api/workspaces/${workspaceId}/files`,
    {
      body: {
        kind,
        name,
        parentId: parentId || null,
        role: 'support',
      },
      method: 'POST',
    }
  );
}

async function createSupportFolder(
  baseURL: string,
  workspaceId: string,
  name: string,
  parentId?: string
) {
  return apiRequest<{ id: string }>(
    baseURL,
    `/api/workspaces/${workspaceId}/files`,
    {
      body: {
        name,
        nodeType: 'folder',
        parentId: parentId || null,
        role: 'support',
      },
      method: 'POST',
    }
  );
}

async function createThread(
  baseURL: string,
  workspaceId: string,
  params: {
    anchorText: string;
    fileId: string;
    firstMessage: string;
    selectionAnchor: string;
    versionId?: string;
  }
) {
  return apiRequest<ThreadResponse>(baseURL, '/api/threads', {
    body: {
      anchorText: params.anchorText,
      documentId: workspaceId,
      fileId: params.fileId,
      firstMessage: params.firstMessage,
      selectionAnchor: params.selectionAnchor,
      versionId: params.versionId,
      workspaceId,
    },
    method: 'POST',
  });
}

async function createVersion(baseURL: string, workspaceId: string, title: string) {
  return apiRequest<VersionResponse>(
    baseURL,
    `/api/workspaces/${workspaceId}/versions`,
    {
      body: { title },
      method: 'POST',
    }
  );
}

async function createWorkspace(
  baseURL: string,
  params: {
    content: string;
    goal: string;
    projectsRoot: string;
    title: string;
  }
) {
  const payload = await apiRequest<WorkspaceCreateResponse>(baseURL, '/api/workspaces', {
    body: {
      content: params.content,
      deliverableType: 'document',
      goal: params.goal,
      projectParentPath: params.projectsRoot,
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
    id: payload.workspace.id,
    roomId: payload.room.id,
  };
}

function buildBaseWorkspaceContent() {
  return [
    buildHeading('交付物总览'),
    buildParagraph('这个工作区用于验证大纲跳转、状态面板和主交付物表面。'),
    buildHeading('第一部分', 2),
    buildParagraph('先确认目标和范围，再整理信息结构。'),
    buildHeading('第二部分', 2),
    buildParagraph('把核心论点拆开，避免在同一段里混入太多结论。'),
    buildHeading('第三部分', 2),
    buildParagraph('补充支持信息后，再回到主线表达。'),
    buildHeading('总结', 2),
    buildParagraph('最后这一节用于验证点击大纲后，视口会把目标标题推到顶部附近。'),
  ];
}

function buildCommentMarkedParagraph(text: string, threadId: string) {
  return {
    type: 'p',
    children: [{ text, [getCommentKey(threadId)]: true }],
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

async function updatePlan(
  baseURL: string,
  workspaceId: string,
  params: {
    activeStageId: string;
    goal: string;
    stages: Array<{
      checkpoint: boolean;
      description: string;
      id: string;
      kind: string;
      status: 'blocked' | 'completed' | 'in_progress' | 'pending';
      title: string;
    }>;
    status: string;
  }
) {
  await apiRequest(baseURL, `/api/workspaces/${workspaceId}/plan`, {
    body: params,
    method: 'PATCH',
  });
}

async function seedDefaultReviewPlan(
  baseURL: string,
  workspaceId: string,
  goal: string
) {
  await seedPlan(baseURL, workspaceId, {
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
  });
}

async function seedPlan(
  baseURL: string,
  workspaceId: string,
  params: {
    activeStageId: string;
    goal: string;
    stages: Array<{
      checkpoint: boolean;
      description: string;
      id: string;
      kind: string;
      status: 'blocked' | 'completed' | 'in_progress' | 'pending';
      title: string;
    }>;
    status: string;
  }
) {
  await updatePlan(baseURL, workspaceId, params);
}
