# 多角色评论监听 + 弱类型交付意图 收口计划

状态：2026-03-16 已完成，相关落地事实已并入 [项目状态](./docs/chengxing-project-status.md)。

## Summary

这轮收口按两条主线推进，并吸收前面 review 里的结构性修正：

- 评论区改成 `@角色` 驱动，支持一次 `@` 多个角色；每个被提及或刚回复过的角色会进入 3 分钟监听窗口。未 `@` 的后续追问，会自动续给所有仍在窗口内的角色。用户必须能明确看到“哪些 agent 还在等、会等到什么时候”，并能手动停止等待。
- `document / slides / web` 改成可切换的 `交付意图`，共用一个统一的 `Result Shell`。切意图不破坏文件、评论、版本，也不自动改造成品；变化的是 AI 意图、默认结果 renderer 和状态文案。`code` 继续排除在外。

这次计划明确采用以下修正：

- 不把瞬态 `replyState` 持久化成单独列。
- 不用单一 `activeAgentId`；改成线程级 `agentBindings` 结构，承载多角色监听窗口。
- 无效 `@something` 视为普通文本，不阻止提交。
- agent 配置缺失时，不阻塞线程人工使用；只阻塞对应 agent 的自动回复，并给出恢复入口。
- 评论 mention 输入坚持极简实现：`Textarea + 弹出列表 + 提交时正则解析`，不做富文本 token。

## Key Changes

### 1. 评论 Agent 机制重做

1. 删除旧控制面
- 删除 `comment-reply-mode` 本地存储、自动/批量回复切换、批量运行 AI 回复按钮、线程内“让 AI 回复”按钮。
- 评论回复的唯一触发器改成消息里的 `@角色` 或未过期的监听窗口。

2. 引入线程级多角色监听模型
- `CommentThread` 新增一个持久化 JSON 字段，例如 `agentBindingsJson`，存放：
  - `agentId`
  - `agentLabel`
  - `listeningUntil`
  - `lastActivatedAt`
  - `sortOrder`
- 监听规则固定：
  - 一条用户消息里可 `@` 多个角色，按提及顺序去重后依次触发回复。
  - 每个角色在“被 @”或“刚回复完成”时，把自己的 `listeningUntil` 刷新为 `now + 3 minutes`。
  - 用户后续消息如果未 `@`，自动续给所有当前 `listeningUntil > now` 的角色。
  - 回复按 `sortOrder` 顺序串行入线程，不并发，保证消息顺序稳定。
  - 用户可在 UI 上对某个等待中的角色执行 `停止等待`，立即移除该角色的有效监听窗口。
- 不做持久化 `replyState`。以下状态全部由线程消息 + `agentBindings` + 客户端流式状态推导：
  - `waiting`
  - `responding`
  - `blocked`
  - `idle`

3. 消息模型只持久化审计所需信息
- `CommentMessage` 新增：
  - `mentionedAgentsJson`，仅用户消息使用，记录这条消息实际触发了哪些角色
  - `agentId`
  - `agentLabel`，仅 assistant 消息使用，记录是谁回复的
- 不新增单一 `requestedAgentId`，因为已经支持多角色。
- 不把“正在回复中”写入数据库。

4. Agent 注册表和设置页
- 设置页新增 `Comment Agents` 分区，沿用现有本地 `ai-settings` 体系。
- v1 agent 注册表结构固定为：
  - `id`
  - `handle`
  - `name`
  - `systemPrompt`
  - `enabled`
  - `builtin`
- 首批内置 1 个系统角色：
  - `id: assistant`
  - `handle: @assistant`
  - 显示名：`AI 助手`
  - 不可删除，不可改 handle
- 设置页允许用户新增/编辑/启用/停用/删除自定义 agent。
- v1 不做云同步、分享、购买；只把注册表结构和设置入口搭好。

5. Agent 缺失与阻塞恢复
- 如果线程里某个监听中的角色在当前设备上已不存在或被禁用：
  - 该角色显示为 `未就绪`/`配置缺失`
  - 只阻塞该角色的自动回复，不阻塞线程继续发消息
  - UI 提供两个恢复动作：
    - `去设置恢复`
    - `停止等待`
