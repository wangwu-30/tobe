# 成形统一工作空间执行追踪器

更新时间：2026-03-23 11:53 CST
状态：已完成
对应技能：`program-autopilot`
相关文档：[统一工作空间模型](./briefs/unified-workspace-model.md) · [执行计划](./briefs/unified-workspace-execution-plan.md) · [迭代回归门禁](./testing/iteration-regression-plan.md) · [经验台账](./chengxing-lessons-learned.md)

## 当前工作流范围

本追踪器只服务 `Project + Node` 统一工作空间模型，不并入旧的统一交付模型 / v-next 收口账本。

当前确认范围：

- Step 0：锁死 `workspace identity` 与 `project chat focus` 两个架构边界
- Step 1：i18n 文案清扫
- Step 2：首页中央项目卡片墙
- Step 3：路由重构 + 工作区侧栏重排
- Step 4：Project 级 AI Conversation
- Step 5：跨项目 mount
- Step 6：Node 搜索

不在当前范围：

- Browser Node
- Node 标签
- Embedding 语义检索
- 代码层 `deliverable` 全量重命名

## 已确认决策

- 本 workstream 的 canonical planning surface 是 [执行计划](./briefs/unified-workspace-execution-plan.md)，不是旧的 `docs/unified-deliverable-model-tracker.md`
- 终态路由固定为 `/workspace/{projectId}?node={nodeId}`
- 一个 Project = 一个 workspace；Node 只是当前 focus 内容，不再作为独立 workspace identity
- `Session.projectId` 绑定 Project 且创建后不可变；`ChatMessage.focusNodeId` 记录消息发生时的焦点 Node
- 新的 Node 读写边界统一挂在 `src/lib/workspace/node.ts`，不继续扩展旧 `deliverable` 命名的公共契约
- deliverable 命名的旧 tool alias 已在 Step 6 删除；后续同项目 / mounted project 读取统一只走 `list_project_nodes` 与 `read_node_content`

## 阶段追踪

| Step | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| 0 | 架构边界锁定 | 已完成 | 0.1、0.2A、0.2B、legacy create/write cleanup 与 workspace delete seam 已全部完成并验证通过 |
| 1 | i18n 文案清扫 | 已完成 | 首页、工作区和上下文面板的用户可见 deliverable 文案已收口为 content/item 语义，并验证通过 |
| 2 | 首页中央项目卡片墙 | 已完成 | 首页有项目时已切到项目卡片墙，card click 和继续动作都走 canonical route，并验证通过 |
| 3 | 路由重构 + 侧栏重排 | 已完成 | 3.1、3.2 已完成并验证通过；Step 4 可直接接 project-scoped chat |
| 4 | Project 级 AI Conversation | 已完成 | 4.1、4.2、4.3、4.4、4.5 已完成并验证通过 |
| 5 | 跨项目 mount | 已完成 | 5.1 backend-first mount 与 5.2 UI 入口均已完成并验证通过 |
| 6 | Node 搜索 | 已完成 | Sidebar 搜索、Node Facade 搜索 route 和旧 tool alias 删除均已完成并验证通过 |

## 当前切片

### 已完成：Step 0 workspace delete seam cleanup

目标：

- 收掉删单个 Node 时仍按 `sessionId / wikiId` 粗删 conversation 的 legacy seam，避免 project-scoped shared conversation 被误删
- 保持 Node 删除只清理当前 Node 的文件、版本、评论、plan 和 node-scoped 运行产物，不顺手抹掉同项目其他 Node 仍在使用的 shared session
- 让 `getConversationWorkspace()` 在最近 focus node 已被删除时继续回退到同项目仍存在的 Node，避免项目级会话恢复直接断掉

结果：

- `src/app/api/workspaces/[workspaceId]/route.ts` 已把 workspace delete 分成两类作用域：项目内仍有其他 Node 时保留 `projectId` 绑定的 shared conversation，只删除 node-scoped session 与 `documentId=workspaceId` 的 node-bound artifacts；删最后一个 Node 时再清掉整个 project-scoped conversation 集合
- 同一补丁里已把 shared conversation 的 `activeFileId` 从被删 Node 的文件上回落为 `null`，避免保留下来的 project-scoped session 继续悬挂到已删文件
- `src/lib/workspace/service.ts` 的 `getConversationWorkspace()` 现在会先跳过已删除的 focus node，再回退到同项目仍存在的 Node；Node 删除后，项目级 conversation 仍可恢复
- `tests/e2e/iteration/14-project-ai-context.spec.ts` 已新增“删除 sibling node 后保留 shared conversation 并回退到剩余 node”的回归
- 完整 `npm run verify:iteration` 已通过，结果为 `76 passed (3.4m)`

