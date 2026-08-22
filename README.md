# 成形

Web-only document workspace with a team-mode domain model, where a trusted local user and agents align content, execute work, and hand difficult problems to a shared task board. Built with Next.js, Prisma, SQLite, Plate, and pi-mono; there is no desktop or Electron runtime.

## Core Workflow

- Chat with an AI writing assistant to generate or refine documents.
- Edit the generated draft in a structured editor.
- Lock document versions for review.
- Track review comments in a sidebar and use AI to help reply.
- Extract reusable memories from resolved review threads.
- Align a visible immutable document version, then start an Agent from that shared source of truth.
- Publish, claim, deliver, and review centralized team tasks without wallets or blockchain infrastructure.

## Current Product Surface

- Session list with create/delete.
- Session workspace with resizable split view.
- Chat panel backed by `pi-agent-core` with streamed responses and workspace tools.
- Draft editor with version locking and version history bar.
- Database-backed comment sidebar for open/resolved threads.
- Knowledge panel and memory extraction pipeline.
- Shared pi-mono model-provider credential/auth layer for chat, comment reply, suggest edit, and memory extraction;
  this is separate from product user identity.
- Project Room as the default Agent entry, with durable message acceptance, typed multi-Agent routing,
  replayable events, grants, tool confirmation, and an independent Room Session Host.
- Bounded Room context with ACL rechecks, provenance, trust classification, summaries, and explicit budgets.
- Team-mode organization, membership-role, and ACL contracts. The current Web MVP still runs as a trusted
  local single-user principal: it has no production identity provider, login/session/JWT integration, member
  invitation or provisioning flow, or enterprise SSO. Trusted runtime headers are transport receipts, not an
  authentication mechanism.
- Centralized TeamTask center and API for publish, claim, delivery, activity, and review flows.
- Durable Execution Job APIs and UI for events, logs, artifacts, waiting input, HTTP cancellation, and recovery.
- Generic CLI and trusted `external-module` production Runtime extensions; OpenHands stays disabled/offline
  until its protocol is verified.
- `git-worktree`-capable deployments use per-attempt isolated clones/workspaces (not native registered Git
  worktrees) and deterministic proposal branches, followed by human review, trusted expected-old CAS merge,
  and ready-only knowledge snapshots.
- Remote Git credentials/fetch/push and monorepo subpath mounts are explicit non-goals; current knowledge
  bindings use trusted local repository roots.
- Local SQLite bootstrap requires WAL. Application processes use the safe local Prisma/libSQL adapter with a
  busy timeout, serialized connection access, terminal transaction cleanup, and bounded whole-command retries
  for recognized `SQLITE_BUSY` contention.

Room Agent Sessions and durable Execution Jobs are deliberately separate lifecycles: Room sessions provide
low-latency collaboration, while Jobs own queueing, leases, attempts, suspension, cancellation, and recovery.
The Web application is supported by exactly three standalone Node services: the execution daemon, Room
Session Host, and knowledge merge worker.

## Documentation

- [Current handoff snapshot](./docs/HANDOFF-2026-08-22.md) — paused implementation state, exact known blockers, and continuation order.
- Change log and project status: [CHANGELOG.md](./CHANGELOG.md)
- Product north star and IA glossary: [docs/chengxing-product-north-star.md](./docs/chengxing-product-north-star.md)
- Rollout plan and phase boundaries: [docs/chengxing-rollout-plan.md](./docs/chengxing-rollout-plan.md)
- Agent Room and durable execution workstream: [docs/agent-room-execution-workstream.md](./docs/agent-room-execution-workstream.md)
- Team document and agent marketplace brief: [docs/briefs/team-document-agent-marketplace.md](./docs/briefs/team-document-agent-marketplace.md)
- General engineering knowledge index: [docs/knowledge/README.md](./docs/knowledge/README.md)

## Development

```bash
npm install
npm run dev
```

For production mode:

```bash
npm run build
npm run start
```

Validation:

```bash
npm run verify:iteration:static
npm run test:control-plane
npm run verify:iteration
```

The full gate runs static checks, the complete control-plane inventory and all three Node-service suites,
WAL-enforcing database bootstrap, the production Web build, browser preflight, and browser E2E. A dated
verification record is the authority for a particular run; the presence of code or targeted tests is not a
full-gate result.

## Local OAuth Testing

```bash
npm run auth:openai-oauth
```

This saves OpenAI Codex OAuth credentials to `.oauth/openai-codex.json` and
`.oauth/auth.json`. Page operations inherit these credentials automatically.