- Provider 或模型不可用时，同样只阻塞对应角色，不让整个线程失能。

6. 评论输入交互
- 评论输入仍用 `Textarea`，不改成富文本编辑器。
- mention 交互采用最小实现：
  - 监听 `@`
  - 以输入框为锚点弹出角色列表
  - 选择后插入纯文本 `@handle`
  - 提交时用正则解析实际触发的角色
- 解析规则固定：
  - 未命中的 `@something` 按普通文本保留
  - 重复提及同一角色只算一次
  - 同一条消息允许多个不同角色
- 线程卡片展示等待中的 agent chips，格式类似：
  - `@assistant 等待中 · 02:41`
  - `@writer 未就绪`
  - `@reviewer 回复中`
- 相关入口全部统一：
  - 文档选区评论
  - web 选区评论
  - 右侧评论侧栏跟帖输入
  - plate comment create form

### 2. 评论回复链路改成 Agent-aware

1. `/api/threads` 和 `/api/threads/[threadId]/messages`
- 创建线程或追加消息时解析 mentions。
- 写入 `mentionedAgentsJson`。
- 更新线程 `agentBindingsJson`：
  - 新提及角色加入/刷新监听窗口
  - 已等待角色未被提及时保留原窗口
  - 用户手动停止等待时移除该角色或立即过期

2. `/api/ai/comment-reply`
- 入参改成支持一次消费多个角色，但服务端仍按单角色单次调用处理。
- 客户端负责把本轮要回复的角色串行调用。
- 路由内部从内置 agent + `x-ai-settings.commentAgents` 合并后的注册表里解析 prompt。
- assistant 消息落库时写入 `agentId` 和 `agentLabel`。
- agent 回复成功后刷新该角色自己的 3 分钟监听窗口。

3. 客户端回复调度
- `useAiReply` 扩成支持“线程内多 agent 串行回复队列”。
- 每轮用户消息提交后，客户端根据当前有效监听角色列表生成队列。
- 如果某个角色正在流式输出，其状态只在客户端内存里维护；刷新后按“最后一条消息是否来自该角色且仍在等待窗口内”重新显示等待，不恢复“进行中”。

### 3. `deliverableType` 改为可切换的 `交付意图`

1. 语义与命名
- 产品表面统一把“交付类型”改成“交付意图”。
- 数据库/API 这轮继续保留字段名 `deliverableType`，只改变语义，不做 schema rename。

2. 切换范围
- 本轮允许切换：
  - `document`
  - `slides`
  - `web`
- `code` 不进切换器，继续作为后续单独议题。

3. 切换规则
- 非破坏性切换，固定不做：
  - 不新建工作区
  - 不重命名文件
  - 不清空内容
  - 不丢评论/版本/上下文
  - 不自动把当前结果重写成新成品
  - 不静默重排现有 plan stages
- 切换后立即改变：
  - `WorkspacePlan.deliverableType`
  - AI prompt / plan generator 语义
  - 结果表面的默认 renderer
  - header / subtitle / empty-state / status copy
- 如果用户想把当前内容真正转成新意图，必须显式点：
  - `按新意图重整结果`

4. `Status` 成为唯一切换主入口
- 意图切换器放在 `Status` 面板顶部主卡内：
  - 位置固定在“当前阶段描述”下方、`Goal` 卡片上方
  - 使用紧凑 segmented control / pills
- 不在 starter 之外的其他地方再放第二个大型选择器。
- `GoalComposerDialog` 继续展示初始意图，但文案改为“初始交付意图，可稍后在状态面板调整”。

### 4. `Result Shell` 统一三种结果体感

1. 统一壳
- 中央主表面抽成一个统一 `Result Shell`：
  - 同一套 header
  - 同一套 subtitle/status 区
  - 同一套 empty/loading/error/result frame
  - 同一套 header action 布局
- document / slides / web 切换时，外层布局和状态卡不抖动。

2. renderer 映射
- `document`
  - 继续用正文 rich-text 结果面
- `slides`
  - 仍用结构化正文底座，但 labels、outline 语义、AI scaffolding 改成 deck / pacing 语言
  - 不另起一套独立系统
