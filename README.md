# 成形

Agent-assisted writing workspace built with Next.js, Prisma, SQLite, Plate, and pi-mono.

## Core Workflow

- Chat with an AI writing assistant to generate or refine documents.
- Edit the generated draft in a structured editor.
- Lock document versions for review.
- Track review comments in a sidebar and use AI to help reply.
- Extract reusable memories from resolved review threads.

## Current Product Surface

- Session list with create/delete.
- Session workspace with resizable split view.
- Chat panel backed by `pi-agent-core` with streamed responses and workspace tools.
- Draft editor with version locking and version history bar.
- Database-backed comment sidebar for open/resolved threads.
- Knowledge panel and memory extraction pipeline.
- Shared pi-mono model/auth layer for chat, comment reply, suggest edit, and memory extraction.

## Documentation

- Change log and project status: [CHANGELOG.md](./CHANGELOG.md)
- Product north star and IA glossary: [docs/chengxing-product-north-star.md](./docs/chengxing-product-north-star.md)
- Rollout plan and phase boundaries: [docs/chengxing-rollout-plan.md](./docs/chengxing-rollout-plan.md)

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

## Local OAuth Testing

```bash
npm run auth:openai-oauth
```

This saves OpenAI Codex OAuth credentials to `.oauth/openai-codex.json` and
`.oauth/auth.json`. Page operations inherit these credentials automatically.
