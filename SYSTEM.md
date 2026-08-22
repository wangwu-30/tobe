# 成形系统模型

更新时间：2026-08-21
当前工作流：[Agent Room 与持久执行落地追踪器](./docs/agent-room-execution-workstream.md)（active）
来源计划：见 [refactor_plan.md](./refactor_plan.md)

## 当前身份与授权边界

- 当前 Web MVP 是 trusted local single-user product，没有 network identity provider。默认 platform context
  使用进程启动时冻结的 local organization/user/device tuple；相关 header 只是受信 Web runtime 传递的
  transport receipt，不是认证机制，不匹配该 tuple 时 fail closed。
- Room route 的显式 identity receipt 只可引用数据库中已存在且彼此匹配的
  organization/user/membership/device tuple；该解析能力不提供登录、认证、成员创建或邀请流程。
- team-mode schema、membership role 与 organization ACL 是已经实现的领域及授权契约，但不等于已经交付
  production multi-user identity。生产 identity provider、login/session/JWT integration、成员邀请与
  provisioning、企业 SSO 属于部署或未来范围。

## 核心对象

### 组织层

- **Organization** `{ id, slug, name }`
  team-mode 资源隔离边界。当前 Web MVP bootstrap 一个本地 organization；该记录本身不代表存在租户注册或
  production identity provider。
- **User** `{ id, name, email? }`
  ACL 所引用的人类主体记录。当前默认记录对应 trusted local user，不是登录账号或受 IdP 管理的身份。
- **OrganizationMembership** `{ id, organizationId, userId, role }`
  User 与 Organization 的授权关联；当前本地 bootstrap 创建 `owner` membership，受保护命令按 membership/role
  fail closed。模型支持 team-mode ACL，但不提供成员邀请或 provisioning。
- **Device** `{ id, organizationId, userId, label, type, lastSeenAt }`
  trusted local platform context 的设备绑定。Room 显式 identity receipt 必须与 organization/user/membership
  一并匹配已存在记录，Device 不是认证凭据。
- **Project** `{ id, name }`
  项目容器。统一工作空间 workstream 下，一个项目会收口为一个 workspace，可包含多个 Node/交付内容。
- **Folder** `{ id, projectId, parentId?, name, sortOrder }`
  项目内的分组节点。
- **ProjectMount** `{ id, sourceProjectId, targetProjectId }`
  Project 间的只读挂载声明。用于让当前 Project 的 AI 在默认上下文里看到外部 Project 的标题索引，并按需读取其 Node 内容。

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
  `kind` 承载 `milestone | head | recovery | pinned | aligned`。
  其中 `milestone / head` 是可见版本语义，`recovery / pinned` 是回退点生命周期语义。
  `aligned` 只对可见不可变版本生效，记录通过 membership ACL 的 trusted local principal 所确认的可执行事实；同一版本最多一个活动
  `aligned` 标签。Execution admission 必须拒绝未对齐、不可见或不属于当前组织/工作区的版本。
- **Draft** `{ deliverableId, baseStateId, files[], revision }`
  每个 `Deliverable` 唯一的可编辑区。

### 协作层

- **Thread** `{ id, deliverableId, stateId, anchor, status }`
  关于某个内容锚点的讨论。
- **Conversation** `{ id, deliverableId, parentId?, baseStateId? }`
  围绕当前交付物的开放 AI 对话。
- **Message** `{ id, parentType, parentId, role, content, agentId?, mentions?, model?, createdAt }`
  `Conversation` 或 `Thread` 下的消息。
- **TeamTask** `{ id, kind, status, priority, projectId?, workspaceId?, threadId?, createdByType, createdById, assigneeType?, assigneeId?, blockedReason?, dueAt?, completedAt? }`
  组织内中心化的执行或求助任务。`kind` 为 `execution | help`；`status` 为
  `open | claimed | in_progress | blocked | review | done | cancelled`。任务通过标量 ID
  关联项目、文档工作区和评论线程，所有读取与写入都必须受 `organizationId` 隔离。
  `priority` 使用 `0 | 1 | 2 | 3`，依次表示低、普通、高、紧急。
- **TaskActivity** `{ id, taskId, type, message, actorType, actorId, metadata, createdAt }`
  `TeamTask` 的追加式活动时间线。创建、分配、状态变化和人工/Agent 留言都形成活动记录。
- **RoomAgentSession** `{ id, roomId, agentId, agentConfigVersion, cursor, checkpointRef?, providerSessionRef? }`
  一个 Agent 在项目 Room 内的稳定会话身份。活跃时可保温，空闲时可冷却；第三方 provider
  session 只用于加速恢复，不能成为 Room 的事实源。
