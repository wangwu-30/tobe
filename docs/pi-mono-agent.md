# 道可道 x pi-mono

## Decision

The app no longer treats "agent" as a prompt wrapper.

- `pi-agent-core` is the runtime for the main chat agent.
- `pi-ai` is the shared model and authentication layer for all page-level AI operations.
- This product remains the system of record for sessions, drafts, versions, comments, memories, and knowledge.

In practice, `pi-mono` is the brain. `道可道` supplies the hands and feet.

## Tool Surface

The current embedded agent can call these workspace tools:

- `get_workspace_context`
- `save_draft`
- `lock_current_draft`
- `list_comment_threads`
- `reply_to_comment`
- `resolve_comment`
- `add_knowledge_item`

These tools write directly to the existing Prisma-backed domain model instead of creating a second agent-specific state layer.

## Why This Shape

`pi-coding-agent` is a stronger fit when the product wants the agent to own its own coding/filesystem session.

`道可道` already has:

- its own session model,
- its own document lifecycle,
- version binding for comments,
- review-specific UI and persistence.

Because of that, embedding `pi-agent-core` is the cleaner move. It gives us a real agent loop and tool execution without replacing the app's product model.

## Authentication

Provider authentication is now resolved server-side.

- API-key providers read from `ai-settings.providerApiKeys` first, then environment variables.
- OAuth providers read from `.oauth/auth.json`.
- OpenAI Codex login is bootstrapped by `npm run auth:openai-oauth`.

This means chat, comment reply, suggest edit, and memory extraction all inherit the same credentials.
