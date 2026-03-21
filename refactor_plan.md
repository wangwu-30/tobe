成形重构 + 地基沉淀：完整指导方案
全景
两条线并行推进，互相滋养：

地基线：沉淀知识资产（通用知识库 + 成形项目合约）
产品线：优雅重构成形（17 对象模型 + 统一 Agent + renderAs 扩展性）
做产品时产出知识 → 知识加速下一轮产品迭代 → 飞轮
第一部分：地基沉淀
A. 通用知识库
位置：成形仓库之外的独立位置（一个 repo、一个目录、一个 workspace——你选）

初始内容：把成形开发中踩过的通用坑写成 AI 可消费的文档

文档	来源	AI 消费价值
electron-nextjs-standalone.md	你配桌面壳时踩的坑	下个项目 10 分钟搞定 Electron
prisma-sqlite-local-first.md	Prisma 7 配置、migration、运行时路径	下个项目直接抄配置
playwright-isolated-testing.md	隔离 app-data-root、seed factory、全局 setup/teardown	下个项目测试基建即开即用
ai-streaming-patterns.md	流式响应、超时管理、中断控制、错误分类	任何 AI 产品都要用
oauth-credential-lifecycle.md	服务端 OAuth 存储、刷新、多 provider 管理	任何需要第三方认证的项目
nextjs-standalone-asset-sync.md	standalone 模式下 public/ 和 static/ 的同步	每次 Next.js 打包构建必遇
desktop-preload-header-injection.md	Electron preload bridge 注入 actor context	桌面 + Web 双模运行的通用模式
格式：每份文档统一结构

markdown
---
name: [kebab-case 名称]
scope: universal
---
## 场景
什么时候你会需要这个。
## 方案
具体怎么做，包含关键配置和代码。
## 已知坑
踩过的问题和解决方法。
## 验证
怎么确认配对了。
维护规则：每次在成形（或任何项目）中解决一个通用工程问题后，花 15 分钟写进通用知识库。不求完美，求有。

B. 成形项目合约
位置：成形仓库根目录

5 份核心文档：

SYSTEM.md — 系统模型
markdown
# 成形系统模型
## 核心对象
### 组织层
- **Project** { id, name } — 项目容器
- **Folder** { id, projectId, parentId?, name, sortOrder } — 项目内分组
### 内容层
- **Deliverable** { id, projectId, folderId?, name, renderAs } — 用户正在产出的东西
  - renderAs: 'document' | 'slides' | 'web' | 'code' — 渲染提示，非类型锁定
- **File** { id, deliverableId, parentId?, name, path, kind, purpose, content, sortOrder }
  - purpose: 'output' | 'reference' — output 参与版本快照，reference 不参与
- **State** { id, deliverableId, parentId?, files[], createdAt, author } — 不可变内容快照
- **Label** { id, stateId, kind, name } — 指向 State 的命名指针
  - kind: 'milestone' | 'head'
- **Draft** { deliverableId, baseStateId, files[], revision } — 每个 Deliverable 唯一的可编辑区
### 协作层
- **Thread** { id, deliverableId, stateId, anchor, status } — 关于内容某处的讨论
- **Conversation** { id, deliverableId, parentId?, baseStateId? } — 与 AI 的开放对话
- **Message** { id, parentType, parentId, role, content, agentId?, mentions?, model?, createdAt }
### 智能层
- **Persona** { id, handle, name, systemPromptLayer, scope } — Agent 的角色面具
- **Action** { id, sourceType, sourceId, kind, status, input, output, resultStateId?, toolsUsed[] }
- **Policy** { toolName, safetyLevel, confirmationPolicy, writePolicy } — Tool / Action 的执行规则（运行时对象，不持久化）
- **RenderAdapter** { renderAs, fileContract, previewContract, anchorContract, diffContract } — renderAs 对应的渲染与交互适配器（运行时对象，不持久化）
### 认知层
- **Note** { id, scope, scopeId, kind, content, source, sourceRef?, active }
  - scope: 'user' | 'project' | 'deliverable'
  - kind: 'fact' | 'preference'
