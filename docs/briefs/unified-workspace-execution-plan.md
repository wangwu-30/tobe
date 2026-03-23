# Unified Workspace Model - 执行计划

> 方向文档：[unified-workspace-model.md](./unified-workspace-model.md)
> 日期：2026-03-23
> 状态：待执行

## 数据层现状

所有交付物类型（`document | slides | web`）共用 `Document` 表。
`Document` 已有 `projectId`、`parentDocumentId`、`treeSortOrder`。
`Session` 通过 `wikiId` 绑定单个 Document。

---

## Step 0：锁死两个架构边界（~0.5 天）

后续所有步骤依赖这两个决策，必须先落地。

### 0.1 Workspace Identity

终态路由：`/workspace/{projectId}?node={nodeId}`。
一个 Project = 一个 workspace。切换 Node 只换 query param，不跳路由。

#### [NEW] `src/lib/workspace/node.ts` (Node Facade)

新步骤都挂在 Node 边界上，不继续扩展 `deliverable` 系列 API。

```typescript
// 稳定的 Node 读写接口，内部代理到现有 Document/File 层
export function readNodeContent(projectId: string, nodeId: string): Promise<NodeContent>
export function listProjectNodes(projectId: string): Promise<NodeSummary[]>
```

### 0.2 Project Chat Focus 语义

#### [MODIFY] `prisma/schema.prisma`

- `Session` 加 `projectId String?`（创建后不可变）
- `ChatMessage` 加 `focusNodeId String?`（每条消息记录发送时的活跃 Node）

运行时 `focusNodeId` 不持久化在 Session 上，由前端路由的 `?node=` 参数驱动。

#### Legacy 字段退场规则

| 字段 | 新 Session（projectId 非空） | 旧 Session（projectId 为空） |
|------|---------------------------|----------------------------|
| `Session.wikiId` | 恒为 null，不再写入 | 保留原值，只读兼容 |
| `ChatMessage.documentId` | 过渡期写入 focusNodeId 的镜像值，Step 4 稳定后废弃 | 保留原值 |
| `ChatMessage.focusNodeId` | 权威字段，所有新代码只读此字段 | 不回填 |

旧 Session 不做数据迁移，仅对新创建的项目级 Session 执行新规则。

**退出条件**：Node facade 编译通过 + Schema 迁移完成 + `verify:iteration` 通过

---

## Step 1：i18n 文案清扫（~0.5 天）

#### [MODIFY] `src/lib/i18n/copy.ts`

面向用户的"交付物" -> 按语境替换为自然语言。约 50 处 ZH + 30 处 EN。
仅改 i18n 文案，不改代码变量名/类型名/API 路由。

**退出条件**：UI 无"交付物"/"deliverable"面向用户文案 + `verify:iteration` 通过

---

## Step 2：首页中央 -> 项目卡片墙（~1 天）

#### [MODIFY] `src/app/page.tsx`

- `projects.length > 0`：Hero 缩为单行，中央渲染项目卡片网格
- `projects.length === 0`：保留 Hero 引导

#### [NEW] `src/components/layout/project-card.tsx`

显示：项目名 + 最近活跃 Node 名称 + 相对时间。
不显示"项目类型图标"（Project 无类型，类型是 Node 的属性）。
点击 -> `/workspace/{projectId}?node={latestNodeId}`。

**退出条件**：首页有项目时中央显示卡片网格 + `verify:iteration` 通过

---

## Step 3：路由重构 + 工作区侧栏重排（~1.5 天）

### 3.1 路由切换

#### [MODIFY] `src/app/workspace/[id]/page.tsx` 及路由层

从 `/workspace/{documentId}` 迁移到 `/workspace/{projectId}?node={nodeId}`。
兼容旧 URL（如果 id 是 documentId，自动 redirect 到对应 projectId 路由）。

### 3.2 侧栏重排

#### [MODIFY] `src/components/workspace/deliverable-sidebar.tsx`

1. Project Tree 提拔到紧跟项目名之下
2. 点击 Node -> 只更新 `?node=` query param，不 `router.push` 到新 workspace
3. Section 标题：`项目交付物` -> `目录`；`交付物大纲` -> `大纲`

**退出条件**：切换 Node 不刷新页面，URL 格式正确 + `verify:iteration` 通过

---

## Step 4：AI Conversation 提升到 Project 级（~2 天）

### 4.1 Session 复用

