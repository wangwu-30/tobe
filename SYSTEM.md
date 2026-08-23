# 成形系统模型

更新时间：2026-08-23
当前产品工作流：[一人 AI Wiki](./docs/briefs/one-person-ai-wiki.md)（active）
高级运行时记录：[Agent Room 与持久执行落地追踪器](./docs/agent-room-execution-workstream.md)

## 产品拓扑

成形当前是 **Web-only 的一人团队 AI Wiki**，不是 SaaS 多人协作系统。受支持的产品拓扑固定为：

```text
singleton Organization
├── exactly one human owner
├── zero or more AgentProfile (AI collaborators)
└── zero or more Wiki Space
    ├── one canonical root / home Page
    └── zero or more child Page
```

- `Organization` 是本地资源与授权边界，在当前产品里是 singleton，不是用户可创建或切换的租户。
- 唯一的人类 `User` 通过一条 `owner` membership 取得最终决定权。系统可以有多个 AI
  `AgentProfile`，但 Agent 不是额外的人类成员。
- 一个 owner 可以维护多个 Wiki Spaces。每个 Wiki Space 可以有多个 Pages。
- team-mode schema、role 与 ACL 是内部隔离和未来兼容契约，不构成 multi-user、登录、邀请、
  provisioning 或企业 SSO 的交付声明。

## 用户对象与持久化映射

用户可见语言与历史内部命名之间采用 facade，而不是复制一套数据：

| 用户对象 | 权威含义 | 当前持久化映射 |
| --- | --- | --- |
| **Wiki Space** | 一组围绕同一长期主题、目标或知识域生长的 Pages | canonical Project root facade；由同组织、未删除且满足 canonical root 约束的根 `Document` 承载 |
| **Page** | Wiki Space 内可编辑、可评审、可版本化的内容单元 | `Document` facade；根/首页与子 Page 都复用 Document、文件、草稿和版本能力 |
| **Chat** | owner 与助手默认使用的连续会话 | `Session + ChatMessage`；创建 Wiki Space 前后可以是同一个 Session |
| **Folder** | Wiki Space 内只用于组织 Pages 的目录 | `ProjectFolder` compatibility model |
| **Linked Wiki Space** | 当前 Wiki Space 对另一 Wiki Space 的只读上下文引用 | `ProjectMount` compatibility model |
| **Room** | 多 Agent 的高级协作面 | `Room + RoomAgentSession`，不替代默认 Chat |
| **Git Knowledge** | 供 Agent/Runtime 使用的受审 Git 知识仓库 | `KnowledgeSpace`、binding、change request、merge operation 与 ready snapshot |

`Project`、`Deliverable`、`Content`、`Node`、`wikiId`、`projectId` 等名称仍可能出现在 schema、API、
兼容路由和历史验证记录里。它们不是新增的用户概念：

- `Project` 在新产品语言中只表示 Wiki Space 的内部 canonical root 语义。
- `Document` 的用户 facade 是 Page。
- `Deliverable` 是 superseded 的历史产品术语，不得回流到新可见文案或新公共契约。
- `Node` 只在图结构、迁移名或内部树实现需要时使用，不与 Page 并列成为用户主对象。
- Git `KnowledgeSpace` **不是** Wiki Space。两者不能共用名称、创建入口或写入权限。

## 首页与 Session 接管

首页的默认动作是 Chat，不是创建容器：

1. owner 在首页向助手发消息，系统创建或继续一个未绑定 Wiki Space 的 `Session`。
2. 普通问答、澄清、研究或草拟不会隐式创建空 Wiki Space，也不会为了展示 loading/preview
   先写入占位根 Page。
3. 当对话产生值得长期保存的结果时，AI 可以建议创建 Wiki Space；建议不是授权。
4. 只有 owner 的显式确认才能执行创建命令。创建必须幂等地落下 canonical Project root，并把
   **同一个 Session** 绑定给该 Wiki Space；不得复制消息、另起隐藏 Session 或丢失原对话顺序。
5. 创建后继续落在 Chat 和当前 Page。Room、Agents、Team Tasks、Jobs 与 Git Knowledge 只从
   `Advanced` 导航进入。

如果确认失败或结果未知，重试必须检查同一 idempotency request，不得制造重复 Wiki Spaces。取消提案则保留
原 Session，且不留下空 Wiki Space。

## 核心持久对象

### 身份与授权层

- **Organization** `{ id, slug, name }`
  singleton 本地资源边界。不得把它包装成 workspace switcher 或 tenant signup。
- **User** `{ id, name, email? }`
  唯一 human owner 的本地主体记录，不是登录账号或 IdP identity。
- **OrganizationMembership** `{ organizationId, userId, role }`
  当前支持拓扑中只有 owner membership。内部命令仍按 membership/role fail closed。
- **Device** `{ organizationId, userId, ... }`
  trusted local platform tuple 的一部分，不是认证凭据。
