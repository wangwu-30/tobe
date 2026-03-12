# Changelog

## 2026-03-10

### Design System and Interaction Feedback

- Standardized the product shell around one reusable sidebar language:
  - extracted shared sidebar primitives for section headers, compact icon actions, row widths, and collapse sizing,
  - switched both home and workspace pages to the same deliverable sidebar shell,
  - restored the `Settings` footer action on workspace pages so navigation and footer affordances now match home.
- Tightened sidebar consistency and modularity:
  - aligned sidebar width classes, top brand block, primary `New Workspace` action, section rhythm, and footer placement across pages,
  - kept the desktop collapse state shared and persistent,
  - ensured workspace navigation, outline navigation, and settings all live inside the same shell contract instead of drifting into page-specific variants.
- Improved chat feedback so the product no longer appears silently broken when AI is slow or blocked:
  - added explicit `Connecting to AI…`, slow-response, stop, and timeout states,
  - surfaced provider/auth/quota-style failures in product language instead of leaving the pane idle,
  - preserved user intent while removing empty assistant placeholders on failure.
- Hid internal AI-first-pass prompts from the visible chat timeline:
  - queued internal authoring prompts still drive the agent loop,
  - but they no longer appear as confusing user bubbles or overwrite conversation titles.
- Added a repo-local design skill for future frontend work:
  - `dao-design-principles` now codifies Occam-first cleanup, consistency, simplification, responsiveness, explicit state feedback, and AI-native interaction rules,
  - `AGENTS.md` now advertises that skill so future navigation/layout work reuses the same design standard instead of drifting.

## 2026-03-09

### Artifact-First Authoring Flow

- Reframed the main workspace experience around the deliverable instead of the underlying file tree:
  - the main canvas now titles the deliverable, not `main.md`,
  - the left rail stays focused on `Workspaces` and `Deliverable Outline`,
  - `Plan / Review / Chat / Context` now form the single assistant rail.
- Added goal-first AI authoring controls:
  - new workspaces start from a goal composer,
  - the plan panel now surfaces the current phase,
  - blank deliverables now show a primary `Generate First Pass` action in `Plan`.
- Wired `Generate First Pass` into the real agent loop:
  - the workspace page queues an AI authoring prompt,
  - chat consumes the queued prompt automatically,
  - AI can now produce staged changes before touching the live draft,
  - staged changes can then be applied or discarded from the plan panel.
- Strengthened the agent contract for artifact-first work:
  - chat system prompts now describe 道可道 as an artifact-first authoring studio,
  - the agent is instructed to prefer staged changes over chat-only output,
  - workspace context now includes deliverable plan, files, staged changes, review threads, and memories.
- Improved visible version review:
  - compare now renders a lightweight diff view when line-level comparison is tractable,
  - compare defaults to the newest visible version instead of `draft vs draft`,
  - recovery checkpoints remain hidden from the visible version picker.
- Tightened workspace naming on creation:
  - long goal sentences are normalized into shorter workspace titles,
  - leading command phrasing such as `写一份` is stripped before title generation.

### macOS-First Runtime and Layout Hardening

- Added a macOS-first Electron shell under `apps/desktop`:
  - local app service bootstrapping,
  - request-header injection for device / user / organization context,
  - desktop preload bridge,
  - `npm run desktop:dev`,
  - `npm run desktop:start`.
- Switched Next production builds to `standalone` output and added standalone asset syncing for desktop/startup flows.
- Introduced platform path abstraction and removed `process.cwd()` assumptions from core runtime paths:
  - database path,
  - OAuth credential store,
  - workspace mirror root,
  - logs root.
- Added platform runtime APIs:
  - `/api/platform/status`,
  - `/api/platform/paths`.
- Added `WorkspaceRun` persistence plus server-side run orchestration for:
  - preview runs,
  - allowed workspace commands (`npm install`, `npm run dev`, `npm run build`, `npm test`),
  - preview URL tracking,
  - log-path tracking,
  - run status / exit-code lifecycle.
