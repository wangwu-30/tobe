# 成形版本树 workstream 追踪器

更新时间：2026-03-22
状态：in_progress
对应技能：`program-autopilot`
相关文档：[v-next 差距评估](./chengxing-v-next-gap-assessment.md) · [产品落地计划](./chengxing-rollout-plan.md) · [产品北极星](./chengxing-product-north-star.md) · [迭代回归门禁](./testing/iteration-regression-plan.md)

## 当前工作流范围

本追踪器服务 `版本树 / 分支语义升级` 这条独立 workstream。

- 激活背景：`Phase 0-6 重构` 与 `v-next` 主线都已完成；继续推进时，不能再把树状版本管理伪装成旧 workstream 的“顺手收口”。
- 当前主目标：把分支从“历史弹窗里的局部筛选条件”升级成正式的交付物版本树入口。
- 当前不做：评论锚点重定位、预览评论模型扩展、完整独立页面级版本树、发布/分发语义。

## 已确认决策

- 当前版本能力已经具备里程碑、恢复点、比较、继续续写和切换 branch head 的最小闭环；缺口在于分支仍不是一等工作区。
- 当前 workstream 继续遵循“不过分做兼容，优先整体优雅”的执行边界；不为旧聊天线路语义追加新的兼容壳。
- 第一阶段优先把现有 version history 中的 branch focus 升格为 branch workspace，再决定是否把 branch tree 抬成独立表面。
- 任何产品代码切片结束前都必须运行 `npm run verify:iteration`。

## Phase 状态

| Phase | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| 12a | Branch Workspace 首刀 | done | branch focus 已升级为正式 branch workspace：分支摘要、分支内里程碑和分支内 recovery point 现在回到同一条 lineage。 |
| 12b | Branch 内 compare / recovery 管理收口 | pending | 继续评估 branch compare 的默认锚点、跨 branch compare 入口和是否还需要保留全局 recovery 汇总分区。 |
| 12c | 交付物版本树正式表面 | pending | 评估是否把 branch workspace 从 history dialog 抬成独立版本树表面。 |

## 当前切片

当前无 active slice。

最近完成的切片：`12a Branch Workspace 首刀`

- 落点：`src/components/workspace/deliverable-version-controls.tsx`
- 已交付：
  - branch focus 现在进入明确的 branch workspace 模式，而不是只留下一个过滤 banner。
  - 分支摘要里补齐 `里程碑 / 回退点 / 已 Pin / 临时` 统计。
  - branch workspace 会把当前 lineage 的里程碑和 recovery point 放回同一条视图，并按最近可见祖先归属 recovery point。
  - `tests/e2e/iteration/05-branching.spec.ts` 已补回归，验证分支 workspace 会过滤掉其他分支的 recovery 噪音。

## 下一候选切片

- `12b Branch 内 compare / recovery 管理收口`

## 剩余验收项

- `12b-12c` 尚未启动。

## Blockers

- 当前无开放 blocker。

## Verification History

- 2026-03-22：创建本追踪器，正式把“版本树 / 分支语义升级”从 gap assessment 升格为独立 workstream；未运行 `npm run verify:iteration`，因为本步只涉及 tracker bootstrap。
- 2026-03-22：完成 `12a Branch Workspace 首刀`；`deliverable-version-controls` 现在会在 branch focus 下展示正式 branch workspace，把分支摘要、里程碑和 recovery point 收到同一条 lineage，并补充 `05-branching` 回归验证分支 recovery 归属；`npx playwright test tests/e2e/iteration/05-branching.spec.ts` 通过（`9 passed`，约 `46.7s`），随后 `npm run verify:iteration` 通过（`62 passed`，约 `2.7m`）。

## 维护规则

- 每完成一个产品代码切片，先更新本追踪器，再决定是否继续下一切片。
- 若切片沉淀出可复用产品/技术经验，同时更新 `docs/chengxing-lessons-learned.md`。
- 除非新的 shipped fact 真的改变了历史账本，否则不要回写已完成的 `refactor` / `v-next` 追踪器。