- **ExecutionJob** `{ id, teamTaskId?, agentId?, specVersion, spec, contextManifest, requirements, runtimeSelection, status }`
  可脱离浏览器继续的机器执行请求。它保存不可变目标和上下文快照，由开放 Runtime Registry
  按能力选择执行器；不能复用 `AssistantRun` 或 `TeamTask.status` 表达其运行状态。
- **ExecutionAttempt** `{ id, jobId, attemptNo, generation, runtimeId, lease, checkpoint?, workspaceLifecycleJson?, status }`
  `ExecutionJob` 的一次实际执行。claim、heartbeat、checkpoint 与 complete 都携带 generation，
  过期 worker 的写入必须被 fencing 拒绝。`workspaceLifecycleJson` 是仅供控制面和 daemon 使用的
  私有持久化 receipt，不进入普通 DTO/API 或 Runtime envelope；Git workspace attempt 以
  `absent -> binding+prepared -> runtimeCompletion -> finalized -> changeRequestId -> cleanedAt` 的固定
  可选后缀表达单调进度，已写阶段不可删除或改写。
- **ExecutionRuntime** `{ id, driverId, name, version, capabilities, location, capacity, health }`
  开放执行器注册项。生产 daemon 支持协议可控的 Generic CLI 与受信部署方提供的
  `external-module` V1 extension；两者都必须在启动时完整校验 descriptor/capability。OpenHands
  目前只是 disabled/offline catalog skeleton，在协议验证完成前不能成为可调度 deployment。
- **KnowledgeSpace** `{ id, scope, ownerAgentId?, repository, defaultBranch, policy }`
  Agent 独立知识库或团队共享 monorepo 的逻辑边界。Runtime 只能读取已绑定的快照，并在
  attempt 专属 isolated clone/workspace 和 proposal branch 中提出变更；不能直接写默认分支。
  `git-worktree` 是 capability/contract 名，当前 `LocalGitWorktreePort` 实现并不创建 Git registered
  worktree。
- **KnowledgeChangeRequest** `{ id, jobId, attemptId, spaceId, baseCommit, headCommit, status }`
  一次知识变更的人工审阅单。只有受信 merge 服务完成 expected base/head 校验并以 expected-old CAS
  合入后，状态才能
  进入 `merged`，随后才允许更新普通 Agent 可见的知识索引。
- **KnowledgeMergeOperation / KnowledgeSnapshot** `{ changeRequestId, expectedBase, mergedCommit?, snapshotId?, status }`
  人工批准后的受信合并与索引状态。独立 merge worker 校验 proposal/default ref 与 patch hash，
  通过 Git expected-old CAS 更新默认 ref；只有确定性索引构建完成并原子激活 `ready` snapshot 后，
  普通 Room context 才能检索新知识。

### 智能层

- **AgentProfile** `{ id, handle, name, description, skills[], enabled, builtin }`
  组织内可领取任务的 Agent 注册表。系统通过幂等注册确保内置 `@assistant` 存在，
  后续可追加其他组织级 Agent。
- **Persona** `{ id, handle, name, systemPromptLayer, scope }`
  Agent 的角色面具。
- **Action** `{ id, sourceType, sourceId, kind, status, input, output, resultStateId?, toolsUsed[] }`
  一次请求级或 Room turn 内的 Agent 行为与审计投影，不承担长跑恢复。
- **Policy** `{ toolName, safetyLevel, confirmationPolicy, writePolicy }`
  工具与 action 的执行约束。
  这是运行时对象，不是持久表。
- **RenderAdapter** `{ renderAs, fileContract, previewContract, anchorContract, diffContract }`
  `renderAs` 对应的渲染与交互适配器。
  这是运行时对象，不是持久表。

### 认知层

- **Note** `{ id, scope, scopeId, kind, title?, content, source, sourceRef?, active }`
  统一的可复用事实、偏好与经验沉淀。
  `scope` 包含 `user | project | deliverable`。
  `kind` 承载 `knowledge` 与其他可复用 note category（如 `preference / constraint / correction / domain_knowledge`）。
- **Method** `{ id, scope, scopeId, title, steps[], constraints[], toolHints[], status }`
  工作方法与约束。

### 计划层

- **Goal** `{ id, deliverableId, description, constraints?, methodId? }`
  当前交付物的目标定义。
- **Step** `{ id, goalId, title, sortOrder, completed }`
  `Goal` 下的可执行步骤。

## Agent 原语

