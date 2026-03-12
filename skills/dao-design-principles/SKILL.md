---
name: dao-design-principles
description: Apply Dao Ke Dao product and UI design principles when working on navigation, page structure, layout density, interaction flows, sidebars, information architecture, or frontend cleanup. Use for product-facing changes that should stay AI-native, simpler, more consistent, responsive, and state-transparent instead of drifting into IDE-style clutter.
---

# Dao Design Principles

Apply this skill when changing product structure or UI, not only when polishing visuals.

Treat Dao Ke Dao as an artifact-first AI authoring product. Keep the deliverable and the AI loop at the center. Keep manual controls as fallback, not as the main story.

Read [references/checklist.md](references/checklist.md) when doing a larger redesign, reviewing a complex page, or validating a nearly-finished UI.

## Core Rules

### 1. Apply Occam first

- Remove objects before restyling them.
- Remove panels before resizing them.
- Remove actions before hiding them in menus.
- Keep one primary object per screen and one primary trigger per action.
- Do not let one system play multiple roles:
  - version is for milestones,
  - branch is for thinking paths,
  - comment is for local revision requests,
  - context is for supporting material.

### 2. Keep consistency visible

- Reuse the same sidebar shell, spacing rhythm, widths, footer actions, and row language across home and workspace views.
- Reuse the same action hierarchy:
  - high-frequency actions visible,
  - low-frequency actions in menus,
  - unavailable actions hidden or clearly explained.
- Reuse the same naming:
  - `Deliverable`,
  - `Version`,
  - `Review`,
  - `Chat`,
  - `Context`.
- Never let the same concept appear under different names on different pages.

### 3. Simplify and emphasize

- Reduce density before changing typography.
- Prefer fewer visible controls with stronger grouping.
- Put the current object, the current state, and the next likely action in the first scan line.
- Hide internal agent prompts, transport details, and implementation scaffolding from the main user surface.
- Show source files only when the current deliverable type actually needs implementation-level work.

### 4. Preserve responsive behavior

- Keep one primary scroll container per pane.
- Prevent panes from growing past their slot. Use `min-w-0`, `min-h-0`, and `overflow-hidden` deliberately.
- Desktop:
  - left navigation,
  - center deliverable,
  - right assistant rail.
- Tablet:
  - keep the deliverable dominant,
  - collapse the assistant rail to a drawer when needed.
- Mobile:
  - keep only one dominant surface visible at a time.

### 5. Make state and feedback explicit

- Never leave the user guessing whether AI is working, blocked, unauthenticated, rate-limited, or done.
- Show:
  - loading,
  - slow response,
  - success,
  - failure,
  - read-only,
  - applied/discarded,
  - disabled reason.
- If an action can fail because of provider, auth, quota, or lock state, surface that reason in product language.

### 6. Keep the product AI-native

- Start from goal, not blank files.
- Prefer `AI plan -> staged change -> user approval -> apply` over direct mutation.
- Treat chat as one tab in the assistant system, not the entire product.
- Treat comments as precise instructions to AI, not free-form side chat.
- Keep manual file controls available, but subordinate.

## Working Sequence

1. Identify the primary user object on the screen.
2. Identify the single most important next action.
3. Remove or demote everything that competes with those two.
4. Audit consistency against neighboring pages and states.
5. Audit feedback for loading, empty, error, success, disabled, and read-only paths.
6. Validate the page in a browser before closing the task.

## Decision Heuristics

- If a control is not useful in the current context, hide it instead of disabling it by default.
- If a user must understand backend entities to operate the page, the page is overexposing implementation detail.
- If a page needs separate explanation for navigation, versioning, comments, and chat, the information architecture is too dense.
- If an internal AI action appears as a user-facing artifact, move it behind product language or hide it from the timeline.
- If two screens solve the same task with different shells, merge the shell instead of styling them separately.

## Deliverables

- When changing UI, explain:
  - what was simplified,
  - what became more consistent,
  - how feedback/state visibility improved,
  - what implementation detail was hidden or demoted.
- For larger changes, cite the checklist in [references/checklist.md](references/checklist.md) and explicitly note any deliberate exceptions.

## References

- Larger redesign review: [references/checklist.md](references/checklist.md)