- Added workspace run and preview APIs:
  - `/api/workspaces/[workspaceId]/runs`,
  - `/api/workspaces/[workspaceId]/runs/[runId]`,
  - `/api/workspaces/[workspaceId]/preview/start`,
  - `/api/workspaces/[workspaceId]/preview/stop`.
- Added a workspace mirror manager that materializes current files or snapshot files into a local derived directory for preview/build/test execution.
- Upgraded sync routes beyond the earlier placeholder shape:
  - idempotent event accept,
  - backend-aware cursor records,
  - pull cursor advancement,
  - origin-device filtering on pulls.
- Updated the settings page to expose runtime mode and resolved storage paths, including the real OAuth, DB, mirror, and logs directories.
- Hardened workspace layout contracts:
  - split panes now enforce `min-w-0 / min-h-0 / overflow-hidden`,
  - the knowledge panel is now a real layout slot instead of an absolute overlay,
  - chat/editor/scroll containers no longer push the app wider than the viewport.
- Added minimal preview controls to workspace chrome:
  - `Start Preview`,
  - `Stop Preview`,
  - `Open Preview` when a live preview URL exists.
- Hardened the desktop-style sidebar:
  - fixed width overflow in workspaces / file tree items,
  - added persistent desktop collapse / expand state,
  - introduced a compact icon rail when collapsed,
  - added a top-bar sidebar toggle for desktop pages.
- Simplified workspace chrome and navigation density:
  - changed workspace items from large cards to lighter folder-style rows,
  - moved low-frequency header actions into a single `Workspace` menu,
  - hid invalid preview actions when the workspace has no preview target,
  - removed branch actions from user-authored chat bubbles,
  - surfaced the active thread title in the chat header.

### Workspace-First Migration

- Promoted the public product model from `Wiki` to `Workspace` while keeping compatibility wrappers on legacy `wiki/session/document` routes.
- Added canonical workspace routes and APIs:
  - `/workspace/[workspaceId]`,
  - `/api/workspaces`,
  - `/api/workspaces/[workspaceId]`,
  - `/api/workspaces/[workspaceId]/files`,
  - `/api/workspaces/[workspaceId]/files/[fileId]`,
  - `/api/workspaces/[workspaceId]/snapshots`,
  - `/api/conversations/[conversationId]/branch`.
- Converted the left shell to a Notion-style sidebar with four sections:
  - `Workspaces`,
  - `Files`,
  - `Threads`,
  - `Snapshots`.
- Added workspace files as first-class editable nodes, including:
  - root file/folder creation,
  - active file switching,
  - plain-text/code editing,
  - snapshot-aware file viewing,
  - primary-file syncing back to the workspace draft.
- Added conversation branching:
  - users can branch from any chat message,
  - branch trees render in the sidebar,
  - branched conversations keep base snapshot lineage.
- Added immutable workspace snapshots as whole-workspace captures instead of only document-style versioning.
- Bound comments to `workspace + file + snapshot/draft` context instead of only a top-level document id.
- Added a search provider compatibility layer with MVP Volcengine Web Search support and new routes:
  - `/api/search/providers`,
  - `/api/search/query`.
- Connected chat to the new search layer:
  - manual `Web` mode now forces a search-backed answer,
  - agent tools now include `search_web`,
  - file/snapshot tools are exposed to the agent (`list_files`, `read_file`, `write_file`, `create_file`, `list_snapshots`, `create_snapshot`, `branch_conversation`).
- Added search-provider settings persistence and provider selection in the settings page.

### Platform Model Shift

- Introduced the `Organization -> Wiki -> WikiVersion -> Conversation` service layer while keeping compatibility wrappers on legacy `session/document` routes.
- Added local-platform bootstrap for default `Organization`, `User`, `Membership`, `Subscription`, and `Device` records.
- Extended the Prisma schema for:
  - multi-user ownership,
  - multi-device origin tracking,
  - wiki edit locks,
  - sync events and sync cursors,
  - organization/user/device metadata on core writing tables.
