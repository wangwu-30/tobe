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

## Default Decision Heuristic

- First report the real system boundary.
- Then report the desired system boundary.
- Then report the migration cost and benefit.

If a proposal does not change a real boundary, call it an optimization, not an architecture change.