- **Method** { id, scope, scopeId, title, steps[], constraints[], toolHints[], status }
### 计划层
- **Goal** { id, deliverableId, description, constraints?, methodId? }
- **Step** { id, goalId, title, sortOrder, completed }
## 核心不变量
- 推导状态不存储：status, thread classification, agent watching, plan status
- State 一旦创建不可修改
- Draft 是唯一可变的内容容器
- Label 是唯一的分类机制，State 本身无类型字段
- Thread 只存事实（stateId + anchor + status），分类在查询时推导
- Agent 只有一个 loop，通过 Context + ToolKit + Persona + Policy + RenderAdapter 适配所有场景
- 添加新 renderAs 类型不改核心模型，只加 RenderAdapter + ToolKit + Canvas
## 推导规则
- status = f(draft, labels, actions, threads)
- thread.scope = f(thread.stateId, current.baseStateId, stateGraph)
- thread.inheritanceState = f(thread.anchor, currentFiles)
- activeAgents = f(recentMessages, 3minWindow)
- planStatus = f(steps.completed)
- milestoneNumber = count(labels where kind='milestone')
CONVENTIONS.md — 代码约定
markdown
# 代码约定
## 目录结构
src/
├── framework/                # 可复用引擎（逻辑上独立，物理上暂住 app 内）
│   ├── agent/                # Agent Runtime
│   │   ├── index.ts          # 公开接口：runAgent, StreamController, AgentError
│   │   ├── run.ts            # < 200 行
│   │   ├── providers/        # 每个 provider 一个文件 < 100 行
│   │   ├── stream.ts         # < 150 行
│   │   └── types.ts
│   ├── state/                # State Engine
│   │   ├── index.ts          # 公开接口：createState, addLabel, rebase, diffStates
│   │   ├── dag.ts
│   │   ├── diff.ts
│   │   ├── snapshot.ts
│   │   └── types.ts
│   ├── platform/             # Platform Lib
│   │   ├── index.ts
│   │   ├── db.ts, fs.ts, auth.ts, sync.ts, runner.ts, search.ts, paths.ts
│   │   └── types.ts
│   └── ui/                   # UI 原子（无业务语义）
│       └── [button, dialog, select, ...]
│
├── objects/                  # 业务对象，每个子目录结构固定：
│   └── {name}/
│       ├── schema.ts         # TypeScript type
│       ├── queries.ts        # 读
│       ├── commands.ts       # 写
│       └── index.ts          # 公开导出
│
├── derive/                   # 推导函数（纯函数，无 DB，无副作用）
│   ├── status.ts
│   ├── thread-classify.ts
│   ├── agent-watching.ts
│   └── plan-status.ts
│
├── agent/                    # 成形 Agent 层
│   ├── context.ts            # AgentContext 拼装
│   ├── toolkit.ts            # ToolKit 组装（base + type + method）
│   ├── persona.ts            # Persona → prompt layer
│   ├── run.ts                # 调 framework/agent，前后加业务逻辑
│   └── tools/                # 每个工具一个文件
│       ├── base/             # list-files.ts, read-file.ts, write-file.ts, ...
│       ├── document/         # suggest-edit.ts, get-outline.ts, ...
│       ├── web/              # run-preview.ts, screenshot.ts, ...
│       ├── research/         # search-web.ts, deep-research.ts
│       └── meta/             # save-milestone.ts, update-step.ts, save-note.ts
│
├── canvas/                   # 每种 renderAs 一个目录
│   ├── document-canvas/
│   ├── slides-canvas/
│   └── web-canvas/
│
├── surfaces/                 # 产品表面
│   ├── workspace/            # 主工作区壳
│   ├── sidebar/
│   ├── assistant-panel/
│   ├── review-panel/
│   ├── status-panel/
│   ├── context-panel/
│   ├── home/
│   └── settings/
│
├── api/                      # API routes（只做适配）
│   ├── agent/run/route.ts    # 唯一的 Agent 入口
│   └── [resource]/route.ts   # CRUD 适配
│
└── shared/                   # 成形内部共享
    ├── copy.ts, router.ts, config.ts
