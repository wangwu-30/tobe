## Skills

### Available skills

- `dao-change-briefs`: Standardize architecture, product, design, and implementation decision writeups. Use for tradeoff explanations, change proposals, future decision reports, and “what do you mean by X” clarification. Responses should be organized as `现状 / 目标 / 差距 / 执行计划 / 验收标准`. (file: `/Users/wangwu/claude/chat-to-your-mind/skills/dao-change-briefs/SKILL.md`)
- `dao-design-principles`: Apply Dao Ke Dao product and UI design principles when working on navigation, information architecture, layout density, interaction feedback, or frontend cleanup. (file: `/Users/wangwu/claude/chat-to-your-mind/skills/dao-design-principles/SKILL.md`)
- `chengxing-autopilot`: Drive long-running execution in this repo with plan-first discipline. Use when asked to continue autonomously, finish remaining repo goals, clear items from `PLAN_1.md` / `PLAN_2.md`, or keep iterating until the current in-scope 成形 tasks are actually done. (file: `/Users/wangwu/claude/chat-to-your-mind/skills/chengxing-autopilot/SKILL.md`)

### How to use skills

- If a request is about architecture direction, tradeoff explanation, change proposals, decision summaries, or future implementation/design decisions, use `dao-change-briefs`.
- If a request is about product design, UI cleanup, navigation, layout consistency, interaction behavior, or simplifying a page while preserving capability, use `dao-design-principles`.
- If a request is about continuing execution autonomously, finishing remaining project plan items, or iterating in this repo until all current scoped goals are closed, use `chengxing-autopilot`.
- Read only the skill file and the specific reference files it points to when needed.

## Iteration Gate

- Every completed feature iteration or bug fix must finish with `npm run verify:iteration`.
- Do not close a task with only `tsc`, `eslint`, or a single targeted Playwright spec.
- `npm run desktop:smoke:packaged` remains a release/package gate, not the default per-iteration gate.
- The authoritative workflow and scenario matrix live in `/Users/wangwu/claude/chat-to-your-mind/docs/testing/iteration-regression-plan.md`.
- If a completed feature iteration, UX cleanup, or bug fix reveals a reusable product/technical lesson or a concrete pitfall, update `/Users/wangwu/claude/chat-to-your-mind/docs/chengxing-lessons-learned.md` before closing the task.
- Treat `/Users/wangwu/claude/chat-to-your-mind/docs/chengxing-lessons-learned.md` as the authoritative ledger for validated best practices and pitfalls; mark not-yet-shipped ideas as `待验证`.

## 项目合约

- 开始任何工作前，先读 `/Users/wangwu/claude/chat-to-your-mind/SYSTEM.md` 理解对象模型
- 写代码时遵循 `/Users/wangwu/claude/chat-to-your-mind/CONVENTIONS.md` 的目录和命名约定
- 受 `/Users/wangwu/claude/chat-to-your-mind/CONSTRAINTS.md` 的约束
- 按 `/Users/wangwu/claude/chat-to-your-mind/PATTERNS.md` 的模式执行常见任务
- 若当前 workstream 是这轮重构，优先读取 `/Users/wangwu/claude/chat-to-your-mind/docs/chengxing-refactor-tracker.md`
