# 成形

成形 is a Web-only, one-person AI wiki for a one-person team. One human owner works with multiple AI Agents across multiple Wiki Spaces: start in Chat, turn an idea into a Wiki Space only when it is worth keeping, and grow the result as reviewable Pages.

The current deployment model is a trusted local, single-user MVP built with Next.js, Prisma, SQLite, Plate, tldraw, and pi-mono. It bootstraps one singleton `Organization` and one human `owner`; additional `AgentProfile` records are AI collaborators, not human accounts. The product does not claim multi-user collaboration, login, invitations, or production identity.

## Product Model

- **Chat first.** Home opens a personal assistant conversation. Asking a question does not create an empty Wiki Space.
- **Create on confirmation.** When the conversation has a durable outcome, the assistant may propose a Wiki Space. Only explicit human confirmation creates it, and the new Wiki Space adopts the same `Session` so the conversation continues without a context-breaking copy or restart.
- **Wiki Space, then Pages.** A Wiki Space is the user-facing facade over a canonical Project root. A Page is the user-facing facade over a `Document` inside that root. `Project`, `Deliverable`, and `Content` remain compatibility or implementation terms, not the primary product language.
- **Human-controlled writes.** AI may chat, plan, and prepare Suggested changes for a Page. The human owner reviews and applies them; trusted workers perform the checked mutation or merge.
- **Progressive disclosure.** Chat, Wiki Spaces, Pages, comments, and versions form the normal path. Room, Agents, Team Tasks, Execution Jobs, and Git Knowledge are advanced capabilities.
- **Two kinds of knowledge.** A Wiki Space is the human-visible source of truth. A Git-backed `KnowledgeSpace` is an advanced Agent/runtime knowledge repository with its own proposal, review, merge, and ready-snapshot lifecycle. It is not a Wiki Space.

## What You Can Explore

- Talk to the assistant before deciding whether the result belongs in the wiki.
- Create and open Wiki Spaces with a tree of Pages, support material, comments, history, and visible milestones.
- Navigate a Wiki Space in list or canvas form; the existing Project/Node implementation backs this facade.
- Review AI-prepared Suggested changes before applying them to the live Page draft.
- Open the advanced Room surface for typed multi-Agent routing, bounded context, grants, and explicit tool confirmation.
- Inspect advanced Team Tasks, durable Execution Jobs, Agent profiles, and Git Knowledge review.

## Quickstart

Prerequisites: Node.js `>=22.19.0 <23` and a modern npm version. The checked-in `.node-version` recommends Node.js 22.23.2. Node.js 26 is outside the currently supported and tested engine range, so `npm ci` reports an `EBADENGINE` warning; switch to the recommended Node.js 22 release instead of ignoring it.

From a repository checkout:

