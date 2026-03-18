import type { WorkflowExtensionHintData, WorkflowPlaybookData } from '@/types';

const BUILTIN_WORKFLOW_TIMESTAMP = '2026-03-18T00:00:00.000Z';
const BUILTIN_WORKFLOW_ID_PREFIX = 'builtin:workflow:';
const BUILTIN_WORKFLOW_ORIGIN_PREFIX = 'builtin-workflow:';

type BuiltinWorkflowSeed = {
  checklist: string[];
  constraints: string[];
  content: string;
  extensionHints: WorkflowExtensionHintData[];
  key: string;
  steps: string[];
  summary: string;
  title: string;
};

const BUILTIN_WORKFLOW_SEEDS: BuiltinWorkflowSeed[] = [
  {
    key: 'spec-to-web-release',
    title: '需求规格到网页上线',
    summary:
      '先沉淀需求文档，再实现网页、运行 Playwright 验收，并完成自动化部署；也允许用户直接描述网页目标后补齐规格约束。',
    steps: [
      '澄清目标、受众、关键页面和上线边界，必要时先生成一份简洁规格说明。',
      '把规格整理成可执行的页面结构、内容要求、交互约束和验收标准。',
      '基于规格实现可预览网页，并保持用户可直接对页面元素评论迭代。',
      '用 Playwright 自动化回归核心路径、视觉/交互验收和关键阻断项。',
      '验收通过后执行自动化部署，并记录发布结果与回滚线索。',
    ],
    constraints: [
      '不要把“先写规格”变成僵化前置门槛；用户如果直接描述网页目标，AI 应先补出最小规格再继续实现。',
      '网页实现必须保持可预览、可评论、可迭代，评论锚点应优先回到预览中的具体元素。',
      '验收默认优先使用 Playwright；如果自动化无法覆盖，必须明确缺口和剩余人工检查项。',
      '部署前必须确认当前版本已通过自动验收，并保存可回滚的里程碑。',
      '优先复用现有 tools、MCP 和 skills；缺能力时要显式暴露扩展需求，而不是把流程写死在内核里。',
    ],
    extensionHints: [
      {
        kind: 'tools',
        summary: '调用实现、预览、Playwright 验收与部署工具，而不是把流程写死在单一路由里。',
      },
      {
        kind: 'mcp',
        summary: '通过开放 MCP 接入设计系统、发布平台或外部数据源，保持执行链路可替换。',
      },
      {
        kind: 'skills',
        summary: '把规格整理、验收和部署经验沉淀成可复用 skills，而不是散落在 prompt 里。',
      },
    ],
    checklist: [
      '规格文档已经明确页面目标、关键模块、内容约束和验收标准。',
      '网页预览可正常打开，主要交互路径已可用。',
      '页面元素评论仍可驱动后续修改，不会因为实现完成而中断。',
      'Playwright 验收结果可追溯，失败项已修复或明确记录。',
      '部署结果、访问入口和回滚线索已经记录。',
    ],
    content:
      '适合作为“从目标到可上线网页”的默认执行方法。它不是强制前置路径，而是一套可复用的执行骨架：用户可以直接要网页，系统会自动补齐规格、实现、验收和部署链路。',
  },
  {
    key: 'deep-research-market-analysis',
    title: '成形类产品市场分析报告',
    summary:
      '通过深度研究生成一份成形类产品市场分析报告，覆盖市场需求、用户痛点、竞品格局与机会判断。',
    steps: [
      '定义研究范围、目标读者、结论粒度和待验证假设。',
      '拆解研究问题，围绕市场需求、目标用户、竞品格局和差异化机会建立子问题。',
      '运行深度研究，收集近期待验证信息、引用来源和相互矛盾的信号。',
      '输出结构化报告，分别总结市场需求、竞品现状、机会窗口与风险判断。',
      '把关键结论、引用完整性和待验证项复核后再固化成报告版本。',
    ],
    constraints: [
      '优先使用深度研究链路，引用必须可追溯；无法确认的结论要明确标记为“待验证”。',
      '报告必须至少覆盖市场需求、目标用户痛点、竞品情况和差异化机会。',
      '研究结果应先沉淀为文档交付物，不要只停留在对话摘要里。',
      '在需要联网信息时优先调用开放 tools、MCP 或 skills 的能力，不把研究能力绑定到单一 provider。',
      '如果浏览器或执行环境提供更友好的 AI 辅助能力，应优先复用已有基础设施而不是重复造轮子。',
    ],
    extensionHints: [
      {
        kind: 'tools',
        summary: '调用搜索、浏览、引用整理和报告落盘工具，把研究动作保持为原子能力。',
      },
      {
        kind: 'mcp',
        summary: '通过开放 MCP 接入市场数据库、竞品情报源或企业内部资料库，不锁死单一 provider。',
      },
      {
        kind: 'skills',
        summary: '把深度研究、信息清洗和报告沉淀方法封装成 skills，方便后续复用与扩展。',
      },
    ],
    checklist: [
      '研究问题已经被拆成明确子问题，并经过计划确认。',
      '报告中包含市场需求与竞品情况两个核心章节。',
      '关键判断附带来源或待验证标记，没有把不确定信息写成定论。',
      '完整报告已保存到交付物，线程内只保留简洁结论与入口。',
      '后续产品或策略动作能直接从报告中提取依据。',
    ],
    content:
      '适合作为深度研究类文档的内置方法。重点不是生成冗长材料，而是把研究计划、引用链路和结论输出固定成可复用的报告工作流。',
  },
];

