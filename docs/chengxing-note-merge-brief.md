# Knowledge + Memory -> Note 合并决策简报

更新时间：2026-03-21
当前工作流：见 [docs/chengxing-refactor-tracker.md](./chengxing-refactor-tracker.md)

## 现状

- 代码里还没有 `Note` 的持久模型、route 或 object seam；`SYSTEM.md` 里的 `Note` 目前只存在于合约层。
- 现有认知数据仍分成两套持久模型：
  - `KnowledgeItem { title, content, sourceType, documentId? }`
  - `Memory { category, content, sourceThreadId?, active, sessionId?, documentId? }`
- 用户表面和 AI prompt 仍把二者当成不同概念：
  - `Context` 面板把 `Knowledge` 展示为“有标题的知识条目”，把 `Memory` 展示为“带 category badge 和 active 开关的记忆”。
  - AI context builder / tool summary 分别输出 `title: content` 与 `[category] content`。

## 目标

- 只有在不丢失当前用户可见语义和 AI 上下文语义的前提下，再把 `KnowledgeItem + Memory` 收口到一个 canonical `Note` contract。

## 差距

- `KnowledgeItem.title` 在当前 `Note` 合约中没有落点；若直接塞进 `content`，`Context` UI 和 AI prompt 都会退化。
- `Memory.category` 当前承载 `correction | preference | domain_knowledge | constraint` 等可见 taxonomy，`Note.kind = fact | preference` 不足以无损承接。
- `KnowledgeItem.sourceType` 与 `Memory.sourceThreadId` 当前分别表达来源类型和来源引用，`Note.source / sourceRef` 的编码规则还未冻结。
- `Memory.active` 具备启停语义，而 `KnowledgeItem` 目前只有存在 / 删除语义；如果直接改单表，`Context` UI 需要先明确是否保留 `Knowledge / Memory` 双分区。
- 因此，当前不是一次“把两张表换成一张表”的机械迁移，而是一次对象契约和 UI 语义确认。

## 执行计划

1. 先确认 `Note` contract：
   - 是否补 `title?`
   - 是否扩展 `kind` 或新增 category/subkind，能承接现有 memory taxonomy
   - 是否明确 `source / sourceRef` 对 `sourceType / sourceThreadId` 的映射规则
2. 基于确认后的 contract 更新 `SYSTEM.md`、`src/types`、`prisma/schema.prisma`，并明确 `Context` 面板是双分区还是单视图加过滤。
3. 再落 additive migration：
   - 新建 `Note` model/object/route/view seam
   - backfill 旧 `KnowledgeItem / Memory`
   - AI context builder 和 tool summary 统一改读 `Note`
4. 最后删除旧表、旧 route 和残留 UI 命名。

## 验收标准

- `Note` contract 能无损表示现有 `KnowledgeItem` 和 `Memory` 的用户可见字段与 AI prompt 语义。
- `Context` 面板不会因为合并失去 `Knowledge.title` 或 `Memory.category/active` 的表达能力。
- AI prompt / tools 输出保持现有信息密度或更高。
- 迁移完成后，旧 `KnowledgeItem` / `Memory` 表、route 和 type alias 可删除，且 `npm run verify:iteration` 全绿。
- 当前状态：仅完成差距评估，尚未进入 schema / migration 代码。