## 硬规则
- 文件不超过 400 行
- 文件名 kebab-case
- 类型 PascalCase, 函数 camelCase, 常量 UPPER_SNAKE_CASE
- 不使用 any
- API route 不写业务逻辑，只调 objects/ 和 agent/
## 依赖方向
framework/ → 不得 import objects/, derive/, canvas/, surfaces/, agent/
objects/ → 可互相 import index.ts
derive/ → 只 import 类型，不 import 实现
api/ → 只 import objects/ 和 agent/ 的公开导出
CONSTRAINTS.md — 约束
markdown
# 约束
## 绝对禁止
- framework/ 中出现业务对象名（Deliverable, Thread 等）
- derive/ 中调用数据库或产生副作用
- 存储推导状态
- 超过 400 行的文件
- any 类型
- api/ route 中写业务逻辑
- 新增 Object 不更新 SYSTEM.md
## 需要确认
- 修改 framework/ 的公开接口
- 删除公开导出
- 修改 SYSTEM.md 中的核心不变量
## 默认行为
- 新的 derive 函数是纯函数
- 新的 Agent tool 必须声明 safety level（safe / confirm / privileged）
- 新的 Object 遵循 schema/queries/commands/index 骨架
PATTERNS.md — 任务模式
markdown
# 任务模式
## 添加新 Object
1. 更新 SYSTEM.md
2. prisma/schema.prisma 加 model
3. objects/{name}/ 建 schema.ts + queries.ts + commands.ts + index.ts
4. 如有推导状态 → derive/{name}.ts（纯函数）
5. npm run verify
## 添加新 renderAs 类型
1. agent/render-adapters/{type}.ts 建 render adapter
2. agent/tools/{type}/ 加工具文件
3. agent/toolkit.ts 的 TYPE_TOOLS 注册
4. canvas/{type}-canvas/ 建渲染器
5. npm run verify
## 添加新 Agent 工具
1. agent/tools/{category}/{tool-name}.ts 实现 ToolDefinition
2. 明确声明 safety level 与确认策略
3. 注册到对应 ToolKit
4. npm run verify
## 修改推导逻辑
1. 改 derive/{name}.ts
2. 确认纯函数（无 DB、无副作用）
3. 补单测
4. npm run verify
## 踩到通用坑
1. 解决问题
2. 判断：这个坑是成形专属还是通用的？
3. 通用的 → 写进通用知识库
4. 专属的 → 更新 docs/chengxing-lessons-learned.md

AGENTS.md
 — 更新现有文件
在现有 AGENTS.md 中加一条：

markdown
## 项目合约
- 开始任何工作前，先读 SYSTEM.md 理解对象模型
- 写代码时遵循 CONVENTIONS.md 的目录和命名约定
- 受 CONSTRAINTS.md 的约束
- 按 PATTERNS.md 的模式执行常见任务
- 若当前 workstream 是这轮重构，优先读取 docs/chengxing-refactor-tracker.md
第二部分：成形重构
执行顺序与依赖
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6
Autopilot校准  合约文档   巨石拆分   版本优雅化  评论优雅化  Agent统一  清理收口
(0.5天)       (1天)     (3天)     (3天)      (2天)     (4天)    (2天)
每个 Phase 结束必须 npm run verify:iteration 全绿。

Phase 0：Autopilot / Tracker Bootstrap（0.5 天）
做什么：

- 选定通用 skill `program-autopilot` 作为本轮重构的主驱动。
- 补齐当前 workstream override、contract docs、tracker bootstrap、workstream-local stop gate。
- 在仓库内创建 `docs/chengxing-refactor-tracker.md`，作为本轮重构的运行中追踪面。
- 明确这轮重构的 canonical execution surface：
  - `docs/chengxing-refactor-tracker.md`
  - `refactor_plan.md`
  - `SYSTEM.md / CONVENTIONS.md / CONSTRAINTS.md / PATTERNS.md`
  - `docs/testing/iteration-regression-plan.md`
  - `docs/chengxing-lessons-learned.md`

为什么先做这个：后续切片需要一个只服务当前重构 workstream 的追踪面，否则 autopilot 会被旧计划面带偏。

验收：`program-autopilot` 已支持当前 workstream 规则；`docs/chengxing-refactor-tracker.md` 已创建并记录 phase、当前切片、剩余验收项和 verification history。不涉及产品代码变更，不需要跑 verify。

Phase 1：写合约文档（1 天）
做什么：

在仓库根创建 SYSTEM.md、CONVENTIONS.md、CONSTRAINTS.md、PATTERNS.md
更新 

AGENTS.md
 加项目合约引用
在通用知识库写 2-3 份最重要的通用知识文档（Electron、Prisma、Playwright）
为什么先做这个：后面所有 Phase 的代码工作，AI 都可以参考这些文档来保持一致性。文档先行 = 后续每步效率翻倍。

验收：5 份文档存在且内容完整。不涉及代码变更，不需要跑 verify。

Phase 2：巨石拆分（3 天）
做什么：先抽内部 façade / runtime 边界，再把三个最大的文件拆开，最后建立 framework/ 和 objects/ 目录结构。

