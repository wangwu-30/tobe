# Knowledge + Memory -> Note 合并决策简报

更新时间：2026-03-21
当前工作流：见 [docs/chengxing-refactor-tracker.md](./chengxing-refactor-tracker.md)

## 现状

- `KnowledgeItem + Memory` 已收口到 canonical `Note` contract、Prisma model、object seam 和 `/api/notes`。
- 当前 `Note` contract 为 `{ id, scope, scopeId, kind, title?, content, source, sourceRef?, active }`。
- `Context` 面板、AI context builder 和 `get_workspace_context` 已统一改读 `Note`，并在默认读侧覆盖 `deliverable + project + user` scope；对用户和 prompt 仍继续输出 `Knowledge / Memory` 双分区：
  - `kind === 'knowledge'` 的 note 继续以“有标题的知识条目”显示
  - 其余 note category 继续以“带 kind badge、scope badge 和 active 开关的记忆”显示
- 旧 `KnowledgeItem / Memory` 表与 `/api/{knowledge,memories}` route 已删除。

## 目标

- 用一个 canonical `Note` contract 收口知识和记忆，同时保留当前 UI / prompt 对 `title / category / active / source` 的表达能力。

## 决策

- `KnowledgeItem.title` 直接进入 `Note.title?`，不再挤进 `content`。
- `Memory.category` 直接进入 `Note.kind`；`knowledge` 也成为 `kind` 的一个正式取值。
- `KnowledgeItem.sourceType` 映射到 `Note.source`；`Memory.sourceThreadId` 映射到 `Note.sourceRef`，并用 `source='thread' | 'memory' | 'manual' | 'agent-note'` 表示来源类型。
- `Memory.active` 直接保留为 `Note.active`；原本没有 active 语义的 knowledge 默认 `active=true`。
- `Context` 面板和 AI prompt 暂不改成单一 `Note` 视图，而是继续用 `note.kind` 派生 `Knowledge / Memory` 双分区。
- `scope='user'` 已接入默认 AI 消费面，`Context` 面板读写两侧也已对齐同一 scope 矩阵：chat prompt、comment/suggest-edit/research prompt、`get_workspace_context` 与 `Context` 面板都会一起读取 `deliverable + project + user` scope Note；用户现在也可以在 `Context` 面板里显式创建或编辑 `project / user` scope knowledge。

## 执行结果

1. 更新 `SYSTEM.md`、`src/types` 与 Prisma schema，让 `Note` 成为正式对象契约。
2. 新增 `prisma/migrations/20260321190000_unify_notes/migration.sql`，把旧 `KnowledgeItem / Memory` 回填进 `Note` 后删除旧表。
3. 新增 `src/objects/note/{schema,queries,commands}.ts` 与 `/api/notes`，让读写入口统一收口。
4. 把 `knowledge-panel`、AI context builder、memory extractor 和 agent tools 全部切到 `Note`，并让 `Context` 面板支持 scoped knowledge 的显式创建 / 编辑。
5. 删除 `/api/knowledge`、`/api/memories` 与相关旧类型 / 映射残留。

## 验收结果

- `Note` contract 已能承接 `KnowledgeItem.title/sourceType` 与 `Memory.category/sourceThreadId/active`。
- `Context` 面板和 AI prompt 仍保留标题、category badge、scope badge 与 active 开关，不因合并退化。
- `Context` 面板已支持 `deliverable / project / user` scope knowledge 的显式创建 / 编辑；`scope=user` 写侧不要求客户端硬编码 user id，现有 knowledge 也可在面板内迁移 scope。
- 旧 `KnowledgeItem / Memory` 表、route 和 type alias 已删除。
- `npm run verify:iteration` 已通过（52 passed，1.8m）。
