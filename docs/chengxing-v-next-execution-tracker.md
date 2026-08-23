# 成形 v-next 执行追踪器

> **Historical / completed snapshot（2026-08-21）**：本文保留已完成 workstream 的阶段与验收记录，不代表当前状态。当前入口见 [README](../README.md)、[SYSTEM](../SYSTEM.md) 与 [Agent Room 与持久执行落地追踪器](./agent-room-execution-workstream.md)。

更新时间：2026-03-22
状态：done
对应技能：`program-autopilot`
相关文档：[Phase 0-6 重构追踪器](./chengxing-refactor-tracker.md) · [v-next 差距评估](./chengxing-v-next-gap-assessment.md) · [产品北极星](./chengxing-product-north-star.md) · [迭代回归门禁](./testing/iteration-regression-plan.md)

## 当前工作流范围

本追踪器服务 Phase 7 之后的新 workstream：

- Phase 7 先收完重构残留，只做这轮已明确确认的 3 个收口项：`7a Label 写侧收口`、`7b façade 清理`、`7c getWorkspaceView 拆分`
- Phase 7 收口后，再转入用户可感知的产品能力推进，不再把北极星新增边界伪装成“历史残留”
- 当前已确认的 Phase 7 后产品队列按优先级为：`多交付物项目` -> `Status 纯推导` -> `renderAs 扩展验证` -> `通用知识沉淀`

## 已确认决策

- `docs/chengxing-refactor-tracker.md` 保留为 Phase 0-6 的历史账本；从本轮开始，新的切片选择与 stop gate 以本追踪器为准
- Phase 7 目标时长约 `1-2 天`，按 `7a -> 7b -> 7c` 顺序推进，不并行跳做
- `7a Label 写侧收口` 的目标是消灭双写：`Version.versionType` 降为只读 legacy 字段，只保留向后读取兼容
- `7a` 的退出条件是：`rg "versionType" src/` 只剩类型定义和 schema mapping 层，不再出现在任何 CRUD 或查询条件里
- `7b façade 清理` 的目标是把 `src/lib/workspace/service.ts` 压到约 `800-1000` 行，只保留真正的跨对象编排逻辑，例如 `continueFromVersion`、`getWorkspaceView`、`updateWorkspace`
- `7c getWorkspaceView 拆分` 的目标是把当前约 330 行的视图组装函数拆成 `buildWorkspaceView` 编排入口加分领域 builder，并把版本历史 / 评论列表 / 对话列表组装下沉到各自 object query seam
- Phase 7 完成前，不提前激活产品新主线；Phase 8 之后优先启动“多交付物项目”，因为它最直接对应北极星里尚未补齐的系统边界
- 任何会改动产品代码或行为的完整切片，结束前都必须运行 `npm run verify:iteration`

## Phase 状态

| Phase | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| 7a | Label 写侧收口 | done | `versionType` 已退出写侧与查询条件；现在只保留类型 / schema mapping 的 legacy 读兼容。 |
| 7b | façade 清理 | done | file/version CRUD façade 与 residual re-export caller 已退出 `service.ts`；当前剩下的 import 只指向真正的编排入口。 |
| 7c | `getWorkspaceView` 拆分 | done | conversation / version / project / status 组装都已下沉到相邻 seam，`service.ts` 已压到 `951` 行。 |
| 8 | 多交付物项目 | done | `8a-8c` 已收口项目壳、当前交付物、下一份交付物和首页/项目入口继续动作；多交付物项目的主叙事已稳定。 |
| 9 | `Status` 纯推导 | done | `currentStatus / deriveWorkflowSummary` 已退出 runtime/view contract；正式字段现在是 `workflowStatus / deriveStatus`。 |
| 10 | 新 `renderAs` 类型验证 | done | `10a-10c` 已把中心结果壳、AI/debug、first-pass prompt 与 plan / replan prompt 全部收口到 `renderAs` 结果形态 contract。 |
| 11 | 通用知识沉淀 | done | 已在 repo 内落下 canonical `docs/knowledge/*` 索引与 `Electron / Prisma / Playwright` 经验文档；外部同步不再作为本 workstream 前置条件。 |

## 当前切片

### 当前无 active slice

本 workstream 已收口：