```bash
node --version # v22.23.2 recommended
npm --version  # 11.17.0 recommended
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No `.env` file or AI credential is required to start the application and inspect its local, non-AI surfaces.

`npm ci` runs the project's `postinstall` hook, which executes `npm run db:generate` and generates the ignored Prisma Client. `npm run dev` regenerates it and runs the local database bootstrap before starting Next.js. The bootstrap creates or upgrades `dev.db` in the repository root, applies local migrations, and enables SQLite WAL mode. To keep runtime data outside the checkout, provide an absolute app-data directory:

```bash
DAO_APP_DATA_ROOT=/absolute/path/to/tobe-data npm run dev
```

### Install Diagnostics

With Node.js 22.23.2 and npm 11.17.0, `npm ci` should not report `EBADENGINE` or unreviewed install scripts. Two upstream transitive deprecation notices currently remain: `tldraw` still depends on `lodash.isequal`, and the `shadcn` package that supplies `shadcn/tailwind.css` still reaches `node-domexception` through `node-fetch`. Neither has a safe local override.

`npm audit` currently reports three high-severity entries for one dependency chain: `prisma -> @prisma/config -> deepmerge-ts@7`. The published Prisma release pins that version, while npm's suggested automatic fix is an incompatible downgrade to Prisma 6.12. Do not run `npm audit fix --force`; Dependabot will propose the normal upstream upgrade when Prisma adopts the patched `deepmerge-ts` line.

### Short Walkthrough

1. Open Home and start with Chat. A message alone must not create an empty Wiki Space.
2. Continue the conversation until the intended result is clear.
3. Explicitly confirm **Create Wiki Space** when the result should become durable wiki work. The same conversation Session continues in that Wiki Space.
4. Open a Page, review the draft, add comments, and inspect milestones.
5. Use **Advanced** only when you need Room orchestration, Agents, Jobs, Team Tasks, or Git Knowledge. Model-backed responses require the optional AI setup below.

The Wiki-first home and navigation are the active product workstream. If a checked-out revision still opens the historical Project Room flow by default, treat that as the preceding implementation baseline rather than the current product contract. The normal flow does not expose Room orchestration, Job/runtime selection, recovery consoles, or Git merge controls.

## Optional AI Setup

Open [http://localhost:3000/settings](http://localhost:3000/settings) to configure a provider API key and default model. Supported providers can also use their corresponding server environment variables.

For OpenAI Codex OAuth:

```bash
npm run auth:openai-oauth
```

OAuth credentials are stored under the active app-data root in `.oauth/auth.json`. Existing `.oauth/openai-codex.json` credentials remain readable and are migrated on the next successful refresh. If you set `DAO_APP_DATA_ROOT` for the Web app, use the same value for this command.

Without a provider credential, the application still starts, but model-backed Chat, AI editing, comment replies, memory extraction, and Room Agent reasoning are unavailable.

## Advanced Runtime

The Quickstart launches the Web application only. Advanced durable execution adds exactly three standalone Node services:

| Service | Responsibility | Build and start |
| --- | --- | --- |
| Execution daemon | Durable Job queueing, leases, attempts, suspension, cancellation, and recovery | `npm run execution:daemon:build` then `npm run execution:daemon:start` |
| Room Session Host | Low-latency multi-Agent Room sessions and replayable events | `npm run room:host:build` then `npm run room:host:start` |
| Knowledge merge worker | Human-approved Git Knowledge merge and ready-snapshot activation | `npm run knowledge:merge-worker:build` then `npm run knowledge:merge-worker:start` |

Run them as separate processes and point every process at the same `DAO_APP_DATA_ROOT` or `DATABASE_URL`. The execution daemon requires an absolute `DAO_EXECUTION_DAEMON_CONFIG_PATH`; the Room host requires an absolute `DAO_ROOM_SESSION_HOST_CONFIG_PATH`; the knowledge worker requires `DAO_KNOWLEDGE_ORGANIZATION_ID` and an absolute `DAO_KNOWLEDGE_INDEX_ROOT`. See the [Agent Room and durable execution workstream](./docs/agent-room-execution-workstream.md) for deployment details.

Chat/Room Sessions and durable Execution Jobs deliberately have separate lifecycles. Git Knowledge snapshots have a third readiness and merge lifecycle. None of these advanced lifecycles changes the Wiki Space/Page product model.

## Production Mode

Bootstrap the database explicitly before the first production start (`npm run start` has no bootstrap hook):

```bash
npm ci
npm run db:bootstrap:local
npm run build
npm run start
```

This starts the Web process. Add the three standalone services above only when deploying the complete advanced runtime.

## Trust and Release Boundaries

- The singleton Organization, owner membership, device tuple, and ACL checks are trusted-local authorization contracts. Runtime headers are transport receipts, not authentication. There is no production identity provider, login/session/JWT integration, member invitation flow, or enterprise SSO.
- AI and Runtimes may propose changes. The human owner approves them before a trusted worker performs expected-old CAS apply or merge operations.
- Git Knowledge uses isolated per-attempt clones/workspaces and proposal branches. Remote Git credentials, fetch/push, and monorepo subpath mounts remain out of scope.
- OpenHands remains disabled, offline, capacity-zero, and fail-closed until its protocol is implemented and verified.
- The product is Web-only. There is no desktop or Electron runtime.
- tldraw canvases retain the watermark. Production release requires a compatible tldraw license or an explicit decision to accept the applicable terms; do not hide the watermark with CSS, DOM code, or test branches.

## Validation

```bash
npm run verify:iteration:static
npm run test:control-plane
npm run verify:iteration
```

The full gate runs static checks, the control-plane inventory and three Node-service suites, WAL-enforcing database bootstrap, the production Web build, browser preflight, and browser E2E. A dated verification record is authoritative only for the exact tree it tested. Historical gate counts are retained in the handoff and workstream documents and must not be presented as proof of the current Wiki-first workstream.

## Documentation

- [One-person AI wiki brief](./docs/briefs/one-person-ai-wiki.md)
- [Product north star and terminology](./docs/chengxing-product-north-star.md)
- [System model](./SYSTEM.md)
- [Current constraints](./CONSTRAINTS.md)
- [Current handoff and historical delivery snapshot](./docs/HANDOFF-2026-08-22.md)
- [Agent Room and durable execution workstream](./docs/agent-room-execution-workstream.md)
- [Agent runtime research and architecture decisions](./docs/agent-runtime-architecture-research.md)
- [General engineering knowledge index](./docs/knowledge/README.md)
