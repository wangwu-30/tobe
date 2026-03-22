# 成形运行时健壮性改造追踪器

更新时间：2026-03-22
状态：已完成
对应技能：`program-autopilot`
相关文档：[健壮性改造方案](./briefs/resilience-overhaul.md) · [迭代回归门禁](./testing/iteration-regression-plan.md) · [项目约束](../CONSTRAINTS.md) · [实现模式](../PATTERNS.md) · [目录约定](../CONVENTIONS.md)

## 当前工作流范围

- 本 workstream 只服务 [健壮性改造方案](./briefs/resilience-overhaul.md) 的 R1-R4，不并行激活其他 backlog。
- 当前目标是直接收口到 brief 定义的理想态，不为了兼容历史写法再补一层临时胶水。
- 用户已明确确认两条执行原则：
  - 按目标理想态做，不做保守折中版
  - 不过分做兼容，整体方案优雅优先

## 已确认决策

- `src/framework/resilience/` 作为统一运行时安全层，不把业务对象名塞进 framework。
- 新增的防线按 brief 的四道防线推进：视图防护、数据安全、通信韧性、服务端契约。
- 预览自动启动、评论 fallback、bridge 注入增强、i18n 收口都属于本 workstream 范围内的功能性修复，不单独拆成旁支任务。
- 编译期防退化至少要覆盖三条底线：禁裸 `JSON.parse`、禁裸 `fetch`、API route 禁直接导出裸 HTTP handler。
- 优先删除兼容阴影，而不是继续保留旧调用方式和旧错误处理分叉。

## Phase 状态

| Phase | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| R1 | 基础设施落地 | 已完成 | `framework/resilience/*`、route error page、全局错误处理、ESLint 三条门禁已经落地。 |
| R2 | 存量迁移 | 已完成 | 裸 `JSON.parse` 已清零（仅 `safe-data.ts` 自身保留），route wrapper / preview polling / settings boundary /主路径 API client 已完成迁移。 |
| R3 | 功能缺陷修复 | 已完成 | 预览自动启动、评论能力矩阵、manual 评论 fallback、bridge 注入增强、comment i18n 收口已全部落地并经 E2E 覆盖验证。 |
| R4 | 验证闭环 + 合约更新 | 已完成 | `npm run verify:iteration:static` 和全量 `npm run verify:iteration` 已通过；tracker / lessons learned 已按最终结果收口。 |

## 最终交付

### Slice A：编译期约束与运行时接线收口

目标：

- 补齐 resilience tracker，固定当前 frontier
- 清掉剩余裸 `JSON.parse`
- 落地 ESLint 三条约束并修正调用方
- 收口 workspace / settings 的 boundary 和 preview 恢复轮询接线

最终结果：

- 已新增 `src/framework/resilience/` 基础设施和 route-level error pages
- 已将 `src/app/api/**/route.ts` 主体批量迁到 `defineRoute(...)`
- 已将 workspace read/polling 主路径切到 `apiCall` / `createPollController`
- 已把 `src/` 中裸 `JSON.parse` 清零到只剩 `safe-data.ts` 自身
- 已把 settings page 分区 `ZoneErrorBoundary`、chat/version/manual comment 等主界面 resilience client 接线补齐
- 已把 web/manual comment fallback、preview bridge 注入增强、部分 i18n 收口推进到位
- 已补齐 resilience 专项 E2E，并把首页继续流、评论应用轮询、workspace 路由稳定等待这些全量门禁中的假红点一并收口
- 已完成全量 `npm run verify:iteration`，得到 62 个 E2E 用例全通过

## 下一候选切片

- 本 workstream 已按 brief 理想态收口，无待接续切片

## 剩余验收项

- 运行时验收 `A1-A9`：已完成
- 编译期验收 `B1-B4`：已完成
- 合约文档验收 `C1-C4`：已完成

## Blockers

- 无。早前出现的 Next/Turbopack panic 未在最终门禁复现，最终阻断点实为全量回归中的测试竞争条件而非产品断言失败。

## Verification History

- 2026-03-22：创建本追踪器，冻结本 workstream 的范围、阶段状态和当前 frontier；未运行 `npm run verify:iteration`，因为当前仍处于实现中途。
- 2026-03-22：完成编译期门禁收口；`rg "JSON.parse\\(" src` 仅剩 `src/framework/resilience/safe-data.ts` 自身，`rg "export async function (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)" src/app/api` 为 0，`npm run verify:iteration:static` 通过。
- 2026-03-22：尝试运行全量 `npm run verify:iteration`；static 和 bootstrap 通过，但 E2E 阶段遇到 Next/Turbopack panic 并挂死，当前未得到完整运行时回归结果。
- 2026-03-22：定位并修复全量门禁中的三类假红来源：首页首屏 `waitForResponse` 注册过晚、跨 workspace 继续流的 URL 稳定等待不足、评论应用轮询预算偏短。
- 2026-03-22：重新运行受影响 spec（`01-home-start`、`04-comments`）及相关文件级回归，全部通过。
- 2026-03-22：完成全量 `npm run verify:iteration`，结果为 `62 passed (3.8m)`；其中 resilience 专项 `16-resilience-overhaul.spec.ts` 的 `A1-A9` 全部通过。