- Phase 10 已完成：`renderAs` 结果形态 contract 现在贯穿中心结果壳、AI/debug、first-pass prompt，以及 plan / replan prompt；planning 提示显式区分 `Current result shape` 和 `Plan blueprint type`
- Phase 11 已完成：新增 repo-local `docs/knowledge/*` 作为当前 canonical 通用知识索引，先把 `Playwright` 迭代门禁、`Prisma` schema/object seam 演进、`Electron / preview bridge` 运行时经验落到仓库内文档
- 当前 repo 内没有剩余已确认的 phase backlog；如需继续，下一轮应新建独立 workstream，而不是继续扩写本 tracker

## 下一候选切片

- 当前无下一候选切片

## 剩余验收项

- 当前无剩余验收项

## Blockers

- 当前无开放 blocker

## Verification History

- 2026-03-21：创建本追踪器，正式把新工作流切到“Phase 7 重构残留收口 -> 产品主线推进”；未运行 `npm run verify:iteration`，因为本切片只涉及 tracker bootstrap 与执行面切换。
- 2026-03-21：完成 Phase 7a `Label` 写侧收口；`createWorkspaceVersion` 改为显式 `recovery` 语义、`setWorkspaceVersionPinned` 不再写 `Version.versionType`，restore / continue / staged-change / AI recovery checkpoint writer 一并切到新 contract，`Version.versionType` 在 schema 中标记为 `@deprecated`。`rg "versionType" src/` 现仅剩类型定义与 schema mapping 命中；`npm run verify:iteration` 通过（`52 passed`，约 `1.7m`）。
- 2026-03-21：推进 Phase 7b 第一刀；conversation message / assistant run / workspace lock CRUD 已迁入 `objects/conversation/*` 与 `objects/workspace/*`，相关 route、AI runner、research route 和 lock error import 改为直连 object seam；`npm run verify:iteration` 通过（`52 passed`，约 `1.8m`）。
- 2026-03-21：推进 Phase 7b 第二刀；`createConversationForWorkspace` 与 `branchConversation` 已迁入 `objects/conversation/commands.ts`，comment / chat request / branch route / agent tool 调用方同步切换，`service.ts` 压到 `1288` 行；`npm run verify:iteration` 再次通过（`52 passed`，约 `1.9m`）。
- 2026-03-21：完成 Phase 7b 第三刀；project / folder / thread / workspace create route 的 residual pure re-export caller 已切到 `objects/project/*`、`objects/file/schema` 与相邻 view seam，`service.ts` 仅保留真实 orchestration import，压到 `1089` 行；`npm run verify:iteration` 通过（`52 passed`，约 `2.1m`）。
- 2026-03-21：启动 Phase 7c 第一刀；`getWorkspaceView` 中的 `current/latest conversation`、`conversationTree` 与 `assistant runs` 组装已下沉到 `src/objects/conversation/queries.ts#getWorkspaceConversationState`，`service.ts` 进一步压到 `969` 行；`npm run verify:iteration` 通过（`52 passed`，约 `2.0m`）。
- 2026-03-21：推进 Phase 7c 第二刀；`selectedVersion / visibleVersions / versionFiles / currentFile` 已下沉到 `src/objects/state/queries.ts#buildWorkspaceVersionSelection`，`service.ts` 压到 `965` 行；`npm run verify:iteration` 通过（`52 passed`，约 `1.9m`）。
- 2026-03-21：完成 Phase 7c 第三刀；`deliverable / activePreviewRun / currentStatus / hydratedWorkspacePlan` 与 `currentProject / projectFolders / projectDeliverables` 已分别下沉到 `src/objects/workspace/view.ts#buildWorkspaceRuntimeSurface` 和 `src/objects/project/view.ts#buildWorkspaceProjectSurface`，`service.ts` 压到 `951` 行，Phase 7 正式收口；`npm run verify:iteration` 通过（`52 passed`，约 `1.8m`）。
- 2026-03-21：完成 Phase 8 第一刀 bootstrap；基于 gap assessment 和北极星，把“多交付物项目”收成 `8a 项目壳 / 当前交付物叙事收口`，明确第一刀落点在 `workspace route chrome + deliverable sidebar + workspace page state`，非目标是多中心编辑、版本树升级和项目级 AI 扩 scope；未运行 `npm run verify:iteration`，因为本刀只更新执行面文档。
- 2026-03-21：推进 Phase 8a 第一刀产品代码；workspace header 已显式区分 `当前项目 / 当前交付物`，同项目切换器显示完整 `project / folder` 路径，sidebar 新增 `当前项目` 摘要卡；首页与工作区项目列表读侧改走薄路由 `/api/project-list`，旧 `/api/projects` list surface 退出，`01-home-start` 与 `06-workflow-status` 回归同步更新。`npm run verify:iteration` 通过（`52 passed`，约 `1.4m`）。
- 2026-03-21：完成 Phase 8a 第二刀产品代码；sidebar project tree 为当前交付物补上显式 badge，并在当前行直接暴露“在这里新建交付物”入口，把同项目内的切换/继续创建都留在项目语境里；`06-workflow-status` 回归同步覆盖当前 badge 与项目树创建入口。`npm run verify:iteration` 通过（`52 passed`，约 `1.9m`）。
- 2026-03-21：完成 Phase 8b 产品代码；workspace 标题栏按钮、完成态下一步卡片与项目树当前行动作统一改成“继续下一份交付物 / 从这里继续下一份”语义，deliverable 创建弹窗说明同步改成“沿着当前项目继续推进”，`06-workflow-status` 回归显式断言 `同级 / New Sibling Deliverable` 已退出用户表面。`npm run verify:iteration` 通过（`52 passed`，约 `1.8m`）。
- 2026-03-21：完成 Phase 8c 产品代码；首页项目卡和项目入口已显式补上“继续当前交付物 / 继续下一份交付物”的项目内继续语义，多交付物项目主叙事正式收口，Phase 8 转为 `done`。`npm run verify:iteration` 通过（`52 passed`，约 `1.9m`）。
- 2026-03-21：完成 Phase 9 `Status` 纯推导收口；workspace runtime/view contract 统一改成 `workflowStatus / deriveStatus`，`currentStatus / deriveWorkflowSummary` 退出工作区正式接口。`npm run verify:iteration` 通过（`53 passed`，约 `1.7m`）。
- 2026-03-21：完成 Phase 10a `renderAs` 结果壳显式化；`DeliverableData.renderAs` 正式进入 planning seam 与中心结果壳，`document / slides / web` 结果面不再靠隐式条件推断。`npm run verify:iteration` 通过（`53 passed`，约 `2.0m`）。
- 2026-03-21：推进 Phase 10b `renderAs` AI/debug/prompt 读侧收口；project AI context、`get_workspace_context`、`read_project_deliverable_file` 和 first-pass prompt 现在统一读 `renderAs`，legacy slides 调试面显式显示 `renderAs=slides`，同时修复了 `14-project-ai-context` 里共享 note 文本导致的 strict-locator 假红。`npx playwright test tests/e2e/iteration/14-project-ai-context.spec.ts` 通过（`5 passed`，约 `15.0s`），随后 `npm run verify:iteration` 再次通过（`53 passed`，约 `1.9m`）。
- 2026-03-22：完成 Phase 10c `plan / replan prompt` 收口；`generatePlanStepsWithAI`、plan generate route 与 replan proposal prompt 现在显式区分 `Current result shape` 和 `Plan blueprint type`，plan 提示不再把 `renderAs=slides` 的当前交付物叫成普通 document。`npm run verify:iteration` 通过（`53 passed`，约 `1.7m`）。
- 2026-03-22：完成 Phase 11 `通用知识沉淀`；新增 `docs/knowledge/README.md`、`playwright-iteration-regression.md`、`prisma-schema-and-object-seams.md` 与 `desktop-preview-runtime.md`，把 repo-local 文档定为当前 canonical knowledge sink。未运行新的 `npm run verify:iteration`，因为本切片只更新知识文档与追踪面。

## 维护规则

- 每完成一个产品代码切片，先更新本追踪器，再决定是否继续下一切片
- Phase 7 已完成；当前产品队列按 `多交付物项目 -> Status 纯推导 -> renderAs 扩展验证 -> 通用知识沉淀` 推进
- Phase 8 激活后，先把当前刀的 acceptance 和非目标写清，再落产品代码
- 若切片改变了合约、门禁或可复用经验，同时更新对应文档与 `docs/chengxing-lessons-learned.md`