### 已完成：Step 0 legacy create/write cleanup

目标：

- 把项目级 conversation / message create path 的权威写入正式切到 `projectId / focusNodeId`
- 停止用 `wikiId` 驱动项目级 conversation 的 active file 生命周期更新
- 给 raw field 行为补一条可回归的 debug 断言，避免后续对象边界再悄悄回退

结果：

- `src/objects/conversation/commands.ts` 已把新 message 与 branched message copy 的权威写入切到 `focusNodeId`，新项目级消息不再写 `documentId`
- `src/objects/conversation/queries.ts`、`src/objects/file/commands.ts` 与 `src/objects/state/draft-commands.ts` 已通过 focused conversation seam 更新 `activeFileId`，不再按 `wikiId` 盲改项目级 shared conversation
- 新增 `src/app/api/debug/conversations/[conversationId]/route.ts` 与 `tests/e2e/iteration/14-project-ai-context.spec.ts` raw-field 回归，锁住 `Session.projectId`、`ChatMessage.focusNodeId` 和 active file replacement 行为
- 完整 `npm run verify:iteration` 已通过，结果为 `75 passed (3.4m)`

### 已完成：Step 2 首页中央项目卡片墙

目标：

- 把首页入口从旧的 deliverable 列表心智进一步拉到 `一个 Project = 一个 workspace` 的信息架构
- 让首页中央区域优先暴露项目级入口、最近活跃 node 和继续动作，而不是继续放大旧交付物对象
- 保持 Step 0-6 已经锁死的 canonical route / project-scoped conversation / node facade 边界，不在首页重新分叉对象语义

结果：

- 新增 `src/components/layout/project-card.tsx`，首页在有项目时已改成项目卡片墙：每张卡片显示项目名、最近活跃内容、相对时间，并把“继续当前内容 / 继续下一项内容”收口到同一视线层
- `src/app/page.tsx` 已把空态 Hero 和有项目后的项目卡片墙拆开；有项目时 Hero 收成单行说明，中央区域只保留项目卡片主画面
- `src/components/layout/app-shell.tsx` 的首页侧栏项目打开路径也已统一回 `buildWorkspaceRoute({ projectId, nodeId })`，不再让首页入口偷偷回退旧 `/workspace/{nodeId}` 路径
- `tests/e2e/iteration/01-home-start.spec.ts` 已把首页门禁更新为项目卡片墙断言，覆盖卡片摘要、canonical route 打开和“继续下一项内容”闭环
- 完整 `npm run verify:iteration` 已通过，结果为 `75 passed (3.4m)`

### 已完成：Step 1 i18n 文案清扫

目标：

- 清掉用户可见表面还残留的 `deliverable` 旧文案，避免统一工作空间已经切到 `project + node`，UI 还在回流旧对象模型
- 让首页、工作区、状态面板和辅助入口继续沿用统一工作空间语言，不让 Step 6 新入口和旧 UI 术语并存
- 保持这一步只做用户表面文案与命名收口，不额外扩展对象模型或新交互

结果：

- `src/lib/i18n/copy.ts` 已把首页、工作区、上下文面板和辅助入口里的用户可见 `deliverable / 交付物` 文案收口为 `content / item / 当前内容 / 项目内容` 等统一工作空间语言，同时保留内部 key、类型名和兼容契约不动
- `tests/e2e/iteration/01-home-start.spec.ts`、`tests/e2e/iteration/06-workflow-status.spec.ts` 和 `tests/e2e/iteration/14-project-ai-context.spec.ts` 已同步更新高频入口、上下文标签和知识提示的可见断言
- 迭代回归计划里的 AI-facing tool 名称也已维持在 `list_project_nodes / read_node_content`，避免 Step 1 文案清扫把旧 deliverable 心智重新带回测试叙述
- 完整 `npm run verify:iteration` 已通过，结果为 `75 passed (3.6m)`

