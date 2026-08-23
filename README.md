# 成形

成形 is a Web-only project workspace for turning a goal into shared documents, Project Room collaboration, and reviewable Agent execution. People remain in control: Agents propose work, humans approve it, and trusted workers apply or merge approved changes.

The current release is a trusted local, single-user MVP built with Next.js, Prisma, SQLite, Plate, tldraw, and pi-mono. It has no desktop or Electron runtime.

## What You Can Try

- Create a project from a goal and move between the home list and spatial canvas.
- Open a project workspace with structured documents, chat, comments, history, and visible milestone versions.
- Use the Project Canvas to see and navigate a multi-Node project.
- Enter Project Room, the default Agent surface, for typed multi-Agent routing, bounded context, grants, and explicit tool confirmation.
- Publish, claim, deliver, and review centralized team tasks.
- Inspect durable Execution Job events, logs, artifacts, waiting input, cancellation, and recovery.
- Extract reusable knowledge from resolved review conversations.

## Quickstart

Prerequisites: Node.js 20.9 or newer and a modern npm version.

From a repository checkout:

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No `.env` file or AI credential is required to start the application and explore its local, non-AI workspace features.

`npm run dev` automatically runs the local database bootstrap before Next.js starts. It creates or upgrades `dev.db` in the repository root, applies the local migrations, and enables SQLite WAL mode. To keep runtime data outside the checkout, use an absolute app-data directory:

```bash
DAO_APP_DATA_ROOT=/absolute/path/to/tobe-data npm run dev
```

### Three-Minute Demo

1. On the home page, enter a goal and create a project.
2. Switch between **列表 / List** and **画布 / Canvas**, or open [http://localhost:3000/?view=canvas](http://localhost:3000/?view=canvas) directly.
3. Double-click a project on the canvas to enter its workspace.
4. When the project has at least two Nodes, choose **视图 / View → 项目总览 / Project Overview** to open the Project Canvas.
5. Explore the document editor, comments and milestones, then open Project Room to see the Agent collaboration surface. Actual model responses require the optional AI setup below.

## Optional AI Setup

Open [http://localhost:3000/settings](http://localhost:3000/settings) to configure a provider API key and default model. Supported providers can also use their corresponding server environment variables.

For OpenAI Codex OAuth:

```bash
npm run auth:openai-oauth
```

OAuth credentials are stored under the active app-data root in `.oauth/openai-codex.json` and `.oauth/auth.json`. If you set `DAO_APP_DATA_ROOT` for the Web app, use the same value for this command.

Without a provider credential, the application still starts, but model-backed chat, AI editing, AI comment replies, memory extraction, and real Room Agent reasoning are unavailable.

## Runtime Model

The Quickstart launches the Web application only. The complete durable runtime adds exactly three standalone Node services:

| Service | Responsibility | Build and start |
| --- | --- | --- |
| Execution daemon | Durable job queueing, leases, attempts, suspension, cancellation, and recovery | `npm run execution:daemon:build` then `npm run execution:daemon:start` |
| Room Session Host | Low-latency Project Room sessions and replayable room events | `npm run room:host:build` then `npm run room:host:start` |
| Knowledge merge worker | Ready-only knowledge snapshot merging | `npm run knowledge:merge-worker:build` then `npm run knowledge:merge-worker:start` |

These are deployment-level services, not extra Quickstart steps. Run them as separate processes and point every process at the same `DAO_APP_DATA_ROOT` or `DATABASE_URL`. The execution daemon requires an absolute `DAO_EXECUTION_DAEMON_CONFIG_PATH`; the Room host requires an absolute `DAO_ROOM_SESSION_HOST_CONFIG_PATH`; the knowledge worker requires `DAO_KNOWLEDGE_ORGANIZATION_ID` and an absolute `DAO_KNOWLEDGE_INDEX_ROOT`. See the [Agent Room and durable execution workstream](./docs/agent-room-execution-workstream.md) for architecture and deployment context.

Room Agent Sessions and durable Execution Jobs deliberately have separate lifecycles. Room sessions provide low-latency collaboration; Jobs own durable queueing and execution. Knowledge snapshots have their own readiness and merge lifecycle.

## Production Mode

Bootstrap the database explicitly before the first production start (`npm run start` has no bootstrap hook):

```bash
npm ci
npm run db:bootstrap:local
npm run build
npm run start
```

This starts the Web process. Add the three standalone services above when deploying the complete durable runtime.

## Current Trust and Integration Boundaries

- Team-mode organization, role, and ACL contracts exist, but the current Web MVP has no production identity provider, login/session/JWT integration, member invitation flow, or enterprise SSO. Trusted runtime headers are transport receipts, not authentication.
- Agents may propose changes; a human reviews and approves them before a trusted worker performs expected-old CAS apply or merge operations.
- `git-worktree`-capable deployments use isolated per-attempt clones/workspaces rather than native registered Git worktrees. Remote Git credentials, fetch/push, and monorepo subpath mounts are currently out of scope.
- OpenHands remains disabled, offline, capacity-zero, and fail-closed until its protocol is verified.
- Project canvases retain the tldraw watermark. A production release must use a compatible tldraw license or explicitly accept the applicable terms; the watermark is not hidden in CSS, DOM code, or test branches.

## Validation

```bash
npm run verify:iteration:static
npm run test:control-plane
npm run verify:iteration
```

The full gate runs static checks, the complete control-plane inventory and all three Node-service suites, WAL-enforcing database bootstrap, the production Web build, browser preflight, and browser E2E. A dated verification record is the authority for a particular run; the presence of code or targeted tests alone is not a full-gate result.

## Documentation

- [Current handoff and delivery snapshot](./docs/HANDOFF-2026-08-22.md)
- [Agent runtime research and architecture decisions](./docs/agent-runtime-architecture-research.md)
- [Change log and project status](./CHANGELOG.md)
- [Product north star and information architecture glossary](./docs/chengxing-product-north-star.md)
- [Rollout plan and phase boundaries](./docs/chengxing-rollout-plan.md)
- [Agent Room and durable execution workstream](./docs/agent-room-execution-workstream.md)
- [Team document and Agent marketplace brief](./docs/briefs/team-document-agent-marketplace.md)
- [General engineering knowledge index](./docs/knowledge/README.md)