成形的 Agent 行为共享一套通用 loop 原语，但分属三个独立生命周期：

- `CoordinatorRequestRun`：保留在 Next.js 请求内，负责入口、澄清、轻量工具和路由。
- `RoomAgentSession`：面向低延迟连续对话，稳定身份、单 session FIFO、可保温与冷恢复。
- `ExecutionJob`：面向分钟到小时级工作，拥有 queue、attempt、lease、checkpoint 和 sandbox。

Project Room 是面向用户的多 Agent 入口，但不是第四种生命周期：请求级协调器负责接待与路由，
多个 `(roomId, agentId)` 会话负责连续协作，需要离线或高隔离执行时再提交 `ExecutionJob`。架构按
`入口/Room -> Execution control plane -> Runtime adapter -> Knowledge review` 分层；跨层只传稳定 ID、
版本化 command/event/receipt 和不可变引用。Room、Execution、Knowledge 各自拥有状态机与 contract
tests，可独立实现、验证和替换 adapter，不能把某一第三方 Runtime 的类型反向泄漏到产品契约。

三个生命周期可复用以下原语，但不能共用一个状态机：

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
- Execution 只能从经 membership ACL 授权的 trusted local principal 显式对齐的可见不可变 `State` admission；服务端冻结内容、文件 hash
  和 revision，客户端、Room Agent 或 Runtime 都不能绕过 `aligned` 标签提交草稿或恢复点。
- `Draft` 是唯一可变的内容容器。
- `Label` 是唯一的分类机制，`State` 自身不承担分类字段。
- `Thread` 只存事实：
  `stateId + anchor + status`。
  分类在查询时推导。
- `Action` 只表达请求级或 Room turn 内的行为与审计投影；它可以记录确认结果，
  但不得承载长跑、租约、检查点或恢复状态。durable 执行事实只属于
  `ExecutionJob + ExecutionAttempt`。
- Agent loop 通过 `Context + ToolKit + Persona + Policy + RenderAdapter` 适配场景；
  loop 实现可复用不代表请求、Room session 与 Job 的所有权或恢复语义相同。
- `AssistantRun` 只记录请求/Room turn，不得承载 `ExecutionJob` 的 durable 状态。
- `TeamTask` 表达团队要做什么；`ExecutionJob` 表达机器如何执行。Job 成功默认进入 delivery/review，
  不直接把 TeamTask 标记为 `done`。
- Runtime 选择必须以 required capabilities、组织策略、用户/Agent 偏好和健康容量的交集为准；
  fallback 不得降低 sandbox、resume、workspace 等硬性要求。
- Runtime capability 必须反映已经接入的实际能力。基础 `GenericCliExecutionRuntimeDriverV1` 始终
  声明 `workspace=none`；只有显式组合 `LocalGitWorktreePort + lifecycle coordinator` 的 deployment
  wrapper 才能声明 `workspace=git-worktree`，并且缺少受信 workspace 时必须 fail closed。
- 生产 extension 只有 `generic-cli | external-module`。`external-module` 必须来自部署配置中的受信绝对
  本地路径，只收到 allowlist 环境，并在进程 ready 前完成 V1 factory、driver、descriptor 和 runtime ID
  校验；Job 或客户端不得选择任意模块路径。
- `waiting-for-human` 是 Execution 的 durable suspension protocol。Runtime 只有同时具备 native resume
  并实现 `resume({ humanInput })` 时才能声明该能力；回答作为带稳定 `responseId` 的不可变 receipt 由
  claim 注入原 attempt，禁止退化成 restart。持久化 waiting event 必须原子释放 lease/capacity 并返回
  `suspended`；daemon 随即停止 heartbeat 和旧 iterator，但不 interrupt、complete 或 cleanup。
- `waiting_input` 的取消仍走 durable `cancel_requested` 和 daemon maintenance claim，必须同时取消 pending
  input，最终一致地 terminalize Job/Attempt。capacity reservation 由 attempt 自己记录并以 CAS 精确释放，
  不能用 Runtime 的全局计数推断某个 attempt 是否占有 slot。
- Execution daemon 的 composition root 只能依赖 Node-safe 的精确模块入口；生产 bundle 不得包含
  React、Next.js client、`document` 或 `window`。构建成功不等于可运行，必须直接启动构建产物验证。
- Runtime adapter catalog identity 与可调度 deployment identity 分离；builtin catalog 条目不得覆盖
  daemon heartbeat，也不得与实际 deployment 的 organization-local key 冲突。