### 已完成：Step 6 Node 搜索

目标：

- 给 Project 级 workspace 一个可直接定位 Node 的搜索入口，而不是只靠长侧栏滚动
- 继续复用 `src/lib/workspace/node.ts` 作为搜索/读取边界，不为 UI 搜索再分叉对象模型
- 保持 `/workspace/{projectId}?node={nodeId}` 的 route identity，不把搜索结果点击退回旧路径心智

结果：

- `src/lib/workspace/node.ts`、`src/app/api/search/nodes/route.ts` 与 `src/lib/workspace/project-client.ts` 已新增 project-scoped Node 搜索边界、搜索 route 和前端调用，不再为 sidebar 搜索复制第二套对象查询
- 新增 `src/components/layout/sidebar-search.tsx`，并由 `src/components/workspace/deliverable-sidebar.tsx` 在当前项目语境里暴露 `项目内定位 / Find in Project` 入口；结果点击统一走 `buildWorkspaceRoute({ projectId, nodeId })`
- `tests/e2e/iteration/06-workflow-status.spec.ts` 已新增“按内容命中 sibling node 并通过 canonical route 打开”的 UI 回归覆盖
- `src/lib/ai/pi-agent-tools.ts` 已删除 `list_project_deliverables` / `read_project_deliverable_file` 旧 alias，当前 runtime 只暴露 `list_project_nodes` 与 `read_node_content`
- `npm run verify:iteration` 已通过，结果为 `75 passed (3.4m)`

### 已完成：Step 5.2 mount UI 入口

目标：

- 给用户一个显式创建 / 管理 mount 的表面入口，而不是只剩 backend route
- 让工作区能看见当前项目已挂载的外部项目，避免 mount 成功后完全不可见
- 保持 Step 5.1 已落地的“默认只注入标题、正文显式读取”边界不被 UI 反向打破

结果：

- `src/lib/workspace/project-client.ts`、`src/components/workspace/deliverable-sidebar.tsx` 与 `src/lib/i18n/copy.ts` 已补工作区侧栏的 `关联项目 / Linked Projects` section、显式新增 dialog 和已关联项目列表，mount 不再只存在于 backend route
- 跨项目打开已统一回到 canonical `buildWorkspaceRoute(...)`，修掉了 workspace 内点击其他 Project 仍沿用当前 project path 的错误路由语义
- `tests/e2e/iteration/06-workflow-status.spec.ts` 已新增“从侧栏添加关联项目并直接打开目标项目”的 UI 回归覆盖
- 完整 `npm run verify:iteration` 已通过，结果为 `74 passed (3.3m)`

### 已完成：Step 5.1 mount 数据模型 + Layer 3 注入

目标：

- 把 mount 从方向文档里的概念变成真实数据对象，而不是继续停留在“未来语义”
- 让 project context 的 Layer 3 真的注入 mounted project 的 node 标题列表，但不默认注入正文
- 让跨项目正文读取继续复用 `read_node_content`，不为 mount 再长第二套读取工具

结果：

- `prisma/schema.prisma`、`prisma/migrations/20260323043000_add_project_mounts` 与 `scripts/bootstrap-local-db.mjs` 已新增 `ProjectMount` 数据模型和 iteration bootstrap 探针，mounted project 不再只是文档口头约定
- 新增 `src/objects/project-mount/*` 与 `/api/projects/[projectId]/mounts`，mount 的查询/创建边界已从 route 内联逻辑收口为独立对象
- `src/lib/workspace/node.ts`、`src/lib/ai/project-context.ts`、`src/lib/ai/context-builder.ts` 和 `src/lib/ai/pi-agent-tools.ts` 已支持 Layer 3 mounted title 注入、mounted project node 列举，以及带 `projectId` 的 `read_node_content` 显式跨项目读取
- `tests/e2e/iteration/14-project-ai-context.spec.ts` 已新增“mount 后默认只见标题、不见正文，但可显式读取 mounted node 正文”的回归覆盖
- 完整 `npm run verify:iteration` 已通过，结果为 `73 passed (3.2m)`

### 已完成：Step 4.2 Context 分层注入

目标：

