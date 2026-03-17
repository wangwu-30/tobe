---
name: chengxing-autopilot
description: Drive long-running execution in `/Users/wangwu/claude/chat-to-your-mind` with plan-first discipline. Use when asked to continue autonomously, finish remaining repo goals, clear items from `PLAN_1.md` or `PLAN_2.md`, or keep iterating across successive slices until the active 成形 goals are actually done.
---

# 成形 Autopilot

Drive the repository as an execution program, not as isolated patches. Treat repo plans and status docs as the canonical surface, execute one bounded slice end-to-end, verify it, update the repo record, then immediately detect whether more in-scope work remains.

Do not confuse `docs/chengxing-project-status.md` saying “本轮无开放 todo” with “所有目标都完成了”. If `PLAN_1.md`, `PLAN_2.md`, `docs/chengxing-rollout-plan.md`, `docs/chengxing-v-next-gap-assessment.md`, or the active user request still imply unfinished work, keep going.

If the user explicitly broadens scope beyond the current slice or current iteration, phrases like these mean the long-term backlog is now active work rather than background context:

- “继续，直到所有目标完成”
- “不要停在单一切片”
- “继续把长期目标也往前推”
- “单一切片结束后继续新的切片”

## Canonical Surfaces

Read these in this order, and only pull extra files needed for the active slice:

1. `docs/chengxing-project-status.md`
2. `PLAN_1.md`
3. `PLAN_2.md`
4. `docs/chengxing-rollout-plan.md`
5. `docs/testing/iteration-regression-plan.md`
6. `docs/chengxing-lessons-learned.md`
7. `docs/chengxing-v-next-gap-assessment.md` when deciding whether something is a current-plan item or a later north-star phase, and treat it as an active backlog when the user explicitly asks to keep going past the current plan slice

Use them as distinct sources of truth:

- `docs/chengxing-project-status.md`: shipped facts and current maintenance state
- `PLAN_1.md` / `PLAN_2.md`: still-promised implementation goals that must not be silently dropped
- `docs/chengxing-rollout-plan.md`: broader execution order and project milestones
- `docs/testing/iteration-regression-plan.md`: authoritative acceptance gate
- `docs/chengxing-lessons-learned.md`: validated best practices and pitfalls
- `docs/chengxing-v-next-gap-assessment.md`: the long-term backlog; use it either to avoid mislabeling future work as current residue, or as the next queue once the user explicitly asks to continue beyond current-plan closure

Do not create a parallel master plan in chat once these files exist. Update the repo docs instead.

Treat onboarding as unfinished if the repo still only has one global welcome modal and lacks progressive, feature-first guidance that appears the first time a user opens the real surface.

## Core Loop

1. Re-read the canonical surfaces for the active workstream.
2. Identify one bounded slice:
   - one user-visible capability cluster
   - one data contract + UI + test cluster
   - or one cleanup cluster that removes a real compatibility shadow
3. Execute the slice fully:
   - code
   - tests
   - docs if shipped facts, acceptance criteria, or lessons changed
4. Verify locally:
   - run targeted checks while iterating
   - finish with `npm run verify:iteration`
   - once that gate passes, treat it as permission to start the next slice, not as a default reason to stop
5. Re-detect remaining work:
   - re-read the relevant plan section
   - check whether any acceptance line or promised scope item is still unmet
   - inspect nearby files/tests for obvious next slices
6. If more in-scope work remains and there is no real blocker, continue immediately with the next bounded slice.
7. If the current plan is closed but the user explicitly asked to keep going, promote the next unresolved long-term gap into the active work queue and continue without waiting for a new prompt.

## Bounded Slice Rules

Choose slices that can finish durably in one work session:

- 1 to 5 implementation files when code-heavy
- one explicit acceptance cluster
- one test cluster or one gateable runtime behavior

Prefer slices shaped like:

- one interaction loop from data model to UI to E2E
- one plan promise that still leaks compatibility residue
- one research/comment/workflow/status surface that must be made internally consistent
- one onboarding surface that must move from one-shot modal explanation to contextual first-use guidance
- one packaging or runtime blocker that prevents closing the current iteration

Avoid slices shaped like:

- “finish the whole repo”
- “clean all legacy names everywhere”
- “refactor all AI flows” without a bounded acceptance edge

## Execution Discipline

- Default to deletion over compatibility when the repo is already in MVP cutover mode.
- Keep user-visible terms aligned with the current product language:
  - `currentStatus`
  - `Version`
  - `Review`
  - `Chat`
  - `Context`
  - `Workflow`
- When a slice changes UX or information architecture, also use `dao-design-principles`.
- When a slice requires a proposal, tradeoff explanation, or a decision note, also use `dao-change-briefs`.
- Keep comments, runs, versions, and plans centered on the deliverable, not on transitional implementation names.

## Required Repo Updates

Update repo docs in the same turn when any of these become true:

- a promised plan item moved from open to done
- acceptance criteria changed
- the iteration gate changed
- a reusable lesson or pitfall was discovered
- a long-term gap was clarified enough to separate “not done yet” from “not in current scope”

Minimum update rules:

- shipped fact changed: update `docs/chengxing-project-status.md`
- acceptance/gate changed: update `docs/testing/iteration-regression-plan.md`
- lesson or pitfall changed: update `docs/chengxing-lessons-learned.md`

## Remaining Work Detection

Before stopping, explicitly check:

1. Is the current user-requested scope fully implemented?
2. Do `PLAN_1.md` or `PLAN_2.md` still contain unmet acceptance that belongs to the same workstream?
3. Does the touched surface still have obvious compatibility residue or an immediately adjacent missing slice?
4. Have docs and gate been updated to match reality?
5. Has `npm run verify:iteration` been run after the last meaningful change?
6. If the user asked to keep going beyond the current slice, is there another unresolved backlog item in `docs/chengxing-v-next-gap-assessment.md` or adjacent north-star docs that can be turned into a bounded slice right now?

If any answer is “no”, continue unless blocked.

After every successful `npm run verify:iteration`, immediately re-enter the Core Loop and decide whether there is another bounded slice. Do not end the turn just because the last slice passed verification.

## Stop Conditions

Stop only when one of these is true:

- all current in-scope plan items are actually done, and any user-activated long-term backlog slices are also done
- the next step needs destructive user intent
- the next step needs missing credentials, external infra, or privileged access
- the next step requires a product decision that cannot be inferred safely from the repo plans

Do not stop because one patch landed. One patch is a checkpoint, not completion.

## Release Rule

- `npm run verify:iteration` is mandatory for every completed feature iteration or bug-fix slice.
- `npm run desktop:smoke:packaged` is a release/package gate, not the default per-slice gate.
- Only package when the current scoped goals are closed and the user asks for a package or release-like verification.

## Response Shape

When closing a turn, keep the handoff operational and restartable:

- `现状`
- `目标`
- `差距`
- `执行计划`
- `下一步动作`

Be explicit about whether you mean:

- current iteration goals
- active plan goals
- or long-term north-star goals

Do not collapse those into one vague “done / not done”.