- **AgentProfile** `{ id, handle, name, description, skills[], enabled, builtin }`
  singleton Organization 内的 AI 协作者注册表；允许多个，不能被描述为 human member。

### Wiki 内容层

- **WikiSpace facade / canonical Project root**
  Wiki Space 的稳定身份、标题、Page tree 边界、Chat scope 和 mount scope。根必须与普通 Page 一样受
  organization、deleted-state 与 canonical-root 校验保护。
- **Page facade / Document** `{ id, projectId, parentDocumentId?, title, draftRevision, ... }`
  Wiki Space 内的内容单元。`projectId` 指向 canonical root；`parentDocumentId + treeSortOrder` 表达 Page tree。
- **ProjectFolder** `{ projectId, parentId?, title, treeSortOrder }`
  兼容目录结构，不拥有 Page 的版本或评审生命周期。
- **ProjectMount** `{ sourceProjectId, targetProjectId }`
  Wiki Space 间的显式只读引用。AI 默认只看到标题索引，按预算和权限按需读取目标 Pages。
- **WorkspaceFile** `{ documentId, parentId?, path, kind, purpose, content, revision }`
  Page 的实现文件或支持资料。`purpose` 区分 output 与 reference。
- **Version / State**
  Page 的不可变内容快照。创建后不可修改。
- **Label** `{ stateId, kind, name }`
  指向不可变版本的命名指针；`milestone | head | recovery | pinned | aligned` 承担可见版本、回退点和
  execution admission 语义。
- **Draft** `{ documentId, baseVersionId, files[], revision }`
  每个 Page 唯一的可编辑区。

### 会话与评审层

- **Session** `{ id, scopeKind, projectId?, wikiId?, ... }`
  Chat 的稳定连续会话。首页到 Wiki Space 的确认流程接管原 Session，而不是生成内容副本。
- **ChatMessage** `{ sessionId, focusNodeId?, role, content, ... }`
  消息可记录发送时聚焦的 Page，但焦点变化不改变 Session 身份。
- **Thread** `{ documentId, versionId?, anchor, status }`
  关于 Page 内容锚点的局部评审。
- **StagedChangeSet / Suggested changes**
  AI 准备的 Page 建议修改；包含 base/draft revision 和内容 hash，本身不修改 live draft。
- **Note / WorkflowPlaybook**
  分别承载可追溯事实、偏好、约束与可复用方法。用户可见的 Page/Space context 不等于 Git
  `KnowledgeSpace`。

### 高级协作与执行层

- **RoomAgentSession** `{ roomId, agentId, agentConfigVersion, cursor, checkpointRef?, ... }`
  一个 Agent 在高级 Room 内的稳定低延迟会话身份；第三方 provider session 不是事实源。
- **TeamTask** `{ kind, status, priority, projectId?, workspaceId?, ... }`
  owner 与 Agents 的高级协调队列。Job 成功只推进到 review，不能直接标记 done。
- **ExecutionJob** `{ specVersion, spec, contextManifest, requirements, runtimeSelection, status }`
  可脱离浏览器继续的 durable 执行请求，拥有独立 queue/admission 生命周期。
- **ExecutionAttempt** `{ jobId, generation, lease, checkpoint?, workspaceLifecycleJson?, status }`
  一次实际执行。claim、heartbeat、checkpoint 和 complete 都必须带 generation，过期 worker 写入被
  fencing 拒绝。
- **ExecutionRuntime** `{ driverId, version, capabilities, location, capacity, health }`
  开放 Runtime 注册项。生产扩展点只有 `generic-cli` 和受信 `external-module`。
- **KnowledgeSpace** `{ repository, defaultBranch, policy, ... }`
  高级 Git Knowledge 边界。Runtime 只能读取冻结 binding/snapshot，并在 attempt 专属 isolated
  clone/workspace 和 proposal branch 中提出变更。
- **KnowledgeChangeRequest / KnowledgeMergeOperation / KnowledgeSnapshot**
  Git Knowledge 的人工评审、trusted expected-old CAS merge 与确定性索引状态。只有原子激活的
  `ready` snapshot 可进入普通检索。

## Agent 生命周期

系统保留三个独立生命周期：

- `CoordinatorRequestRun`：默认 Chat 的请求内澄清、轻量工具和路由。
- `RoomAgentSession`：Advanced Room 中的低延迟连续多 Agent 协作。
- `ExecutionJob`：Advanced Jobs 中分钟到小时级、可恢复和隔离的 durable 工作。

三者可以共享 `Context + ToolKit + Persona + Policy + RenderAdapter` 原语，但不能共享状态机、lease、
capacity 或恢复语义。Chat 是产品默认入口；Room 不是第四种生命周期，也不再是默认导航入口。Room 需要
高隔离或离线工作时才提交 Execution Job。

## 核心不变量

### 产品与身份