- 用 Node Facade 收口项目级 AI context 的默认注入 budget，不再把整个 sibling 列表无上限塞进 prompt
- 严格实现 Step 4 的 Layer 1 / Layer 2 / Layer 3 语义：当前 focus node 完整内容、top-k sibling 摘要、mount 项目标题列表
- 为 Step 5 mount 和 Step 6 node 搜索保留稳定的上下文注入边界，避免大项目把 prompt 打爆

结果：

- `src/lib/workspace/node.ts` 已补 AI 友好的内容归一化、primary file 路径和 preview 提取，项目级 context 不再直接拿原始 structured content/全量 sibling 列表拼 prompt
- `src/lib/ai/project-context.ts` 已落地默认 budget：当前 node 正文深注入、top-5 最近 sibling 摘要、超出部分明确标记 omitted count
- `src/lib/ai/context-builder.ts` 已把当前 node 内容真正注入 system prompt，并把默认提示改成“当前 node 正文 + top-5 sibling 摘要”的心智
- `tests/e2e/iteration/14-project-ai-context.spec.ts` 已新增 current-node content 注入、top-5 sibling 截断和 omitted sibling 的回归覆盖
- 完整 `npm run verify:iteration` 已通过，结果为 `72 passed (3.2m)`

### 已完成：Step 4.3-4.5 runtime prompt / node tools / message focus 收口

目标：

- 把项目级同项目读取能力正式收口到 Node Facade，不再让新公共契约继续暴露旧 deliverable 命名
- 让项目级 chat 的每条消息都稳定记录 `focusNodeId`，不再依赖 session 或运行时路由去猜当时焦点
- 让 system prompt、debug 工具和 workspace context 的产品语言与 `project + node` 模型一致

结果：

- `src/lib/ai/pi-agent-tools.ts` 已新增 `list_project_nodes` / `read_node_content` 主路径，并把 `list_project_deliverables` / `read_project_deliverable_file` 收口为带删除时点的临时 alias
- `src/lib/ai/context-builder.ts`、`src/lib/ai/project-context.ts` 和 workspace context 输出已从 deliverable 术语切到 project/node 术语，prompt 不再暴露旧工具名
- `src/agent/run.ts`、`src/lib/ai/agent-run-route.ts` 和消息写入链路已把当前 `focusNodeId` 落到账本，项目级消息不再只靠 legacy `workspaceId/documentId` 镜像恢复焦点
- `tests/e2e/iteration/14-project-ai-context.spec.ts` 已新增 focusNodeId 与新 tool 命名的回归覆盖
- 完整 `npm run verify:iteration` 已通过，结果为 `71 passed (3.2m)`

### 已完成：Step 4.1 Project 级 AI Conversation session 复用

目标：

- 新建同 Project 的 Node 时复用项目级 Conversation / Session，不再每个 Node 默认新开一条会话
- 把项目级会话身份真正落到创建流，而不是只在 schema 和读路径上兼容
- 为后续 Step 4.4 `focusNodeId` message 记录和 Step 5 mount 打通 runtime 入口

结果：

- `src/lib/workspace/create-request.ts`、`src/app/api/workspaces/route.ts` 和相关 workspace create 入口已在同项目新建 Node 时复用当前 project-scoped conversation
- 首页、工作区和 sidebar 的“继续下一份内容”路径已把当前 conversation id 透传到创建流，避免同项目派生时默认新开会话
- `tests/e2e/iteration/06-workflow-status.spec.ts` 已补同项目 sibling create 复用 conversation 的门禁
- 完整 `npm run verify:iteration` 已通过，结果为 `70 passed (3.2m)`

### 已完成：Step 3.2 route sync + 侧栏命名收口

目标：

- 让工作区侧栏里所有 Node 切换都只变 `?node=`，不再退回 `/workspace/{nodeId}` 旧 path 心智
- 把侧栏 section 标题收口到统一工作空间语言：`目录 / 大纲`
- 为 Step 4 的 project-scoped chat 保持稳定的 project path identity，避免侧栏与 header 对路由语义理解不一致

结果：