- Added new wiki/conversation APIs:
  - `/api/wikis`,
  - `/api/wikis/[wikiId]`,
  - `/api/wikis/[wikiId]/versions`,
  - `/api/wikis/[wikiId]/lock`,
  - `/api/conversations`,
  - `/api/conversations/[conversationId]/messages`,
  - `/api/sync/pull`,
  - `/api/sync/push`.
- Preserved compatibility on:
  - `/api/sessions`,
  - `/api/documents/*`,
  - `/session/[sessionId]`,
  while redirecting or mapping them into the new wiki-first workspace model.

### Product and Interaction Updates

- Added the canonical workspace route `/wiki/[wikiId]`.
- Converted the left navigation shell from session-first to wiki-first:
  - the sidebar now lists wikis,
  - creating a new workspace creates a wiki plus its primary conversation,
  - deleting a sidebar item now soft-deletes the wiki and its linked conversations.
- Kept the ChatGPT-style shared shell across home, settings, and workspace pages while moving the real working surface to the wiki route.
- Updated chat state flow so streamed AI calls now track and rehydrate `conversationId` and `wikiId` instead of relying on only `sessionId`.
- Scoped the knowledge panel to the current wiki when a workspace is open.

### Stability Fixes

- Restored selected-text commenting by moving selection tracking into client-side observers instead of render-time `window.getSelection()` access.
- Added a fallback `Comment` action in the editor header so users can still open the transient composer if the floating trigger is not visible.
- Kept comment creation transient until submit, then persisted the thread and focused the sidebar thread/history target.
- Fixed browser-extension-driven hydration noise by adding `suppressHydrationWarning` on the root body.
- Replaced locale-sensitive date rendering in app chrome, comments, settings, and date nodes with stable formatting helpers.
- Updated thread and comment-message APIs to populate new organization/user/device metadata and to soft-delete where appropriate.
- Fixed Prisma 7 schema compatibility by moving datasource URL ownership to `prisma.config.ts` and regenerating the Prisma client.

## 2026-03-08

### Fixed During Testing

- Moved the session workspace floating controls away from the chat composer so the pane-swap and knowledge buttons no longer cover the send button.
- Added a visible selected-text comment trigger in the editor, so commenting is no longer hidden behind `Cmd+Shift+M`.
- Added collapse support for the active comment list and rewrote manual reply mode copy to explain the batch queue clearly.
- Fixed chat panel scrolling by switching to a direct scroll container with reliable auto-scroll behavior.
- Replaced the assistant's empty loading state with animated thinking placeholders and removed the model-name-only placeholder from chat bubbles.
- Fixed a nested-button hydration error in the shared session sidebar by separating the session navigation click target from the delete action.
- Tightened session preview width constraints in the shared shell so long one-line previews no longer stretch the app horizontally.
- Clarified the comment product model:
  - comments are prompts written to AI,
  - thread cards no longer expose a follow-up prompt textarea,
  - manual mode now batches pending AI replies behind a single trigger.
- Added whole comment-sidebar collapse and reopen support from the session chrome, plus a close affordance inside the sidebar itself.
- Hardened comment-thread card overflow handling so long anchor text and long messages stay inside the sidebar and preserve the right border.
- Deduplicated provider-qualified model entries from the pi-mono registry before rendering model pickers.

### Product and Interaction Updates

- Reworked comment creation into a sidebar-first lifecycle:
  - selecting text now opens a transient inline composer,
  - no thread is persisted until submit,
  - created threads focus the sidebar instead of opening an inline thread surface.
- Redirected existing inline comment interactions to the sidebar:
  - clicking highlighted comment text focuses the open thread,
  - resolved comments expand history and scroll into view there.