- 当前支持拓扑始终是一个 singleton Organization、一个 human owner、多个 AI Agents、多个 Wiki Spaces。
- 不得用 schema 可表达多个 membership 反向宣称产品支持 multi-user。
- 首页 Chat 不创建空 Wiki Space；创建必须由 owner 显式确认，并接管同一 Session。
- Wiki Space 与 Page 是唯一主路径内容术语。内部兼容 key 可以保留，value 和新公共文案必须使用新术语。
- Chat 是默认能力；Room、Agents、Team Tasks、Jobs、Git Knowledge 必须保持高级能力的视觉与信息架构层级。

### 内容写入与评审

- AI 准备 **Suggested changes**，human owner **applies**。AI、Room Agent、Runtime 不得直接把建议修改写入 live Page draft。
- human apply 对文件变更、Page revision、recovery checkpoint 和 suggested-change transition 使用单事务 CAS；
  authorization/revision drift 或 late failure 不得留下部分效果。
- `Version/State` 一旦创建不可修改；`Draft` 是唯一可变内容容器；`Label` 是版本分类机制。
- 当前 draft comment 只对 exact revision 取得 source mutation authority。inherited comment 只是 review context。
- Execution admission 只能接受由 owner 显式 `aligned` 的可见不可变 Page 版本；prompt、Room 消息、
  草稿或 recovery point 不能替代该事实。

### Runtime 与 Git Knowledge

- `Action`/`AssistantRun` 只表达请求或 Room turn，不承担 durable Job 状态。
- `TeamTask` 表达要做什么，`ExecutionJob` 表达机器如何执行；二者不能共用状态。
- Runtime selection 必须满足 required capabilities、策略、偏好、健康与容量的交集；fallback 不得降低硬要求。
- 基础 Generic CLI 始终声明 `workspace=none`。只有显式组合 Git lifecycle 的 deployment wrapper 才能
  声明 `workspace=git-worktree`。当前实现是 isolated clone/workspace，不是 registered Git worktree。
- `external-module` 只从部署配置中的受信绝对本地路径加载，只接收 allowlist 环境。
- OpenHands 在协议验证完成前保持 disabled、offline、capacity-zero 并 fail closed。
- Git Knowledge 只有 read + propose 权限。Agent、Runtime、execution daemon 和普通 Web route 无权批准、
  更新 default ref 或激活索引。
- trusted merge worker 必须重验 proposal/default ref 与 patch hash，再以 expected-old CAS 更新默认 ref。
- dirty/partial/drifted attempt workspace 进入 quarantine；不得猜测性接管或 force 覆盖未知状态。
- `waiting-for-human` 是 durable suspension protocol，不得退化成重启 non-resumable Runtime。

### Context、授权与持久化

- Room/Page/Git Knowledge context 必须有显式预算、稳定排序、ACL recheck、provenance、trust 和 truncation
  记录；summary/cache 不是事实源。
- trusted local identity tuple 在进程启动时冻结。header 是 transport receipt，不是登录或认证。
- `TeamTask`、Agent、Room、Execution 和 Knowledge 数据都按 singleton Organization 隔离；客户端不能覆盖
  server-resolved context。
- 本地 SQLite bootstrap 必须强制并确认 WAL。Prisma 统一经 safe libSQL adapter 使用 busy timeout、
  串行化访问和 terminal transaction cleanup。
- `SQLITE_BUSY` 只允许在输入不变、可幂等重放的完整 durable command 边界做有限重试。
- 推导状态不持久化：一般 UI status、thread classification、agent watching、plan progress 在查询时推导；
  `TeamTask.status` 与 Execution 状态是跨进程协调事实，必须持久化。

## 当前产品边界

当前产品契约是 `Home Chat -> explicit create confirmation -> same Session in Wiki Space -> Page review/apply`。
普通流程不暴露 Room orchestration、Execution Job/runtime selector、recovery console 或 Git merge 控制台。高级链路
`Room -> durable Execution -> Git Knowledge review/CAS merge -> ready snapshot` 只能从 Advanced 进入，不得覆盖主路径。

明确不属于当前能力：

- production multi-user identity、第二个人类成员、登录/session/JWT、邀请/provisioning、企业 SSO；
- desktop/Electron runtime；
- Postgres/Redis/多地域调度、语音视频、区块链/钱包/代币；
- 未验证的 OpenHands/DSH/LangGraph production adapter；
- 远程 Git credential/fetch/push、monorepo subpath mount；
- 对来源不明 dirty workspace 的自动恢复。

tldraw watermark 必须保留。生产发布需要兼容许可证或明确接受适用条款，禁止通过 CSS、DOM 或测试分支
隐藏。

代码存在、production composition、targeted test 与完整 iteration gate 是四类不同证据。完整门禁由
`npm run verify:iteration` 执行；历史 gate 数字只证明当时记录的精确 tree，不证明当前 Wiki-first workstream。