- `src/components/workspace/deliverable-sidebar.tsx` 的 project tree / support-file fallback 已统一走 `buildWorkspaceRoute(...)`，侧栏 sibling Node 切换不再退回旧 `/workspace/{nodeId}` path
- 侧栏 section 文案已收口为 `目录 / 大纲`，并补了稳定 test id 锁住 project tree 和 outline section
- project tree 的 `Continue from Here` 子按钮已显式退出父级 drag 语义，避免拖拽容器吞掉 click，保证同项目下一份交付物流程可稳定打开 composer
- `tests/e2e/iteration/06-workflow-status.spec.ts` 已新增 query-route 切换门禁，并同步 sibling creation 场景到新的 route / clarify 心智
- 完整 `npm run verify:iteration` 已通过，结果为 `70 passed (4.1m)`

### 已完成：Step 3.1 workspace route 兼容层

结果：

- 新增 `src/lib/workspace/route.ts`，统一生成 `/workspace/{projectId}?node={nodeId}` canonical route
- `src/app/workspace/[workspaceId]/page.tsx` 已区分 routeProjectId 与 requestedNodeId；旧 `/workspace/{documentId}` 会在 hydrate 后自动规范到 project route
- `src/surfaces/workspace/use-workspace-route-controller.ts` 已改为同步 stable project path + query-driven node focus，切换 sibling Node 不再把 path identity 当成当前内容身份
- `tests/e2e/iteration/helpers.ts` 与 `tests/e2e/iteration/06-workflow-status.spec.ts` 已同步新的 route 解析心智
- 完整 `npm run verify:iteration` 已通过，结果为 `69 passed (3.3m)`

### 已完成：Step 0.2B project-scoped conversation read flip

结果：

- `src/objects/conversation/queries.ts` 已按 `projectId` 读取 conversation list / branch tree / current conversation，并把旧 `projectId` 为空但 `wikiId` 属于同项目的 legacy 会话一并收回
- `src/lib/workspace/service.ts` 的 workspace conversation state 已按项目范围装载；`getConversationWorkspace()` 改为优先根据最新消息的 `focusNodeId` 恢复当前 Node
- `src/app/api/conversations/route.ts` 与 `src/lib/ai/chat-request.ts` 已支持 project-scoped 读路径和 focus-based workspace recovery
- 完整 `npm run verify:iteration` 已通过，结果为 `69 passed (3.0m)`

### 已完成：Step 0.2A conversation compatibility groundwork

结果：

- `prisma/schema.prisma` 与 migration 已新增 `Session.projectId`、`ChatMessage.focusNodeId`
- 新建 workspace / conversation / message / branch 路径已开始双写 `projectId / focusNodeId`，保留 `wikiId / documentId` 兼容镜像
- `src/objects/conversation/view.ts`、`src/types/index.ts`、`src/lib/ai/chat-request.ts` 和消息 API 已暴露新字段，后续 route/runtime 可直接接入
- 完整 `npm run verify:iteration` 已通过，结果为 `69 passed (3.8m)`

### 已完成：Step 0.1 Node Facade bootstrap

结果：

- 新增 `src/lib/workspace/node.ts`，收口 `resolveProjectNodeScope / listProjectNodes / readNodeContent`
- `src/lib/ai/project-context.ts` 已改走 Node Facade，不再自己拼 Project 内 Document 查询
- `src/lib/ai/pi-agent-tools.ts` 的同项目正文读取已切到 Node Facade，旧 `read_project_deliverable_file` 只剩临时 alias 角色
- 全量门禁已通过，`npm run verify:iteration` 结果为 `69 passed (3.3m)`

## 下一候选切片

- 当前 workstream 已按执行计划完成；无已确认的下一切片

## 剩余验收项

- 当前执行计划的 Step 0-6 已全部完成并验证通过

## Blockers

- 无

## Verification History