前置原则：

- Phase 2 不是“先搬目录”，而是“先收口边界，再迁移文件”。
- 先抽统一 façade：agent runtime、公用 service 出口、page 数据加载边界先收成薄接口。
- 再做目录迁移：避免得到“搬到新目录里的旧耦合”。

2a. 建目录骨架
bash
mkdir -p src/framework/{agent,state,platform,ui}
mkdir -p src/objects/{deliverable,state,thread,conversation,action,note,method,goal,persona,project,file}
mkdir -p src/derive
mkdir -p src/agent/tools/{base,document,web,research,meta}
mkdir -p src/canvas/{document-canvas,slides-canvas,web-canvas}
mkdir -p src/surfaces/{workspace,sidebar,assistant-panel,review-panel,status-panel,context-panel,home,settings}
每个目录放一个 

index.ts
 空壳。

2b. 拆 

service.ts
（3932 行）
按对象拆入 objects/：

原位置	新位置
workspace CRUD 相关函数	objects/deliverable/commands.ts + queries.ts
version 相关函数	objects/state/commands.ts + queries.ts
file 相关函数	objects/file/commands.ts + queries.ts
plan 相关函数	objects/goal/commands.ts + queries.ts
assistant run 相关函数	objects/action/commands.ts + queries.ts
staged changes 相关函数	objects/state/staged.ts
project 相关函数	objects/project/commands.ts + queries.ts
2c. 拆 

page.tsx
（3386 行）
原位置	新位置
主工作区组织逻辑	surfaces/workspace/workspace-screen.tsx
状态面板	surfaces/status-panel/status-panel.tsx
评审面板	surfaces/review-panel/review-panel.tsx
聊天面板	surfaces/assistant-panel/assistant-panel.tsx
上下文面板	surfaces/context-panel/context-panel.tsx
编辑器画布	canvas/document-canvas/document-canvas.tsx

page.tsx
 瘦身为纯适配壳：加载数据 → 传给 WorkspaceScreen。

2d. 拆 

use-chat.ts
（634 行）
原位置	新位置
超时/中断/流式控制	framework/agent/stream.ts → StreamController
sendMessage	agent/run.ts → executeAgentRun()
continueProposal	agent/run.ts → continueAction()
startResearch	agent/run.ts → startResearch()
通用错误处理	framework/agent/errors.ts
新的 

use-chat.ts
 只是一个薄 hook，调用 agent/run.ts 的函数。

2e. 移 UI 原子组件
把 components/ui/ 中纯原子组件移入 framework/ui/。保留业务组件（comment-node, block-discussion 等）在原位，后续 Phase 再归入对应 canvas/surfaces。

验收：npm run verify:iteration 全绿。

service.ts
 和 

page.tsx
 各不超过 200 行。

Phase 3：版本系统优雅化（3 天）
做什么：实现 State + Label + Draft 模型，替代 Version 的分类字段。

3a. 建 Label 表
prisma
model Label {
  id        String   @id @default(cuid())
  stateId   String   // 原 versionId
  kind      String   // 'milestone' | 'head'
  name      String
  createdAt DateTime @default(now())
  state     Version  @relation(fields: [stateId], references: [id], onDelete: Cascade)
  @@index([stateId])
}
暂时保留 

Version
 表名，通过 @map 以后再改。

3b. 数据迁移
sql
-- 把现有 versionType='manual' 的记录创建为 milestone Label
INSERT INTO Label (id, stateId, kind, name, createdAt)
SELECT cuid(), id, 'milestone', title, lockedAt
FROM Version
WHERE versionType = 'manual';
3c. 改查询逻辑
"获取可见里程碑" → SELECT * FROM Label WHERE kind='milestone' AND stateId IN (该 deliverable 的 version ids)
"获取分支头" → SELECT * FROM Label WHERE kind='head'
"该版本是否是 milestone" → EXISTS (SELECT 1 FROM Label WHERE stateId=? AND kind='milestone')
不再查询 versionType、visible、restorable、pinned
3d. 实现 framework/state/ 引擎
dag.ts：walkAncestors(stateId), findCommonAncestor(a, b), isAncestor(a, b)
snapshot.ts：createState(deliverableId, parentId, files)
label.ts：addLabel(stateId, kind, name), removeLabel(id)
draft.ts：rebase(deliverableId, newBaseStateId)
验收：branching E2E (05-branching) 和 regression guards (11-regression-guards) 全绿。Version 表的 versionType/visible/restorable/pinned/recoveryKind 字段不再被应用层读取。

