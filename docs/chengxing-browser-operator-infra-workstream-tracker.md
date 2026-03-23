# 成形 Browser Operator Infra Workstream 追踪器

更新时间：2026-03-23
状态：in_progress
对应技能：`program-autopilot`
相关文档：[Browser Operator Contract](./browser-operator-infra-contract.md) · [v-next 差距评估](./chengxing-v-next-gap-assessment.md) · [黑盒验收计划](./testing/blackbox-acceptance-plan.md)

## 当前工作流范围

本追踪器服务 `browser operator 共享 infra` 这条后续 workstream。

- 版本树 workstream 已收口，当前已进入 B3 blackbox consumer 阶段。
- 当前优先级已经从 core / runtime 搜索 adapter 切到 blackbox matrix 扩充；先补上下文 / 研究场景，再收尾剩余矩阵。
- 未来消费者顺序固定：
  - 成形 runtime 搜索 / 研究
  - 黑盒验收 / inspector

## 已确认决策

- browser operator 是共享 infra，不是成形项目定制能力。
- repo 内任务追踪按 `program-autopilot` 激活的 workstream tracker 进行；核心 contract docs 不再硬编码 `chengxing-refactor-tracker`。
- core 落在 `tests/infra/browser-operator/`，成形 adapter 落在 `tests/browser-operator/chengxing/`。
- 这套能力不进入 shipped runtime 的 `src/framework/`；它属于 test/runtime 共用的 browser control infra。
- `verify:iteration` 继续保持轻量 E2E 门禁，不并入 browser operator 或 blackbox。
- blackbox 是 browser operator 的消费者，不再反向定义 infra 边界。

## Phase 状态

| Phase | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| B0 | Contract Bootstrap | done | contract 与 tracker 已建立，目录边界和消费者顺序已冻结。 |
| B1 | Core Runner | done | 通用 target / observation / action contract、core runner、fail-closed 恢复循环、artifact/transcript 已落地到 `tests/infra/browser-operator/`。 |
| B2 | Runtime Search Adapter | done | 成形 runtime 搜索已通过现有 `SearchProvider` / `/api/search/query` seam 接入 browser operator，完成首个浏览器搜索闭环。 |
| B3 | Blackbox Consumer | in_progress | blackbox inspector 已复用 core 落地 A1-A3 与 B2-B4、独立 runner、逐场景隔离重置和聚合报告；B1 评论与其余矩阵待继续补齐。 |

## 当前切片

当前切片：`B3.4 上下文 / 研究矩阵`

- 落点：
  - `playwright.ai-inspector.config.ts`
  - `scripts/test-ai-inspector.mjs`
  - `tests/blackbox/chengxing/ai-inspector.spec.ts`
  - `tests/blackbox/chengxing/runner.ts`
  - `tests/blackbox/chengxing/scenarios.ts`
  - `tests/blackbox/chengxing/report.ts`
  - `tests/blackbox/chengxing/types.ts`
  - `package.json`
- 已交付：
  - `B3.1` 已完成：黑盒 consumer 已在 `tests/blackbox/chengxing/` 落地，不再停留在文档计划。
  - `B3.2` 已完成：`npm run test:ai-inspector` 现在串行执行 A1-A3 首次使用场景，覆盖直达 workspace、web 预览自动启动和歧义追问卡片三条路径。
  - `B3.3` 已完成：`npm run test:ai-inspector` 已补齐 B2-B4 日常创作场景，覆盖对话推进、版本保存与分支切换三条主路径。
  - runner 会在每个场景前重置 `.tmp/blackbox-acceptance/app-data/`，保证黑盒场景不共享历史状态；seed 的 project root 也统一从当前 `DAO_APP_DATA_ROOT` 推导，不再复用 iteration helper。
  - `DAO_E2E` fallback 现会在持久化草稿后保留至少一个 workspace polling 窗口；editor programmatic load/reset 也不再触发 autosave，避免客户端把服务端黑盒草稿回写覆盖。
  - 当前会输出 browser operator artifact、场景级 `scenario-report.json`、分场景 HTML report，以及聚合 `report.json` / `report.md`；当前已覆盖 A1-A3 与 B2-B4。

## 下一候选切片

- `B3 收尾：设置 / 恢复 / 模型矩阵`
- 在 `B3.4` 完成 B1、C1-C3、D1 后，继续补 E1-E2、F1-F2、G1 场景矩阵和对应 evaluator。

## 剩余验收项

- `B3` 当前已覆盖 A1-A3、B2-B4；B1、C1-C3、D1、E1-E2、F1-F2、G1 仍待落地。
- visual layer 仍未启动，当前黑盒 consumer 只覆盖 Layer 2 AI inspector。

## Blockers

- 当前无开放 blocker。

## Verification History

- 2026-03-22：创建 browser operator infra tracker 与 contract bootstrap；未运行 `npm run verify:iteration`，因为本步只涉及文档边界冻结。
- 2026-03-22：完成 `B1 Core Runner`；`tests/infra/browser-operator/` 已落地通用 contract、core runner 和 artifact/transcript 产物路径，browser operator 不再只是文档计划；随后 `npm run verify:iteration` 通过（`63 passed`，约 `3.4m`）。
- 2026-03-22：完成 `B2 Runtime Search Adapter`；`Browser Operator Search` provider 已接入现有 `SearchProvider` / `/api/search/query` 路径，并由 `tests/e2e/iteration/17-browser-operator-search.spec.ts` 覆盖 provider catalog 与浏览器提取闭环；`npm run verify:iteration` 随后通过（`65 passed`，`3.4m`）。
- 2026-03-22：统一 `SYSTEM / CONVENTIONS / CONSTRAINTS / PATTERNS` 的追踪约定，改为按 `program-autopilot` 激活的 tracker 追踪当前任务，不再把 `chengxing-refactor-tracker` 写成唯一默认入口；未运行 `npm run verify:iteration`，因为本步只涉及文档与 tracker 合约。
- 2026-03-23：完成 `B3.1 A1 Blackbox Consumer Scaffold`；`npm run test:ai-inspector` 已使用独立 `.tmp/blackbox-acceptance/` 根目录跑通 A1 首次使用场景，并生成聚合 `report.json` / `report.md`；随后 `npm run verify:iteration` 通过（结果见最新记录）。
- 2026-03-23：完成 `B3.2 黑盒场景扩充`；`npm run test:ai-inspector` 已串行跑通 A1-A3，逐场景重置 app-data，聚合平均分 `4.6`；随后 `npm run verify:iteration` 通过（`76 passed`，`3.9m`）。
- 2026-03-23：完成 `B3.3 日常创作场景扩充`；`npm run test:ai-inspector` 已串行跑通 A1-A3 与 B2-B4，blackbox seed 统一从当前 `DAO_APP_DATA_ROOT` 推导项目根目录，`DAO_E2E` fallback 与 editor autosave 竞态也已收口；随后 `npm run verify:iteration` 通过（`76 passed`，`3.9m`）。