- 2026-03-23：创建本追踪器，正式把统一工作空间模型从方向文档切到独立执行面。未单独运行 `npm run verify:iteration`，因为当前记录仅完成 tracker bootstrap；同轮代码切片完成后会补全量门禁结果。
- 2026-03-23：Step 0.1 Node Facade bootstrap 完成。`src/lib/workspace/node.ts` 已接入项目级 AI context 与同项目正文读取，完整 `npm run verify:iteration` 通过，结果为 `69 passed (3.3m)`。
- 2026-03-23：Step 0.2A conversation compatibility groundwork 完成。Schema、migration 与 conversation object 已开始双写 `projectId / focusNodeId`，完整 `npm run verify:iteration` 通过，结果为 `69 passed (3.8m)`。
- 2026-03-23：Step 0.2B project-scoped conversation read flip 完成。conversation 查询已切到 `projectId` 主路径并兼容 legacy `wikiId` 会话，完整 `npm run verify:iteration` 通过，结果为 `69 passed (3.0m)`。
- 2026-03-23：Step 3.1 workspace route 兼容层完成。页面入口、route controller 和测试 helper 已统一到 `/workspace/{projectId}?node={nodeId}`，完整 `npm run verify:iteration` 通过，结果为 `69 passed (3.3m)`。
- 2026-03-23：Step 3.2 route sync + 侧栏命名收口完成。project tree fallback、section 命名、sibling create 交互与相关 E2E 已统一到 query-driven route 语义，完整 `npm run verify:iteration` 通过，结果为 `70 passed (4.1m)`。
- 2026-03-23：Step 4.1 Project 级 AI Conversation session 复用完成。同项目新建 Node 已复用 project-scoped conversation，完整 `npm run verify:iteration` 通过，结果为 `70 passed (3.2m)`。
- 2026-03-23：Step 4.3-4.5 runtime prompt / node tools / message focus 收口完成。新 tool 命名、prompt 术语和 `focusNodeId` 落账已端到端打通，完整 `npm run verify:iteration` 通过，结果为 `71 passed (3.2m)`。
- 2026-03-23：Step 4.2 Context 分层注入完成。当前 node 正文深注入、top-5 sibling 摘要和 omitted sibling 门禁已收口，完整 `npm run verify:iteration` 通过，结果为 `72 passed (3.2m)`。
- 2026-03-23：Step 5.1 mount 数据模型 + Layer 3 注入完成。`ProjectMount`、mount route、mounted title context 和跨项目 `read_node_content` 已落地，完整 `npm run verify:iteration` 通过，结果为 `73 passed (3.2m)`。
- 2026-03-23：Step 5.2 mount UI 入口完成。工作区侧栏已新增 `关联项目 / Linked Projects` section、显式新增入口与跨项目 canonical route 打开能力，完整 `npm run verify:iteration` 通过，结果为 `74 passed (3.3m)`。
- 2026-03-23：Step 6 Node 搜索完成。Sidebar 搜索、`/api/search/nodes`、Node Facade 搜索能力和旧 deliverable tool alias 删除已一并落地，完整 `npm run verify:iteration` 通过，结果为 `75 passed (3.4m)`。
- 2026-03-23：Step 1 i18n 文案清扫完成。首页、工作区、上下文面板和相关高频入口的用户可见 deliverable 文案已收口为统一工作空间语言，完整 `npm run verify:iteration` 通过，结果为 `75 passed (3.6m)`。
- 2026-03-23：Step 2 首页中央项目卡片墙完成。首页中央区域已切到项目卡片墙，card click / 继续动作都统一走 canonical route，完整 `npm run verify:iteration` 通过，结果为 `75 passed (3.4m)`。
- 2026-03-23：在进入 Step 0 legacy 写路径清理前，先收掉了 branch overview 和文档 inline comment trigger 两类残留抖动。`tests/e2e/iteration/05-branching.spec.ts` 现已在点击 compare 前把 overview card 滚到稳定可操作位置；`src/components/comments/selection-comment-trigger.tsx` 则在 DOM selection 和 editor selection 可能错帧时补了一次延迟重读。完整 `npm run verify:iteration` 再次通过，结果为 `75 passed (3.4m)`。
- 2026-03-23：Step 0 legacy create/write cleanup 完成。项目级 message create path 已切到 `focusNodeId` 权威写入，`activeFileId` 更新也已脱离 `wikiId` 粗匹配，并通过 raw debug route + `tests/e2e/iteration/14-project-ai-context.spec.ts` 锁住回归；完整 `npm run verify:iteration` 通过，结果为 `75 passed (3.4m)`。
- 2026-03-23：Step 0 workspace delete seam cleanup 完成。删除 sibling Node 时已不再误删 project-scoped shared conversation，conversation workspace recovery 也会回退到同项目仍存在的 Node；新增回归后完整 `npm run verify:iteration` 通过，结果为 `76 passed (3.4m)`。