- 常驻的是 `RoomAgentSession` 身份，不是无限 prompt。Room/文档/已合并知识是权威事实，
  摘要和 provider cache 可淘汰；Job 使用不可变 `ContextManifest`。
- `ContextManifest` 只能由 Execution 控制面根据 `workspace/version/conversation` 来源引用生成；
  浏览器、协调 Agent 和 Runtime 不能直接写入快照内容、组织 Runtime policy 或 Room watermark。
  `knowledgeCommit` 要么为 `null`，要么是 admission 时冻结的非敏感 `FrozenKnowledgeBinding`，包含
  `schemaVersion / bindingId / spaceId / workspaceId / agentId / mountPath / defaultBranch / baseCommit`；
  其中 `baseCommit` 是已解析的不可变 SHA，`repoPath` 与 credential
  不得进入 manifest 或 Runtime。若硬要求 `git-worktree` 却没有唯一合法 binding，admission 必须拒绝。
- 知识变更必须来自当前 Job workspace 上受信的 `KnowledgeBinding`；只有 `access=propose`
  的 binding 可生成变更单，且仅同组织并不足以授权 attempt 向任意 `KnowledgeSpace` 提案。
  daemon claim 后只能按 frozen `bindingId` 重验权限并私下取得 repo 信息，不得重新自由选择 binding
  或重新解析 default branch；`prepare` 始终使用 frozen `baseCommit`。
- Git workspace 的 durable receipt 固定包含 `schemaVersion: 1 / kind: 'git-worktree' / binding / prepared`，
  后面只能依次追加 `runtimeCompletion? / finalized? / changeRequestId? / cleanedAt?`。每次新增阶段都
  必须在同一组织下校验 attempt 仍为 `running`、
  `generation + leaseOwnerId` 匹配且 lease 未过期；相同内容 replay 成功，同阶段不同内容 conflict。
- `prepareOrRecover`、`finalizeOrRecover` 与 `cleanupOrRecover` 必须支持 exact replay：当前实现使用
  attempt 专属 isolated clone/workspace 和 deterministic proposal branch，而不是 Git registered worktree。
  仅当受管路径、receipt marker、branch/base、attempt identity 及预期 commit/trailer 全部一致时恢复；
  部分匹配或漂移一律 fail closed，不能用 force 接管未知状态。预期路径已不存在可视为 cleanup replay 成功。
  `prepareOrRecover` 遇到 matching 但 dirty 的 workspace 也必须 fail closed；系统不承诺恢复来源不明的
  未提交修改，不能把 clean prepared-state reclaim 的能力外推为 dirty-workspace crash recovery。
- Runtime `attempt-completed` terminal event 与 `workspaceLifecycleJson.runtimeCompletion` 必须在一个
  fenced 事务中落库。
  daemon heartbeat 必须从 prepare 前持续覆盖 Runtime、finalize、变更单 upsert、cleanup 和最终
  complete；attempt 未完成前不能停止续租，也不能先 complete 再做进程内 cleanup。reclaim 按 receipt
  的首个缺失阶段继续：已有 durable `runtimeCompletion` 时不得重启 non-resumable Runtime；成功结果
  继续 finalize/ChangeRequest/cleanup，失败或取消结果直接继续 cleanup，已有 `cleanedAt` 时只 complete。
- running cancel 已实现为 recoverable desired state：请求只把 Job 写为 `cancel_requested`，保留当前
  running attempt 的 generation、lease 和已占 capacity；daemon 由 heartbeat 观察取消，interrupt Runtime，
  原子写入 `attempt-completed/interrupted + runtimeCompletion(cancelled)`，完成 cleanup 后才
  `complete(cancelled)`、清 lease 并释放一次 capacity。只有 lease 过期后的 reclaim 才递增 generation，
  并沿用原有 capacity reservation，由新 owner 完成同一收尾流程。
- `confirmationPolicy=required` 必须在共享 policy wrapper fail closed；自然语言、模型参数或 tool call ID
  都不能充当授权。当前 `start_execution_job` 使用专用 durable Room confirmation：冻结 actor、Room session、
  delivery、workspace 和 canonical parameter hash，由满足 owner-role ACL 的 trusted local principal 以 revision CAS
  批准后 exactly-once 创建 Job
  并记录 receipt。该专用审批命令不是任意 governed tool 的通用 grant consumer。
- `TeamTask.status` 是跨参与者协调所需的持久工作流事实，不属于文档 `status` 推导规则；
  每次合法流转都必须写入 `TaskActivity`。
- `TeamTask`、`TaskActivity` 与 `AgentProfile` 必须按组织隔离；客户端传入的组织标识不能覆盖
  请求头解析出的 platform context。