function toBuiltinWorkflowData(seed: BuiltinWorkflowSeed): WorkflowPlaybookData {
  const builtinId = `${BUILTIN_WORKFLOW_ID_PREFIX}${seed.key}`;
  return {
    id: builtinId,
    organizationId: 'builtin',
    workspaceId: null,
    sourceVersionId: null,
    sourceThreadId: null,
    status: 'active',
    title: seed.title,
    summary: seed.summary,
    steps: seed.steps,
    constraints: seed.constraints,
    checklist: seed.checklist,
    extensionHints: seed.extensionHints,
    content: seed.content,
    archivedAt: null,
    createdByUserId: null,
    originDeviceId: `${BUILTIN_WORKFLOW_ORIGIN_PREFIX}${seed.key}`,
    revision: 1,
    deletedAt: null,
    createdAt: BUILTIN_WORKFLOW_TIMESTAMP,
    updatedAt: BUILTIN_WORKFLOW_TIMESTAMP,
    builtin: true,
  };
}

export function listBuiltinWorkflowPlaybooks() {
  return BUILTIN_WORKFLOW_SEEDS.map(toBuiltinWorkflowData);
}

export function getBuiltinWorkflowPlaybook(id: string | null | undefined) {
  if (!id?.startsWith(BUILTIN_WORKFLOW_ID_PREFIX)) {
    return null;
  }

  return listBuiltinWorkflowPlaybooks().find((workflow) => workflow.id === id) || null;
}

export function getBuiltinWorkflowPlaybookByOriginDeviceId(originDeviceId: string | null | undefined) {
  if (!originDeviceId?.startsWith(BUILTIN_WORKFLOW_ORIGIN_PREFIX)) {
    return null;
  }

  return (
    listBuiltinWorkflowPlaybooks().find(
      (workflow) => workflow.originDeviceId === originDeviceId
    ) || null
  );
}

export function isBuiltinWorkflowPlaybookId(id: string | null | undefined) {
  return Boolean(getBuiltinWorkflowPlaybook(id));
}

export function isBuiltinWorkflowOriginDeviceId(originDeviceId: string | null | undefined) {
  return Boolean(originDeviceId?.startsWith(BUILTIN_WORKFLOW_ORIGIN_PREFIX));
}
