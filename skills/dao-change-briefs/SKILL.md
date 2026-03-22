---
name: dao-change-briefs
description: Standardize architecture, product, design, and implementation decision writeups. Use when explaining tradeoffs, proposing changes, comparing options, or reporting future decision points. Organize responses as 现状, 目标, 差距, 执行计划, 验收标准, and define key terms in product-language instead of vague shorthand.
---

# Dao Change Briefs

Use this skill whenever the work involves:

- architecture direction
- product or UX tradeoffs
- implementation proposal reviews
- follow-up decision reports
- explaining what a term means and how it differs from the current state

## Required Structure

For change proposals, decision reports, and architecture explanations, organize the response in this order:

1. `现状`
2. `目标`
3. `差距`
4. `执行计划`
5. `验收标准`

Do not skip sections unless the user explicitly asks for a shorter answer.

## Section Rules

### 现状

- Describe the real state of the code/product today.
- Name the current mechanism, not the intended mechanism.
- If the current state is mixed or transitional, say that explicitly.

### 目标

- State the desired end state in one clear sentence first.
- Prefer product-language or architecture-language, not vague adjectives like “better” or “cleaner”.

### 差距

- Explain the concrete mismatch between today and the target.
- Focus on structural differences, not effort estimates.
- If there are risks or tradeoffs, put them here.

### 执行计划

- Use a short ordered list when sequencing matters.
- Group by migration step or system boundary.
- Say what gets removed, not only what gets added.

### 验收标准

- Make the checks observable.
- Prefer runtime behavior, interface shape, and build/package/test evidence.
- If a part is not yet verified, say so directly.

## Term Explanation Rule

When the user asks “what do you mean by X”, answer it as a delta against current reality:

- what `X` means
- what the current system does instead
- why the difference matters
- what changes only if we decide to move to `X`

Do not answer with abstract textbook definitions alone.

## Writing Rules

- Use the same structure for development and design decisions.
- Keep terms stable across turns.
- Avoid “最终形态/最纯/最佳实践” without explaining the operational difference.
- If a recommendation is provisional, mark it as provisional.
- If the current state is already good enough, say that explicitly instead of inventing extra work.

## Closure Reporting Rules

When the user asks whether a report, bug list, or acceptance document has been "fixed", "closed", or "completed":

- First separate `门禁是否通过 / 主链路是否恢复` from `报告里的每一条批注是否都做了独立修复`.
- Do not collapse these into one yes/no answer.
- If only the blocker path is fixed and the iteration gate passes, say that explicitly.
- If some report items were not independently patched in this round, list them as `未单独 closure` instead of implying full closure.
- Prefer the response shape `已明确修复并验证 / 仍未单独 closure / 验证结果`.

When the user asks for a report crosswalk:

- Map every item as `问题 -> 修复点 -> 验证结果`.
- Distinguish `代码已修改并验证`, `被其他修复连带覆盖`, and `尚未处理`.
- Never use a global "都修完了" unless every report item has a concrete closure status.

## Default Decision Heuristic

- First report the real system boundary.
- Then report the desired system boundary.
- Then report the migration cost and benefit.

If a proposal does not change a real boundary, call it an optimization, not an architecture change.
