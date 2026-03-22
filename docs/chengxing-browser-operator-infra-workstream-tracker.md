# 成形 Browser Operator Infra Workstream 追踪器

更新时间：2026-03-22
状态：in_progress
对应技能：`program-autopilot`
相关文档：[Browser Operator Contract](./browser-operator-infra-contract.md) · [v-next 差距评估](./chengxing-v-next-gap-assessment.md) · [黑盒验收计划](./testing/blackbox-acceptance-plan.md)

## 当前工作流范围

本追踪器服务 `browser operator 共享 infra` 这条后续 workstream。

- 版本树 workstream 已收口，当前已进入 B1 core runner 阶段。
- 当前优先级已经从版本树切到 browser operator；先落共享 core，再接 runtime 搜索 adapter。
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
| B3 | Blackbox Consumer | pending | blackbox inspector 复用 core，只补场景和报告面。 |

## 当前切片

当前无 active slice。

最近完成的切片：`B2 Runtime Search Adapter`

- 落点：
  - `src/lib/search/types.ts`
  - `src/lib/search/settings.ts`
  - `src/lib/search/catalog.ts`
  - `src/lib/search/providers.ts`
  - `src/lib/search/providers/browser-operator-search.ts`
  - `src/app/settings/page.tsx`
  - `src/app/debug/browser-operator-search/page.tsx`
  - `tests/infra/browser-operator/playwright-driver.ts`
  - `tests/browser-operator/chengxing/runtime-search-adapter.ts`
  - `tests/e2e/iteration/17-browser-operator-search.spec.ts`
- 已交付：
  - `Browser Operator Search` 已作为 `mode='browser'` 的搜索 provider 接入现有 catalog / settings / `/api/search/query` seam，不再额外开一条运行时搜索控制栈。
  - runtime 搜索现在可以真实打开搜索页、等待结果、抽取可见 result card，并回流成标准化 `SearchResult`；API provider 与 browser provider 继续共用同一条上层 contract。
  - 首条稳定回归已落在本地 `/debug/browser-operator-search` surface：既提供确定性门禁，又保留对通用搜索结果 DOM 结构的抽取兼容。

## 下一候选切片

- `B3 Blackbox Consumer`
- 当前前提已满足：共享 core 与 runtime 搜索 consumer 都已落地；下一刀只需要让 blackbox inspector 复用同一套 core。

## 剩余验收项

- `B3` 尚未启动。

## Blockers

- 当前无开放 blocker。

## Verification History

- 2026-03-22：创建 browser operator infra tracker 与 contract bootstrap；未运行 `npm run verify:iteration`，因为本步只涉及文档边界冻结。
- 2026-03-22：完成 `B1 Core Runner`；`tests/infra/browser-operator/` 已落地通用 contract、core runner 和 artifact/transcript 产物路径，browser operator 不再只是文档计划；随后 `npm run verify:iteration` 通过（`63 passed`，约 `3.4m`）。
- 2026-03-22：完成 `B2 Runtime Search Adapter`；`Browser Operator Search` provider 已接入现有 `SearchProvider` / `/api/search/query` 路径，并由 `tests/e2e/iteration/17-browser-operator-search.spec.ts` 覆盖 provider catalog 与浏览器提取闭环；`npm run verify:iteration` 随后通过（`65 passed`，`3.4m`）。
- 2026-03-22：统一 `SYSTEM / CONVENTIONS / CONSTRAINTS / PATTERNS` 的追踪约定，改为按 `program-autopilot` 激活的 tracker 追踪当前任务，不再把 `chengxing-refactor-tracker` 写成唯一默认入口；未运行 `npm run verify:iteration`，因为本步只涉及文档与 tracker 合约。
