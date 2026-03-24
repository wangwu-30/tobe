# 成形 Browser Operator Runtime Workstream 追踪器

更新时间：2026-03-24
状态：pending（已冻结范围，待产品 bug 修复后启动）
对应技能：`program-autopilot`
相关文档：[Browser Operator Contract](./browser-operator-infra-contract.md) · [v-next 差距评估](./chengxing-v-next-gap-assessment.md) · [商业模型 ADR](./briefs/business-model.md) · [迭代回归门禁](./testing/iteration-regression-plan.md)

## 当前工作流范围

本追踪器服务 `browser operator 运行时 browse / execute infra` 这条新 workstream。

- 当前目标不是继续补黑盒矩阵，而是把 browser operator 从“运行时搜索”扩到更广义的“运行时浏览 / 读取 / 执行”基础设施。
- 本 workstream 只覆盖成形产品运行时可复用的 browse / execute 基建，不覆盖黑盒 consumer 继续扩面。
- 本 workstream 也不激活云端 Workflow 市场、统一计量端点、远端结算等更远期商业化基础设施；这些仍停留在 ADR 约束层，不作为本轮实现范围。
- 用户已明确要求：先补 tracker，再修完 `Product Acceptance Report 20260324`、`Acceptance Fix Proposals` 和 `canvas-overview.md` 对应 bug/优化，再启动本 workstream。

## 已确认决策

- 活跃 planning surface 从黑盒 consumer 切走；blackbox 剩余矩阵暂缓，不作为当前 slice 选择来源。
- 新 workstream 继承既有 `Browser Operator Search` 和 `SearchProvider` seam，但目标不是把更多成形语义塞回现有搜索 provider，而是抽成更通用的 runtime browse / execute capability。
- `tests/infra/browser-operator/` 继续作为共享 core；成形运行时接入可以落在 `src/lib/ai/`、`src/lib/search/`、agent tool seam 或相邻 runtime adapter，但不能把成形对象语义倒灌进 core。
- 本轮优先级是“本地运行时浏览 / 执行能力收口”，不是“远端云执行”。如后续要启动远端执行 / 统一计量，再单独立项。
- 任何产品代码切片结束前，仍必须运行 `npm run verify:iteration`；browser operator 额外专项验证只作为补充，不替代迭代门禁。

## Phase 状态

| Phase | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| R0 | Tracker Bootstrap | done | 新 workstream 范围、非目标、启动门槛已冻结。 |
| R1 | Runtime Browse Read Path | pending | 把现有搜索闭环扩成可按目标页面读取结构化观察的 runtime read path。 |
| R2 | Runtime Execute Path | pending | 在受控预算内支持 click / fill / wait / extract 这类执行型动作，并处理登录态 / 恢复。 |
| R3 | Agent Tool Surface | pending | 把 browse / execute 能力暴露到成形运行时 agent tool / research surface，替代零散特例。 |
| R4 | Hardening + Gate | pending | 为 runtime browse / execute 补 deterministic 回归、文档和 lessons，稳定后再决定是否继续推远端执行。 |

## 当前切片

当前切片：`R0 tracker bootstrap`

- 已交付：
  - 新增本追踪器，冻结当前 active scope、phase 和 stop gate。
  - 明确本 workstream 启动前置：先收完产品验收 bug 和 `canvas-overview.md` 对应优化。
  - 明确非目标：不继续黑盒矩阵，不提前激活云端 Method / 计量 / 结算。
- 启动条件：
  - `Product Acceptance Report 20260324` 与 `Acceptance Fix Proposals` 中当前确认的 bug 已修复。
  - `canvas-overview.md` 中这轮确认要做的优化已完成或被显式重新排期。
  - 完成前置切片后重新运行 `npm run verify:iteration`。

## 下一候选切片

- `R1.1 Runtime Browse Target Contract`
  - 把当前 `Browser Operator Search` 的 target / observation / extract contract 升格为更通用的“页面读取目标”。
- `R1.2 Runtime Browse Adapter`
  - 在成形运行时增加 browse adapter，让 agent 能显式请求“打开页面并读取结构化内容”，而不是伪装成搜索 provider 特例。
- `R1.3 Artifact + Budget Discipline`
  - 把 browse run 的 artifact、预算和恢复语义对齐到运行时 agent surface，避免无限制网页操作。

## 剩余验收项

- 当前 tracker bootstrap 已完成，但 runtime browse / execute 本身尚未启动。
- 本 workstream 真正开始前，需要先关闭前置 bug 切片：
  - `Product Acceptance Report 20260324`
  - `Acceptance Fix Proposals`
  - `canvas-overview.md` 对应本轮确认要做的优化
- R1-R4 的实现验收将在启动后再细化到具体工具面、运行时 contract 和回归场景。

## Blockers

- 缺少 `Product Acceptance Report 20260324` 和 `Acceptance Fix Proposals` 的 repo 内路径；当前只能先冻结 tracker，不能安全开始 bug 修复切片。

## Verification History

- 2026-03-24：创建本追踪器，正式把下一条非黑盒基建 workstream 冻结为 `browser operator runtime browse / execute infra`，并记录“先修产品 bug 再启动”的 gating；未运行 `npm run verify:iteration`，因为当前只涉及 tracker bootstrap。
