# 成形统一交付模型进度追踪

更新时间：2026-03-18
状态：进行中
对应技能：[`chengxing-autopilot`](../skills/chengxing-autopilot/SKILL.md)
相关文档：[项目状态](./chengxing-project-status.md) · [产品落地计划](./chengxing-rollout-plan.md) · [v-next 差距评估](./chengxing-v-next-gap-assessment.md) · [迭代回归门禁](./testing/iteration-regression-plan.md)

## 现状

- 当前 iteration goal 已完成并作为本工作流前提：
  - chat prompt 已注入同项目交付物摘要
  - 当前 / 项目 / 全局三层 `Knowledge / Memory` 已进入 prompt
  - `list_project_deliverables` / `read_project_deliverable_file` 已可用
- 当前长期 active goal 仍未完成：
  - 创建流仍先走 `WorkspaceStarterDialog` 手动选 `document / slides / web / code`
  - `slides` 虽已有 `slide_page` block，但仍是独立 `DeliverableType`
  - web 评论仍依赖父页面直读 iframe 选区；当前 raw preview 为跨源 `127.0.0.1`，闭环未成立
  - `Status` 仍保留人工交付类型切换器

## 已确认决策

- 结构化追问放在创建流内完成，不放到创建后的第一轮对话
- `Status` 面板移除人工“交付类型切换器”
- 项目级 AI 上下文视为已完成前提，不重复排期
- web 评论闭环采用预览桥接方案，不继续假设父页面可直接读取 raw preview iframe DOM
- 本阶段不做通用 chat widget 系统；创建追问先做创建流专用组件

## 阶段追踪

| 阶段 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| Phase 0 | 项目级 AI 上下文基线 | 已完成 | 当前 iteration goal，作为后续前提 |
| Phase 1 | 创建流去类型化 | 进行中 | 当前切片 |
| Phase 2 | `slides` 并入 `document` | 未开始 | 依赖 Phase 1 清掉入口显式类型选择 |
| Phase 3 | web 画词评论闭环 | 未开始 | 需要预览桥接层 |
| Phase 4 | 语义收口与 plan 动态化 | 未开始 | 收尾阶段 |

## 当前切片

### Phase 1：创建流去类型化

目标：

- 删除首页和工作区里的 `WorkspaceStarterDialog`
- `GoalComposerDialog` 去掉锁定的 `deliverableType` 展示
- 引入创建流意图判定与创建内追问卡片
- 支持 `document / web / both / clarify`
- 让创建 API 和恢复存储不再要求前端先传具体 `deliverableType`

当前进度：

- 已确认当前 repo 没有 `inferDeliverableType -> null -> 追问` 链路
- 已确认 `GoalComposerDialog` 仍把 `deliverableType` 视为必填值
- 已确认首页与工作区都先弹 `WorkspaceStarterDialog`
- 已确认当前切片无现成半截实现，可直接按计划落地

待完成项：

- 新增创建流 intent resolver
- 改造 Goal Composer 为“输入 -> 追问 -> 创建”两段流
- 支持 `both` 创建同项目双交付物
- 更新 E2E、文案和恢复存储
- 跑 `npm run verify:iteration`

## 验收记录

- 2026-03-18：项目级 AI 上下文切片已通过 `npm run verify:iteration`，作为本工作流前提。
- 2026-03-18：统一交付模型 tracker 建立，用于持续记录阶段状态、当前切片和验证结果。

## 进度更新规则

- 每完成一个 bounded slice，必须更新：
  - 当前阶段状态
  - 当前切片进度
  - 验收记录
- 每次 `npm run verify:iteration` 后，都要在本文件追加结果，并立刻判断下一切片是否继续推进。