Phase 4：评论系统优雅化（2 天）
做什么：消除评论的存储分类字段，改为查询时推导。

4a. 实现推导函数
derive/thread-classify.ts
  classifyThread(thread, currentBaseStateId, ancestorSet, draftFiles) → Classification
derive/agent-watching.ts
  getActiveAgents(threadMessages, agentConfigs, now) → ActiveAgent[]
4b. 改评论查询
objects/thread/queries.ts 的"获取可见评论"不再查 scope/inheritanceState 字段
改为：查所有 status='open' 的 thread → 过 classifyThread → 返回分类结果
4c. 简化 CommentThread 表
不删字段（避免 migration 风险），但应用层不再读写 scope、inheritanceState、isInherited、inheritedFromVersionId、inheritedFromVersionTitle 这些字段
agentBindingsJson 保持写入（向后兼容），但 comment read side 已改为从 getActiveAgents() / message history derive 推导；slice 64-65 已补齐 `stop_agent_listening` 的 message-level control event，并让 thread / research 相关读侧统一消费 message-history-derived binding
验收：comments E2E (04-comments, 07-block-discussion, 08-comment-agents) 全绿。

Phase 5：Agent 统一（4 天）
做什么：先统一内部 runtime 和 tool/context assembly，再把 5 个 API 入口收口为 1 个。

前置原则：

- 先让 `chat / comment-reply / suggest-edit / research-plan / extract-memory` 共用同一内部执行层。
- 外部 route 统一是终态收口，不是第一步。

5a. 实现 framework/agent/run.ts
通用 agent loop：

接收 systemPrompt + messages + tools + model
调用 provider
流式返回
执行工具调用
返回结果
5b. 实现 agent/toolkit.ts
typescript
function assembleToolKit(renderAs, method, integrations): ToolDefinition[] {
  return [...BASE_TOOLS, ...(TYPE_TOOLS[renderAs] ?? []), ...(method?.toolHints ?? []), ...integrations];
}
5c. 实现 agent/context.ts
typescript
function buildAgentContext(deliverableId, conversationOrThread): AgentContext {
  // 收集 Notes（user + project + deliverable scope）
  // 收集 Goal + Steps
  // 收集 current files + recent states
  // 收集 Method
  // 收集 sibling deliverables summary
  return context;
}
5c+. 明确 agent runtime 原语
- Agent 边界按 `Context + ToolKit + Persona + Policy + RenderAdapter` 实现。
- `Policy` 负责工具安全级别、确认门槛和写权限。
- `RenderAdapter` 负责 renderAs 的文件契约、预览契约、anchor 语义和 diff 方式。
5d. 统一 API 入口
新建 api/agent/run/route.ts，替代：


api/ai/chat/route.ts

api/ai/comment-reply/route.ts

api/ai/suggest-edit/route.ts

api/ai/research-plan/route.ts

api/ai/extract-memory/route.ts
slice 66 已完成旧 `/api/ai/{chat,comment-reply,suggest-edit,research-plan,extract-memory}` route 删除；外部入口已只剩 `/api/agent/run`。
non-chat 入口统一使用显式 envelope：
- `comment-reply`: `mode + target{threadId, workspaceId?, agentId?} + input{anchorText?, documentContent?} + model?`
- `suggest-edit`: `mode + target{workspaceId?} + input{anchorText, threadDiscussion, documentContent?} + model?`
- `extract-memory`: `mode + target{threadId} + model?`
- 旧 `/api/ai/*` 路由若仍承接 legacy 平铺字段，只允许在 adapter 层做一次归一，不能把旧契约继续扩散回共享入口。

5e. deriveStatus 替代 currentStatus
实现 derive/status.ts，所有消费 currentStatus 的地方改为调推导函数。

验收：chat (聊天相关 E2E)、research (13-research-flow)、comment agents (08-comment-agents) 全绿。旧 API 路由全部可删。

