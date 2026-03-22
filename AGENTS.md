## Skills

### Available skills

- `dao-change-briefs`: Standardize architecture, product, design, and implementation decision writeups. Use for tradeoff explanations, change proposals, future decision reports, and “what do you mean by X” clarification. Responses should be organized as `现状 / 目标 / 差距 / 执行计划 / 验收标准`. (file: `/Users/wangwu/claude/chat-to-your-mind/skills/dao-change-briefs/SKILL.md`)
- `dao-design-principles`: Apply Dao Ke Dao product and UI design principles when working on navigation, information architecture, layout density, interaction feedback, or frontend cleanup. (file: `/Users/wangwu/claude/chat-to-your-mind/skills/dao-design-principles/SKILL.md`)
- `program-autopilot`: Drive long-running repo execution as a program instead of isolated patches. Use when asked to continue autonomously, keep iterating across bounded slices, finish remaining repo goals, or run an explicitly activated workstream until its active goals are truly done. (file: `/Users/wangwu/.codex/skills/program-autopilot/SKILL.md`)

### How to use skills

- If a request is about architecture direction, tradeoff explanation, change proposals, decision summaries, or future implementation/design decisions, use `dao-change-briefs`.
- If a request is about product design, UI cleanup, navigation, layout consistency, interaction behavior, or simplifying a page while preserving capability, use `dao-design-principles`.
- If a request is about continuing execution autonomously, finishing remaining project plan items, or iterating in this repo until all current scoped goals are closed, use `program-autopilot`.
- Read only the skill file and the specific reference files it points to when needed.

## Iteration Gate

- Every completed feature iteration or bug fix must finish with `npm run verify:iteration`.
- Do not close a task with only `tsc`, `eslint`, or a single targeted Playwright spec.
- `npm run desktop:smoke:packaged` remains a release/package gate, not the default per-iteration gate.
- The authoritative workflow and scenario matrix live in `/Users/wangwu/claude/chat-to-your-mind/docs/testing/iteration-regression-plan.md`.
- If a completed feature iteration, UX cleanup, or bug fix reveals a reusable product/technical lesson or a concrete pitfall, update `/Users/wangwu/claude/chat-to-your-mind/docs/chengxing-lessons-learned.md` before closing the task.
- Treat `/Users/wangwu/claude/chat-to-your-mind/docs/chengxing-lessons-learned.md` as the authoritative ledger for validated best practices and pitfalls; mark not-yet-shipped ideas as `待验证`.

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

- 开始任何工作前，先读 `/Users/wangwu/claude/chat-to-your-mind/SYSTEM.md` 理解对象模型
- 写代码时遵循 `/Users/wangwu/claude/chat-to-your-mind/CONVENTIONS.md` 的目录和命名约定
- 受 `/Users/wangwu/claude/chat-to-your-mind/CONSTRAINTS.md` 的约束
- 按 `/Users/wangwu/claude/chat-to-your-mind/PATTERNS.md` 的模式执行常见任务
- 若当前 workstream 是这轮重构，优先读取 `/Users/wangwu/claude/chat-to-your-mind/docs/chengxing-refactor-tracker.md`