- Standardized model picker identity on provider-qualified model keys to remove duplicate React key warnings from the pi-mono registry.
- Added a shared top app bar across home, settings, and session pages, and removed session-only floating chrome in favor of header actions for `Knowledge` and `Swap Layout`.
- Shifted the overall product shell closer to ChatGPT-style navigation:
  - a persistent left session sidebar now anchors home, settings, and workspace pages,
  - the home page is now a welcome surface instead of a full-width session-card wall,
  - session previews are constrained and truncated inside the sidebar to avoid horizontal overflow.

## 2026-03-07

### Current Capabilities

- Session management: create, list, open, delete.
- Workspace split view with chat panel and draft editor.
- AI chat with streamed output and document generation via ```document blocks.
- Draft editing with autosave, lock-for-review, unlock-for-editing, and version snapshots.
- Database-backed comment threads with AI reply support.
- Editor comment creation now persists into database-backed comment threads.
- Editor discussion popovers and the sidebar now read from the same database thread source.
- Knowledge and memory extraction from resolved comment threads.
- Model/provider settings for Anthropic, OpenAI, and custom OpenAI-compatible providers.

### This Iteration

- Added a real project changelog and replaced the boilerplate README.
- Renamed the product surface from `Chat to Your Mind` to `道可道`.
- Switched the session workspace to default `draft-left`, and added a runtime pane swap toggle.
- Added session rehydration for existing messages/documents through `/api/sessions?id=...`.
- Added comment reply modes:
  - `AI auto replies` as the default.
  - `Manual AI replies` with pending-thread batch reply support.
- Added persistent thread resolve flow:
  - resolve now updates the database,
  - resolved comments are hidden from the active list,
  - resolved comments move into collapsible history.
- Added version-aware resolved comment history:
  - comment threads can bind to a locked version,
  - unresolved draft comments stay on `Draft`,
  - resolved draft comments are attached to the next locked version snapshot.
- Replaced the homegrown chat wrapper with `pi-agent-core`, using workspace tools for:
  - reading current draft/review context,
  - saving drafts,
  - locking versions,
  - listing/replying/resolving comments,
  - storing knowledge items.
- Replaced the page-level model/auth stack with `pi-ai`:
  - chat,
  - comment reply,
  - suggest edit,
  - memory extraction
  now resolve models and credentials through the same provider layer.
- Moved OpenAI Codex OAuth into server-side auth inheritance:
  - `npm run auth:openai-oauth` now stores credentials in `.oauth/auth.json`,
  - page operations automatically consume saved OAuth credentials,
  - the settings page now reports OAuth status instead of importing raw access tokens.
- Unified comment data flow so database threads are the single source of truth for:
  - editor popover discussions,
  - sidebar threads,
  - edit / delete / resolve operations.

### Known Bugs

- `Suggest Edit` in the sidebar is still a placeholder button and does not produce edits yet.
- Existing lint debt remains in unrelated files, mostly `no-explicit-any` and unused-variable issues.

### Fixed During This Iteration

- Fixed SQLite runtime mismatch where the app connected to `prisma/dev.db` while Prisma migrations used root `dev.db`.
- Fixed session workspace load path so reopening a session restores persisted chat messages and the latest document.
- Fixed comment resolve not persisting to the database.
- Fixed duplicate user-message persistence in `/api/ai/comment-reply`.
- Fixed missing document context being sent to comment AI replies.
- Fixed editor comment creation so new comments can create persisted sidebar threads.
- Fixed editor/sidebar comment drift by syncing both views from persisted thread data.

### TODO

- Implement real `Suggest Edit` generation and apply flow.
- Add version switching for historical draft content, not just version badges/history grouping.
- Add richer pi-mono tool coverage beyond the current writing/review set, especially knowledge and memory authoring flows.
- Reduce lint debt and tighten type coverage across editor/AI utility modules.
