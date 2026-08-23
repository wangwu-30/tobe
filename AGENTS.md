## Skills

### Available skills

- `dao-change-briefs`: Standardize architecture, product, design, and implementation decision writeups. Use for tradeoff explanations, change proposals, future decision reports, and “what do you mean by X” clarification. Responses should be organized as `现状 / 目标 / 差距 / 执行计划 / 验收标准`. (file: `skills/dao-change-briefs/SKILL.md`)
- `dao-design-principles`: Apply Dao Ke Dao product and UI design principles when working on navigation, information architecture, layout density, interaction feedback, or frontend cleanup. (file: `skills/dao-design-principles/SKILL.md`)
- `product-acceptance`: Execute full-spectrum product acceptance: preflight checks (server/db/browser), black-box browser audit page-by-page, and structured issue reporting with severity levels. Use when asked to "验收", "全面检查", "产品质量审计", or before milestone delivery. (file: `skills/product-acceptance/SKILL.md`)
- `program-autopilot`: Drive long-running repo execution as a program instead of isolated patches. Use when asked to continue autonomously, keep iterating across bounded slices, finish remaining repo goals, or run an explicitly activated workstream until its active goals are truly done. (external skill; use its session-provided location)
- `web-design-guidelines`: Review UI code for Web Interface Guidelines compliance, including accessibility, UX, and Web best practices. (file: `.agents/skills/web-design-guidelines/SKILL.md`)

### How to use skills

- If a request is about architecture direction, tradeoff explanation, change proposals, decision summaries, or future implementation/design decisions, use `dao-change-briefs`.
- If a request is about product design, UI cleanup, navigation, layout consistency, interaction behavior, or simplifying a page while preserving capability, use `dao-design-principles`.
- If a request is about product acceptance, full QA audit, "验收", black-box testing, or milestone delivery readiness check, use `product-acceptance`.
- If a request is about continuing execution autonomously, finishing remaining project plan items, or iterating in this repo until all current scoped goals are closed, use `program-autopilot`.
- If a request is to review UI, accessibility, UX, or Web best-practice compliance, use `web-design-guidelines`.
- Read only the skill file and the specific reference files it points to when needed.

## Iteration Gate

- Every completed feature iteration or bug fix must finish with `npm run verify:iteration`.
- Do not close a task with only `tsc`, `eslint`, or a single targeted Playwright spec.
- `npm run build` is the Web production build gate; the three Node services are built and tested by `npm run test:control-plane`.
- The authoritative workflow and scenario matrix live in `docs/testing/iteration-regression-plan.md`.
- If a completed feature iteration, UX cleanup, or bug fix reveals a reusable product/technical lesson or a concrete pitfall, update `docs/chengxing-lessons-learned.md` before closing the task.
- Treat `docs/chengxing-lessons-learned.md` as the authoritative ledger for validated best practices and pitfalls; mark not-yet-shipped ideas as `待验证`.

## 沟通合约

- 当用户追问“测试报告的问题是否都修完了”这类 closure 问题时，先区分：
  - `门禁 / 主链路是否恢复`
  - `报告里的每一条批注是否都做了独立修复`
- 不要把上述两件事混成一个模糊的“已完成”。
- 如果只有 blocker 路径已修并且 `npm run verify:iteration` 已通过，要明确写出这个边界。
- 如果报告中仍有条目没有在本轮做独立 patch，要明确标成 `未单独 closure`，不能默认暗示“整份报告逐条清零”。
- 当用户要求对照报告时，默认输出 `问题 -> 修复点 -> 验证结果`，并区分：
  - `代码已修改并验证`
  - `被其他修复连带覆盖`
  - `尚未处理`

## 项目合约

- 开始任何工作前，先读 `SYSTEM.md` 理解对象模型
- 写代码时遵循 `CONVENTIONS.md` 的目录和命名约定
- 受 `CONSTRAINTS.md` 的约束
- 按 `PATTERNS.md` 的模式执行常见任务
- 当前 active tracker 是 `docs/agent-room-execution-workstream.md`；旧 tracker 只作为历史记录，不参与当前切片选择
- 产品严格 Web-only；生产面是 Next.js Web 加 execution daemon、Room Session Host、knowledge merge worker 三个独立 Node 服务
- 身份表述必须区分已实现的 team-mode schema/membership role/organization ACL 与当前 trusted local
  single-user principal；不得声称 production IdP、登录/session/JWT、成员邀请/provisioning 或企业 SSO 已交付
- Project Room 是默认 Agent 入口；Room Agent Session 与 durable `ExecutionJob` 必须保持独立生命周期
- `git-worktree` 是 capability 名；当前实现是 per-attempt isolated clone/workspace，不是 native registered worktree
- 远程 Git credential/fetch/push 与 monorepo subpath mount 是明确 non-goal
- 本地 SQLite 由 bootstrap 强制 WAL，并通过 safe Prisma/libSQL adapter 访问；busy retry 只能包住可幂等重放的完整 durable command
- 完整门禁结论只能来自当次 `npm run verify:iteration`；不得用 targeted test、历史数字或环境假设代替，
  本轮结论由本轮最终 gate 补录
