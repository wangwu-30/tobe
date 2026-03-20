# 成形系统模型

更新时间：2026-03-20
当前工作流：见 [docs/chengxing-refactor-tracker.md](./docs/chengxing-refactor-tracker.md)
来源计划：见 [refactor_plan.md](./refactor_plan.md)

## 核心对象

### 组织层

- **Project** `{ id, name }`
  项目容器。一个项目下可包含多个交付物。
- **Folder** `{ id, projectId, parentId?, name, sortOrder }`
  项目内的分组节点。

### 内容层

- **Deliverable** `{ id, projectId, folderId?, name, renderAs }`
  用户正在产出的交付物。
  `renderAs` 是渲染提示，不是不可变的类型锁。
- **File** `{ id, deliverableId, parentId?, name, path, kind, purpose, content, sortOrder }`
  交付物下的文件或文件夹。
  `purpose` 区分 `output` 与 `reference`。
- **State** `{ id, deliverableId, parentId?, files[], createdAt, author }`
  交付物的不可变内容快照。
- **Label** `{ id, stateId, kind, name }`
  指向 `State` 的命名指针。
  `kind` 当前只承载 `milestone` 与 `head`。
- **Draft** `{ deliverableId, baseStateId, files[], revision }`
  每个 `Deliverable` 唯一的可编辑区。

### 协作层

- **Thread** `{ id, deliverableId, stateId, anchor, status }`
  关于某个内容锚点的讨论。
- **Conversation** `{ id, deliverableId, parentId?, baseStateId? }`
  围绕当前交付物的开放 AI 对话。
- **Message** `{ id, parentType, parentId, role, content, agentId?, mentions?, model?, createdAt }`
  `Conversation` 或 `Thread` 下的消息。

### 智能层

- **Persona** `{ id, handle, name, systemPromptLayer, scope }`
  Agent 的角色面具。
- **Action** `{ id, sourceType, sourceId, kind, status, input, output, resultStateId?, toolsUsed[] }`
  一次 agent 行为或需要恢复的长跑执行记录。
- **Policy** `{ toolName, safetyLevel, confirmationPolicy, writePolicy }`
  工具与 action 的执行约束。
  这是运行时对象，不是持久表。
- **RenderAdapter** `{ renderAs, fileContract, previewContract, anchorContract, diffContract }`
  `renderAs` 对应的渲染与交互适配器。
  这是运行时对象，不是持久表。

### 认知层

- **Note** `{ id, scope, scopeId, kind, content, source, sourceRef?, active }`
  统一的事实与偏好沉淀。
  `scope` 包含 `user | project | deliverable`。
  `kind` 包含 `fact | preference`。
- **Method** `{ id, scope, scopeId, title, steps[], constraints[], toolHints[], status }`
  工作方法与约束。

### 计划层

- **Goal** `{ id, deliverableId, description, constraints?, methodId? }`
  当前交付物的目标定义。
- **Step** `{ id, goalId, title, sortOrder, completed }`
  `Goal` 下的可执行步骤。

## Agent 原语

成形只应有一个通用 agent loop。
差异不通过“新 agent 类型”表达，而通过以下运行时原语表达：

- `Context`
  当前交付物、文件、状态、note、method、goal、thread / conversation history。
- `ToolKit`
  `base tools + renderAs tools + method tools + integrations`。
- `Persona`
  角色提示与行为倾向。
- `Policy`
  工具安全级别、确认门槛和写权限。
- `RenderAdapter`
  文件契约、预览方式、anchor 语义和 diff 方式。

## 核心不变量

- 推导状态不存储：
  `status`、thread classification、agent watching、plan status 属于推导结果。
- `State` 一旦创建不可修改。
- `Draft` 是唯一可变的内容容器。
- `Label` 是唯一的分类机制，`State` 自身不承担分类字段。
- `Thread` 只存事实：
  `stateId + anchor + status`。
  分类在查询时推导。
- `Action` 可以持久化长跑状态、确认状态和恢复状态。
  这些不是应被消灭的“脏状态”。
- Agent 只有一个 loop，通过 `Context + ToolKit + Persona + Policy + RenderAdapter` 适配场景。
- 添加新的 `renderAs` 不改核心模型，只加 `RenderAdapter + ToolKit + Canvas`。
- 迁移顺序遵循：
  先统一内部 runtime，再统一外部 route。

## 推导规则

- `status = f(draft, labels, actions, threads)`
- `thread.scope = f(thread.stateId, current.baseStateId, stateGraph)`
- `thread.inheritanceState = f(thread.anchor, currentFiles)`
- `activeAgents = f(recentMessages, listeningWindow)`
- `planStatus = f(steps.completed)`
- `milestoneNumber = count(labels where kind='milestone')`

## 当前重构约束

- 当前 workstream 的唯一运行中追踪面是 [docs/chengxing-refactor-tracker.md](./docs/chengxing-refactor-tracker.md)。
- 旧的产品收口计划或维护状态文档，不参与本轮切片选择。
- 对产品代码或行为有实质改动的切片，完成前必须运行 `npm run verify:iteration`。
