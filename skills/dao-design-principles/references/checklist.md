# Dao Design Checklist

Use this checklist when the change affects page structure, navigation, panel layout, assistant behavior, or cross-page consistency.

## Product Shape

- What is the primary user object on this screen?
- Is that object obvious within the first three seconds?
- Is the main loop AI-first, with manual controls acting as fallback?
- Does the page expose implementation entities that the user should not need?

## Information Architecture

- Does each concept have one primary home?
- Are version, branch, comment, and context clearly separated?
- Are low-frequency actions demoted into menus or drawers?
- Are unavailable actions hidden or clearly explained?

## Visual Density

- Can any header action be removed, merged, or demoted?
- Can any panel be collapsed, deferred, or turned into a tab?
- Does the first scan line show current object, current state, and next action?
- Is the screen readable without explaining the layout verbally?

## Consistency

- Does the sidebar shell match adjacent pages?
- Do row styles, padding, footer actions, and widths match adjacent pages?
- Do states use the same labels everywhere?
- Does the same action live in the same place on different screens?

## Responsive Behavior

- Is there exactly one primary scroll container per pane?
- Can any child stretch past its container width or height?
- On smaller screens, which pane collapses first?
- Does the deliverable remain the dominant surface on tablet and mobile?

## Feedback and State

- Is there a visible loading state?
- Is there a visible slow-response state?
- Is there a visible success state?
- Is there a visible failure state with a plain-language reason?
- Is read-only or locked state clearly shown?

## Browser Validation

- Verify the home page and workspace page use the same shell language.
- Verify actions remain clickable after layout changes.
- Verify no pane overflows horizontally.
- Verify the user can tell whether AI is working, blocked, or done.