#### [MODIFY] 创建工作区流程

新建同 Project 的 Node 时，复用已有的项目级 Session，不新建。
涉及 `src/lib/workspace/create-intent.ts` 及相关 API route。

### 4.2 Context 分层注入

#### [MODIFY] `src/lib/ai/context-builder.ts`

使用 Node Facade 加载 context，严格遵循 budget：
- Layer 1：focusNode 完整内容（max 8k tokens）
- Layer 2：top-5 sibling 的标题 + 前 200 字符（~2k tokens）
- Layer 3：mount Project 仅标题列表（~0.5k tokens）

#### [MODIFY] `src/lib/ai/project-context.ts`

`formatProjectAiContext` 改用 Node Facade，加 top-k + 截断逻辑。

### 4.3 同项目任意 Node 按需读取

#### [MODIFY] `src/lib/ai/pi-agent-tools.ts`

现有 `read_project_deliverable_file` 迁移到 Node Facade：
- 新 tool `read_node_content(projectId, nodeId)` 调用 `node.ts` 读取同项目任意 sibling 正文
- 旧 `read_project_deliverable_file` 标记为 `@deprecated` 临时 alias，仅内部过渡；**在 Step 6 完成后删除**（此时所有调用方已切到新 tool）
- mount 场景（Step 5）复用同一个 `read_node_content`，只是 projectId 来自 mount 表

### 4.4 Message focusNodeId 记录

#### [MODIFY] Chat Panel 发消息流程

每条 ChatMessage 创建时自动记录当前 `focusNodeId`（从路由 query param 读取）。

### 4.5 Agent 运行时产品语言同步

#### [MODIFY] `src/lib/ai/context-builder.ts`

当前 system prompt 仍把系统建模为 "deliverable + same deliverable conversation"（line 195-206）。
本步骤将 prompt 语言与 Node 模型对齐：
- `deliverable` -> `content` / `node`
- `list_project_deliverables` -> `list_project_nodes`（prompt 中的 tool 引用名）
- `read_project_deliverable_file` -> `read_node_content`（prompt 中的 tool 引用名）
- "The deliverable is the product" -> "The content is the product"

不改变 prompt 的核心行为指令，只替换产品术语。

**退出条件**：同 Project 内切换 Node，Chat 历史连续 + 每条消息有 focusNodeId + AI 可按需读取任意 sibling 正文 + agent prompt 无 deliverable 术语 + `verify:iteration` 通过

---

## Step 5：跨项目 Mount（~1.5 天）

#### [MODIFY] `prisma/schema.prisma`

```prisma
model ProjectMount {
  id              String   @id @default(cuid())
  organizationId  String
  sourceProjectId String
  targetProjectId String
  createdAt       DateTime @default(now())
  @@unique([sourceProjectId, targetProjectId])
}
```

#### [NEW] UI 入口 + [MODIFY] `context-builder.ts`

mount 后 AI context Layer 3 注入被 mount Project 的 Node 标题列表。
内容按需通过 Node Facade 的 tool 拉取。

**退出条件**：Project A mount B，AI 在 A 内可引用 B 的内容 + `verify:iteration` 通过

---

## Step 6：Node 搜索（~1 天）

#### [NEW] `src/components/layout/sidebar-search.tsx` + API `/api/search/nodes`

Sidebar 搜索框，按标题/内容文本匹配，支持 projectId 过滤。

**退出条件**：Sidebar 搜索可定位目标 Node + `verify:iteration` 通过

---

## 暂不执行

| 项目 | 理由 |
|------|------|
| Browser Node | 需要 webview 基础设施 |
| Node 标签 | 搜索先行 |
| Embedding 语义检索 | 等 Node 量上来后 |
| 代码层 deliverable 全量重命名 | 有 Node Facade 兜底即可 |

---

## 总预估 ~8 天

```
Step 0 (0.5d) -> Step 1 (0.5d) -> Step 2 (1d) -> Step 3 (1.5d) -> Step 4 (2d) -> Step 5 (1.5d) -> Step 6 (1d)
 边界锁定        文案清扫        首页改版       路由+侧栏       AI 提权        跨项目          搜索
└─ 前置决策 ─┘└── UI 减法 ──────────────────┘└──── 架构跃迁 ────────┘└── 增强 ──┘
```

## 验证方式

每个 Step 完成后：`npm run verify:iteration`（tsc + eslint + E2E specs）。