- 本地持久化使用 SQLite WAL：bootstrap 必须确认 `journal_mode=wal`，应用进程统一经
  `SafePrismaLibSqlAdapterV1` 使用 `busy_timeout`、连接级串行化与终态 transaction cleanup。
  `SQLITE_BUSY` 只能在输入不变、可幂等重放的完整 durable command 边界做有限重试；这不是多节点
  数据库能力，也不允许把任意事务片段静默重跑。
- 请求级 Agent 入口统一到 `/api/agent/run`；Room 消息和 Execution Job 使用各自版本化 command/receipt，
  accepted 后的工作不再依赖原 HTTP 连接。
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

## 团队任务流转

- `open -> claimed | in_progress | cancelled`
- `claimed -> open | in_progress | blocked | cancelled`
- `in_progress -> blocked | review | done | cancelled`
- `blocked -> claimed | in_progress | cancelled`
- `review -> in_progress | done | cancelled`
- `done` 与 `cancelled` 为终态。
- `claimed` 与 `in_progress` 必须有负责人；`blocked` 必须包含 `blockedReason`；进入
  `done` 时写入 `completedAt`。
- `publish_team_task` 的策略为 `safe + automatic + organization-scoped-append`：Agent
  可在受阻时追加组织内任务，但不能借此修改或删除既有任务，也不能伪造其他组织身份。

## 当前产品边界

当前 active tracker 是 [Agent Room 与持久执行落地追踪器](./docs/agent-room-execution-workstream.md)。
主链路是 `Project Room -> durable Execution -> knowledge review/CAS merge -> ready snapshot`，代码与生产
组合点已经覆盖以下边界：

- Web-only 产品；Project Room 是工作区默认 Agent 入口，持久消息、atomic multi-Agent routing、HTTP/SSE、
  独立 Room Session Host、Pi adapter、delegation grant、durable tool confirmation 与 Room UI 已组合。
- Room context 以显式预算限制 message/summary/document/retrieval block，并保留 ACL decision、provenance、
  trust 与 truncation trace；生产 context source 在每次组装时重验 session lease、Agent、文档和 ready
  knowledge binding。当前 host 通过 compatibility bridge 把 rich blocks 送入 Runtime，不能据此声称
  Runtime wire contract 已原生承载全部 metadata。
- Execution 产品面包含 events/logs/artifacts、waiting-input/resume、HTTP cancel、Room/Task 投影与 durable
  quarantine/recovery UI。running HTTP cancel 由 standalone daemon 消费；unknown dirty/partial workspace
  仍 fail closed，只有验证为安全的状态才能 discard，不承诺恢复未提交修改。
- Git capability 使用 attempt 专属 isolated workspace/proposal ref、private monotonic receipt 与 fenced recovery。
  cleanup 的 before-cleanup、after-cleanup、after-`cleanedAt` persistence 三个 crash window 均有进程级
  reclaim 路径；已有 durable completion 时不得重跑 non-resumable Runtime。
- 人工 review 后由独立 knowledge merge worker 重验 proposal/default ref 和 patch hash，以 Git expected-old
  CAS 更新默认分支，持久化 merge operation，构建确定性索引并只激活 `ready` snapshot。Agent、Runtime、
  execution daemon 与普通 Web route 都没有 trusted merge authority。
- 生产 Runtime extension 是 Generic CLI 和受信 `external-module`；OpenHands 维持 disabled/offline 且
  capacity 为零。三个独立 Node 服务是 execution daemon、Room Session Host 和 knowledge merge worker。
- 本地数据库 bootstrap 强制并校验 WAL；Web、Host 与 worker 共用 safe Prisma/libSQL adapter，明确处理
  本地 transaction cleanup 和已识别的 busy contention，但不把单机 SQLite 描述为多节点调度存储。

明确不属于当前能力：区块链/钱包/代币；Postgres/Redis/多地域调度；语音视频；production identity
provider、login/session/JWT integration、成员邀请与 provisioning、完整企业 SSO；
未经验证的 DSH/OpenHands/LangGraph 协议 adapter；远程 Git credential/fetch/push；monorepo 子目录 mount；
以及对来源不明 dirty workspace 的自动恢复。

代码存在、production composition、targeted test 与完整 iteration gate 是四种不同证据。完整门禁由
`npm run verify:iteration` 依次执行 static、control-plane inventory/suites、database bootstrap、production Web
build、browser preflight 和 browser E2E；某次运行的结论只写入 tracker 的 dated verification record。
