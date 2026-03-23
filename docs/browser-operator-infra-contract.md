# Browser Operator Infra Contract

更新时间：2026-03-23
状态：已冻结边界，B3 blackbox consumer 已覆盖 A1-A3 与 B2-B4
对应技能：`program-autopilot`

## 现状

- 成形当前的日常门禁仍是 `npm run verify:iteration`，核心覆盖 `static + Playwright E2E`；这条线继续保持轻量，不承担重型黑盒或浏览器代理能力。
- 共享 `browser operator` infra 已经具备 core runner，并且第一个运行时消费者已经落地：`Browser Operator Search` 现在可以通过现有 `SearchProvider` / `/api/search/query` 路径真实打开搜索页、浏览并抽取可见结果卡片。
- 已有 blackbox 计划文档更多描述的是成形场景矩阵，但浏览器控制本身不该由 blackbox 反向定义；黑盒只是未来消费者之一。
- 版本树 workstream 已收口；当前 runtime 搜索 adapter 已完成，blackbox consumer 也已覆盖 A1-A3 与 B2-B4，并持续输出聚合报告。

## 目标

- 把浏览器控制能力定义成 repo 内的共享 infra，而不是成形项目私有脚本。
- 让这套 infra 先服务成形 runtime 搜索 / 研究，再服务后续黑盒验收 / inspector。
- 避免出现两套平行实现：
  - 一套给产品搜索
  - 一套给 AI 黑盒验收

## 差距

- 共享接口、目录边界和运行边界现在都已冻结，runtime 搜索 adapter 也已落地；黑盒 inspector 也已通过 `tests/blackbox/chengxing/` 接上同一套 core，当前已覆盖 A1-A3 与 B2-B4。
- 运行时搜索虽然已进入现有 `SearchProvider` seam，但后续 blackbox consumer 仍需要复用同一套 `observation / action / artifact` contract，不能再长第二套浏览器控制栈。
- browser operator 当前第一条回归闭环使用本地 debug 搜索面；后续走向更广泛网页时，还需要继续在 adapter 层补更丰富的 target / evaluator 组合，而不是把成形语义倒灌回 core。

## 公共接口 / 类型

- `BrowserOperatorTarget`
  - 定义目标应用的 bootstrap、baseURL、登录/seed、readiness signal、稳定 locator map。
- `BrowserObservation`
  - 定义给 evaluator/agent 的结构化观察，来源于 DOM / 可访问性树 / 关键控件摘要，而不是整页原始 HTML。
- `BrowserAction`
  - 受限动作协议：`goto | click | fill | select | press | wait_for | assert | extract | finish`。
- `BrowserRun`
  - 单次浏览器任务的预算、恢复、产物、终态判断。
- `BrowserEvaluator`
  - 可插拔决策器接口；成形 runtime 搜索先用，blackbox inspector 后用。
- `BlackboxTargetAdapter`
  - 黑盒场景消费者；建立在 `BrowserOperatorTarget` 之上，只补场景矩阵，不反向定义 core。

## 目录与导入边界

- core 目录：`tests/infra/browser-operator/`
- 成形 adapter：`tests/browser-operator/chengxing/`
- 黑盒消费者：后续落在 `tests/blackbox/chengxing/`
- 运行时接入点：当前通过 `src/lib/search/` 与 `/api/search/query` 暴露给成形运行时搜索；后续更高层 agent tool surface 继续复用同一条 `SearchProvider` seam

硬约束：

- `tests/infra/browser-operator/**` 禁止 import `src/lib/workspace`、`src/components`、`src/surfaces` 这类成形对象实现。
- 成形业务词、稳定 selector、seed、模型默认值只能留在 adapter 层。
- 这套能力不进入 `src/framework/` shipped runtime；它属于 test/runtime 共用的 browser control infra。

## 执行计划

1. `B0 Contract Bootstrap`
   - 冻结本 contract 文档和 tracker。
   - 明确 `verify:iteration` 不并入 browser operator / blackbox。

2. `B1 Core Runner`
   - 已在 `tests/infra/browser-operator/` 实现通用 target / observation / action contract、core runner、fail-closed recovery loop、artifact/transcript。

3. `B2 Runtime Search Adapter`
   - 已通过 `tests/browser-operator/chengxing/`、`tests/infra/browser-operator/playwright-driver.ts` 与 `src/lib/search/` 接上成形 runtime 搜索闭环。
   - `Browser Operator Search` 作为 `mode='browser'` provider 接入现有 catalog / settings / `/api/search/query` seam，覆盖“打开网页 -> 浏览 -> 提取 -> 回流结果”最小闭环。
   - 确定性回归落在本地 `/debug/browser-operator-search` surface；adapter 同时兼容稳定 data attribute 和通用搜索结果 DOM class。

4. `B3 Blackbox Consumer`
   - blackbox inspector 复用同一套 core，只补成形场景矩阵和报告面。
   - 当前已落地 `tests/blackbox/chengxing/` consumer scaffold、独立 `playwright.ai-inspector.config.ts` / `npm run test:ai-inspector` 入口，以及 A1-A3 与 B2-B4 场景的 JSON + Markdown 聚合报告。
   - `npm run test:ai-inspector` 会逐场景重置 `.tmp/blackbox-acceptance/app-data/`，保证黑盒矩阵不共享历史状态；seed 的 project root 统一从当前 `DAO_APP_DATA_ROOT` 推导。
   - `DAO_E2E` workspace assistant fallback 在写完草稿后需要覆盖至少一个 workspace polling 窗口；editor programmatic load/reset 不得继续喂给 autosave，以免客户端把服务端草稿回写覆盖。
   - 后续继续补 B1、C1-G1 场景与更丰富的报告面，不单独再起第二套浏览器控制栈。

## 验收标准

- 架构验收
  - `browser operator core` 不含成形对象语义。
  - runtime 搜索与 blackbox inspector 走同一套 action / observation / artifact contract。

- 边界验收
  - `npm run verify:iteration` 继续保持当前轻量定位。
  - browser operator / blackbox 作为额外能力，显式运行，不回流到日常门禁。

- 产品验收
  - 成形能完成至少一个真实的“通过操作浏览器获取信息并回流结果”的搜索闭环。
  - blackbox inspector 在激活后直接复用这套 infra，而不是另起控制栈。