- `web`
  - 有 preview 入口时在同一 `Result Shell` 中嵌 iframe 结果
  - 没有 preview 入口时，不显示“类型不支持”，而是显示同一结果空态 + `生成网页结果壳` / `按新意图重整结果`
- `code`
  - 暂不并入本轮 `Result Shell` 切换体系

3. Planning 行为
- 切换交付意图后：
  - 现有 stages 保留
  - 未来 AI 继续推进、改写、生成时使用新的意图
  - 如需按新意图重排计划，走显式 replan / regenerate，而不是切换副作用

### 5. 实施顺序

1. Batch 1：评论 Agent 注册表与设置页
- `ai-settings` 扩展 `commentAgents`
- 设置页 CRUD
- 内置 `@assistant`
- mention 解析工具和输入框 dropdown

2. Batch 2：评论线程多角色监听
- Prisma migration：`CommentThread.agentBindingsJson`、`CommentMessage.mentionedAgentsJson / agentId / agentLabel`
- 路由与客户端调度
- 删除旧 reply mode 全链路
- 线程 waiting chips、countdown、停止等待、blocked 恢复入口

3. Batch 3：交付意图与统一结果壳
- `deliverableType` 语义切换
- `Status` 面板意图切换器
- `Result Shell` 抽象
- document/slides/web renderer 映射
- 显式 `按新意图重整结果`

4. Batch 4：回归与文档沉淀
- 扩 E2E
- 跑 `npm run verify:iteration`
- 更新 `docs/chengxing-lessons-learned.md`
- 更新项目状态文档中的验收记录

## Public Interfaces / Types

- `Settings` / `x-ai-settings`
  - 新增 `commentAgents: Array<{ id; handle; name; systemPrompt; enabled; builtin }>`
- `CommentThreadData`
  - 新增 `agentBindings: Array<{ agentId; agentLabel; listeningUntil; lastActivatedAt; sortOrder }>`
- `CommentMessageData`
  - 新增 `mentionedAgents: Array<{ agentId; agentLabel }>`，仅用户消息
  - 新增 `agentId` / `agentLabel`，仅 assistant 消息
- `DeliverableType`
  - 枚举值本轮不变
  - 产品语义改为 `交付意图`

## Test Plan

- 评论 Agent 机制
  - 新线程首条消息不 `@`：只建线程，不自动回复
  - 新线程首条消息 `@assistant`：自动回复，并显示 3 分钟等待 chip
  - 同一条消息 `@assistant @writer`：两者按提及顺序串行回复
  - 任一角色回复完成后，其等待倒计时刷新到 3 分钟
  - 3 分钟内的未 `@` 跟帖：所有仍在等待的角色再次依次回复
  - 用户点击某个 waiting chip 的 `停止等待`：后续未 `@` 跟帖不再触发该角色
  - 无效 `@somethingInvalid`：当普通文本，不阻止提交
  - 自定义 agent 被禁用/删除：对应 chip 显示 `未就绪`，线程仍可继续人工使用
  - 刷新页面后，仍能从 `agentBindings` 恢复等待中的角色和剩余时间
- 设置页
  - 新增 / 编辑 / 禁用 / 删除 custom agent 后，mention 列表即时反映
  - 内置 `@assistant` 不可删除
- 交付意图
  - starter 的初始选择仍生效
  - `document -> slides` 切换不丢文件、评论、版本
  - `slides -> web` 切换后结果面不空白；无 preview 时进入统一结果空态
  - `web -> document` 切回后继续沿用同一工作区和版本链
  - `code` 不出现在切换器
  - 切换不会自动改内容、不会自动改 stages
- UI 一致性
  - document / slides / web 切换时 header、sidebar、footer 与主壳不抖动
- 验收闭环
  - `npm run verify:iteration` 全通过
  - 新最佳实践和踩坑补进经验台账

## Assumptions / Defaults

- 你刚才的“3分支”按上下文解释为 `3 分钟` 监听窗口。
- 多角色默认不是群聊长期绑定，而是“每个角色各自维护 3 分钟窗口”；未 `@` 跟帖会再次触发所有仍在窗口内的角色。
- 回复顺序统一用串行，不做并发。
- v1 自定义 agent 仍是本地设备级配置，不做跨设备同步。
- `code` 的统一结果视图和弱类型化，留到下一轮单独讨论。