Phase 6：清理收口（2 天）
6a. 统一 Note
Knowledge 表 + Memory 表 → Note 表（scope + kind 区分）
迁移现有数据
更新 context-panel UI
slice 69 已完成差距评估：当前 `SYSTEM.md` 的 `Note { id, scope, scopeId, kind, content, source, sourceRef?, active }` 无法无损承接 `KnowledgeItem.title/sourceType` 与 `Memory.category/sourceThreadId/active`。详情见 `docs/chengxing-note-merge-brief.md`；在 Note contract 决策明确前，6a 视为 stop gate。
6b. 清理旧壳
删除 src/lib/wiki/ 目录
删除 src/types/index.ts 底部兼容 alias（WikiData, SessionWithRelations 等）
删除旧 API 路由（sessions/, wikis/, documents/，如果还存在的话）
删除旧 agent API 路由（chat/, comment-reply/, suggest-edit/, research-plan/, extract-memory/）
slice 67 已完成 `src/lib/wiki/` 兼容壳、未使用 wiki/session/document alias 与剩余 route caller 的删除；slice 68 已完成 `src/framework/**` 的 import guard。当前 Phase 6 剩余主线是 6a Note 合并决策、6d 完成态文档与 6e 通用知识沉淀。
6c. ESLint 依赖规则
javascript
'no-restricted-imports': ['error', {
  patterns: [
    { group: ['**/objects/**', '**/derive/**', '**/canvas/**', '**/surfaces/**'],
      importNames: ['*'],
      message: 'framework/ 不能依赖 application 层' }
  ]
}]
slice 68 已完成：`eslint.config.mjs` 已为 `src/framework/**/*` 增加 scoped `no-restricted-imports` 规则，并通过 `npx eslint src/framework --max-warnings=0` 与 `npm run verify:iteration`。
6d. 更新文档
docs/chengxing-lessons-learned.md 补充本轮经验
docs/chengxing-project-status.md 更新为完成态
SYSTEM.md 确认与实现一致
6e. 通用知识沉淀
回顾本轮重构中遇到的通用问题，写进通用知识库：

AI agent 统一入口的实现模式
DAG 版本管理的实现模式
推导替代存储的模式
monolith → 按对象拆分的模式
验收：npm run verify:iteration 全绿。grep -r "WikiData\|SessionWithRelations\|DocumentData" src/ 返回空。

时间线
Phase 0  Autopilot校准    ▌ 0.5天
Phase 1  合约文档        █ 1天
Phase 2  巨石拆分        ███ 3天
Phase 3  版本优雅化      ███ 3天
Phase 4  评论优雅化      ██ 2天
Phase 5  Agent 统一      ████ 4天
Phase 6  清理收口        ██ 2天
                         ─────────
                         总计 ~15.5天
验收标准
地基验收
 docs/chengxing-refactor-tracker.md 存在，并记录 phase、当前切片、剩余验收项、blockers、verification history
 通用知识库存在，包含至少 5 份通用工程知识文档
 成形仓库根有 SYSTEM.md / CONVENTIONS.md / CONSTRAINTS.md / PATTERNS.md
 AGENTS.md 引用项目合约
 每次重构 Phase 中踩到的通用坑都已写入通用知识库
产品验收
 17 个对象各自有 objects/{name}/ 目录，遵循 schema/queries/commands/index 结构
 无文件超过 400 行
 Version 的分类字段不再被应用层读取，Label 表承担所有分类
 评论的 scope/inheritanceState 在查询时推导，不再存储
 Agent 只有 1 个 API 入口
 Status 是纯函数推导，不存储
 Knowledge + Memory 合并为 Note
 framework/ 不依赖 application 层（ESLint 约束）
 旧兼容壳全部删除
 npm run verify:iteration 全绿
 docs/chengxing-lessons-learned.md 已更新
风险与缓解
风险	缓解
旧计划面把 autopilot 带偏	Phase 0 建立 workstream-local tracker，并要求 program-autopilot 优先读取当前重构追踪面
Phase 2 拆文件时遗漏引用	先 tsc --noEmit 确认类型，再跑 E2E
Phase 3 Label 迁移遗漏旧逻辑路径	对 versionType 做全仓 grep，确认无残留读取
Phase 5 统一入口漏掉某个模式的行为	旧路由保留为转发层，两套并行验证，逐个切换
重构中途发现 SYSTEM.md 需要修正	这是好事——立即更新文档，合约文档是活的
通用知识写得太粗	先有再好。下次用到时自然会补细节
一句话总结
Phase 0 先把 autopilot 和 tracker 校准到当前重构 workstream，再用 Phase 1-6 逐步落地系统合约、对象模型和统一 Agent。做完后，成形有了扎实的 17 对象模型与统一 runtime，你也有了可以持续复用的项目合约和通用知识地基。
