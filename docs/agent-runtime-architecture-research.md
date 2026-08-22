# Tobe Agent Runtime 与协作架构方案

> 架构决议与框架调研基线：2026-08-20 至 2026-08-21。
> 文档角色：本文件保留架构决策、固定版本框架比较和设计推演，不承担实时实施追踪。
> 当前实现状态以 [`SYSTEM.md`](../SYSTEM.md) 与当前 active tracker
> [`agent-room-execution-workstream.md`](./agent-room-execution-workstream.md) 为准；
> 本文的实现摘要只用于纠正已经明确过期的历史描述。
> 目标：把 Tobe 产品化为“团队文档事实源 + 多 Agent 房间协作 + 独立长任务执行 + Git 知识审阅”的中心化 Web 产品。
> 结论先行：产品体验采用“常驻会话 + 独立任务”；技术实现保留请求级协调器，因此是三个彼此独立的生命周期。
> MVP 边界：Room、trusted merge/index、Execution 产品面和关键恢复能力属于单机/单组织 Web MVP；
> 候选 Runtime、多节点基础设施和媒体协作属于明确 non-goal，不混入 MVP 完成定义。
> 身份边界：team-mode schema、membership role 与 organization ACL 已实现，但当前 actor 是 trusted local
> single-user principal；production IdP、登录/session/JWT integration、成员邀请/provisioning 与企业 SSO
> 属于部署或未来范围。

## 1. 结论摘要

推荐的最终形态不是选择一个“万能 Agent 框架”，而是让 Tobe 自己拥有产品事实和稳定契约，在契约后面替换运行时：

```text
产品入口：Project Room，而不是 Agent 列表

trusted local user（team-mode ACL subject）
       |
       v
Next.js Web + 请求级协调 Agent（现有 Pi，保留）
       |
       +-- 房间消息 --> 常驻/可恢复 Room Agent Session
       |                  +-- Pi room adapter（首期）
       |                  +-- DeepSeek Harness adapter（实验）
       |
       +-- 开始工作 --> 独立 Execution Job
                          +-- Tobe 自有 JobStore / lease / attempt
                          +-- Runtime Daemon + optional Git-workspace lifecycle wrapper
                          +-- Generic CLI / 受信 external-module adapter
                          +-- OpenHands / LangGraph 等候选 adapter（非默认生产路径）
```

核心决策：

1. **Next.js 请求内的 Pi 不迁走。** 它继续是项目入口与协调 Agent，负责接住用户、澄清、路由、轻量工具和即时流式响应。
2. **专业 Agent 的群聊采用稳定 session identity。** session 在活跃时保温，闲置后可销毁进程内对象，但能够从 Tobe 的持久记录冷恢复；“常驻”不等于把无限聊天记录永远塞在 prompt 中。
3. **分钟到小时级工作一律升级为独立 Job。** Job 不依赖浏览器或 HTTP 请求，具有 queue、attempt、lease、heartbeat、checkpoint、fencing、artifact 和人工 review。
4. **Tobe 是 Room、文档、任务、权限和投递事实源。** 已实现或候选的 Pi、DeepSeek Harness、OpenHands、LangGraph 等运行时都只能位于 adapter 边界后，不能成为产品数据库。
5. **上下文是独立子系统。** 房间事件、文档版本、已合并 Git 知识是权威来源；session checkpoint、摘要和向量索引只是可重建缓存。长任务拿不可变 `ContextManifest`，不拿“当前所有历史”。
6. **Git 知识只允许提案，不允许 Agent 直接合入主分支。** 需要 `git-worktree` capability 的 Job/attempt
   只能由显式组合 lifecycle coordinator 的 deployment 在 attempt 专属 isolated clone/workspace 和 proposal
   branch 中执行，产出 diff；当前实现不是 Git registered worktree。人工 review/merge 后才更新可检索
   知识索引，基础 Generic CLI 不隐式获得仓库能力。
7. **Multica 只作为设计参考。** 其 durable daemon/worktree/claim 模型很有价值，但许可证限制第三方托管和商业嵌入；采用 clean-room 的窄执行协议，不复制源码或协议。
8. **DeepSeek Harness 最适合试验 Room Session Engine，不适合充当 durable Job authority。** 它必须被隔离在 `RoomSessionRuntimePort` 后并锁定版本。
9. **执行层采用开放 Runtime 注册与选择。** 借鉴 Multica 的开放方式，由 Tobe 定义 capability-aware 的 Runtime 协议，支持自动匹配、用户显式选择、Agent 默认偏好和组织策略；Generic CLI 与部署方选择的 external module 已构成生产配置边界。OpenHands 只是 repo/code 候选，目前仅有 fail-closed skeleton，不是默认 Runtime，也不是首个生产 adapter。
10. **不引入区块链、钱包、代币和 IPFS。** 原 `agent-market` 的供需能力转化为中心化的 Agent Profile、TeamTask、ExecutionJob 与审阅流程。

### 1.1 截至本次同步的实现摘要（非权威实时状态）

截至本次文档同步，代码中的实现边界已经包括：

- **Project Room 闭环：** Room、Message、typed Mention、稳定 Session、Inbox、Event、Outbox、Grant 与
  summary cache 已持久化；独立 Room Session Host 已组合 Prisma store、Pi adapter 与 Room tools；HTTP command、
  replay/SSE 和 workspace 内的 Room feed/composer/confirmation UI 已接通。
- **有界上下文：** Room Host 已使用分类型预算、cursor delta、reply chain、文档切片、ready knowledge
  检索和带 source/config/ACL hash 的 summary cache；trace 会记录纳入与排除的 context block，不再默认注入
  无限历史。
- **Execution adapter 边界：** Generic CLI 是内建基准 driver；daemon 也能从部署方配置的绝对路径加载
  contract-versioned `external-module` driver，只向其传递 allowlisted environment。基础 Generic CLI 仍诚实
  声明 `workspace=none`，只有显式 Git lifecycle wrapper 可以发布 `git-worktree` capability。OpenHands 目前是不可执行的
  fail-closed skeleton：即使给出 endpoint/token，也因没有已验证的 HTTP contract 而不发送请求、不注册成
  健康执行路径。
- **安全 admission 与确认：** Execution 只接受当前组织/工作区内可见、不可变且 aligned 的文档版本；
  未对齐、跨 workspace、已删除或不可见版本均 fail closed。`confirmationPolicy=required` 已落为持久
  confirmation request，绑定 actor、Room/session/delivery、tool call、canonical parameters hash、有效期和 revision；
  owner 决策与一次性 capability 消费完成后才可创建 Job，UI 提供 approve/reject。
- **Git knowledge 闭环：** frozen binding/base、attempt 专属 isolated clone/workspace、proposal branch 与
  ChangeRequest、人工 review、
  durable merge operation、独立 trusted worker 的 proposal/default-ref 校验与三参数 `git update-ref` CAS、
  index build 和 ready `KnowledgeSnapshot` 已接通；普通 Agent 只消费 ready snapshot。
- **取消与恢复：** 真实 HTTP cancel 已与 standalone daemon 跑通 `cancel_requested -> interrupt -> cleanup ->
  complete`。changed-success 路径已经覆盖 `before-workspace-cleanup`、`after-workspace-cleanup`、
  `after-cleaned-lifecycle-persist` 三个 crash stage 的 lease-expiry/reclaim。无法安全 exact replay 的 dirty/partial
  workspace 会进入持久 `ExecutionRecoveryIncident` quarantine，停止无限 reclaim；operator 可在 UI/API inspect，
  并按分类与 revision CAS 选择 retry 或仅在可证明安全时 discard。
- **本地 SQLite 并发边界：** bootstrap 强制并校验 WAL；Web 与三个独立 Node 服务统一使用 safe
  Prisma/libSQL adapter。它设置 busy timeout、串行化单连接访问并在 terminal transaction path 清理 native
  transaction；已识别的 `SQLITE_BUSY` 仅在输入不变、可幂等重放的完整 durable command 边界有限重试。

上述“已实现”描述代码与已存在的专项/进程/浏览器测试覆盖面，不等于宣称当前工作树已经通过完整
`npm run verify:iteration`。历史上曾记录一次 `30 passed / 69 environment-blocked`，其 69 条浏览器用例因
宿主缺少 `libgbm.so.1` 而未进入产品断言；这是旧基线的环境诊断，不是当前门禁结果。本轮完整结果
由本轮最终 gate 补录到 active tracker，本文不提前记为全绿。

### 1.2 MVP 完成定义与边界

MVP 必须闭合一条可由真实用户操作、进程崩溃后仍可解释的主链路：

```text
创建团队 Project/Workspace + 默认 Room
  -> 人在同一 Room 直接 @ 一个或多个 Agent
  -> Room Host 按 session FIFO、跨 session 并行地执行 Pi turn
  -> 有界且可追溯的 Room/文档/知识上下文
  -> 人或经一次性授权的 Agent 创建 durable Job
  -> Job 事件、日志、artifact、waiting-input 和终态回到 Web/Room
  -> Git attempt 产生 knowledge proposal
  -> 人工 review 并 enqueue trusted merge
  -> 受信进程对 default ref 做 expected-old CAS
  -> 构建 ready knowledge snapshot/index
  -> 后续 Agent 只消费 ready snapshot
```

完成定义按稳定边界拆分：

| 模块 | MVP 必须提供的事实与接口 | 必须有的产品/恢复证据 |
|---|---|---|
| Project Room | Room/Message/Mention/Session/Inbox/Event/Outbox/Grant 持久模型；版本化 command/receipt；HTTP + 可重放 SSE | 默认 Room、多 Agent typed mention、quiet host、同 session FIFO、跨 session 并行、断线重放 |
| Room Runtime | 独立 Session Host、lease/generation fencing、Pi adapter、fresh replay、bounded context trace | 双 Host 竞争、kill/restart、重复 wakeup、provider 失败、Node-only bundle |
| Execution | Job/Attempt、waiting-input/input-resume、事件/artifact/log read model、Job 页面、Room outbox | HTTP running cancel + daemon、cleanup crash windows、终态/Task review/Room 回流 |
| Knowledge | 人工 review API/UI、durable merge operation、trusted local Git CAS、index build、ready snapshot | 同 base 并发只能一条 merge；Git 后 DB 前 exact replay；index 失败不泄漏半成品 |
| Recovery | clean receipt exact replay；dirty/partial unknown 状态建立 durable `ExecutionRecoveryIncident`，Attempt 进入 `quarantined`、Job 进入 `blocked`，停止无限 reclaim | 不覆盖或误提交 dirty tree；提供 inspect/retry/安全 discard 的受信操作面 |
| Delivery | 示例配置、独立进程启动脚本、全量测试 inventory、浏览器依赖 preflight | static/control-plane/process/production browser gates 都有明确通过或环境失败结论 |

明确 non-goal（不是遗留待办）：

- 区块链、钱包、代币、托管、竞价、RPC、签名与 IPFS。
- Postgres/Redis、多地域/多节点公平调度、容器或 VM 多租户隔离；MVP 是 WAL 模式的本地 SQLite、
  safe Prisma/libSQL adapter 与单部署进程拓扑，但状态机和协议不得阻碍后续替换。
- DSH、OpenHands、LangGraph、AG2/AgentScope 的生产 adapter；MVP 交付 Pi Room adapter、Generic CLI
  Execution 基准和开放注册契约，其他项目只保留经过验证后接入的扩展位。
- 语音、视频、实时多人光标；production identity provider、登录/session/JWT integration、成员邀请/
  provisioning 与完整企业 SSO。
- 自动恢复来源不明的未提交 dirty workspace。MVP 的完整行为是 fail closed、durable quarantine、人工处置，
  而不是猜测性提交或覆盖。
- 远程 Git credential/fetch/push 和 monorepo 子目录 mount。MVP 对本机受信 Git repo 提供 agent-owned
  与 team-shared root binding；`mountPath` 固定为 `/`。

上述 non-goal 不能在 README 或验收记录中被描述为已支持；MVP 也不依赖这些能力走通主链路。

## 2. 产品入口与协作方式

### 2.1 入口是项目房间

用户从空白开始时，不先挑 Agent，也不先创建任务。首页只需要一个目标输入：

1. 用户描述想做什么。
2. 系统创建 Project/Workspace、默认文档和 Project Room。
3. 请求级协调 Agent 立即接住第一轮，帮助澄清并形成初始方案或文档提案。
4. 用户进入同一工作区，左/中区域是文档，右侧是团队 Room；任务与执行状态作为文档和对话的关联对象。

这保证“从空白和 AI 一起讨论”不需要理解 Agent 编排。协调 Agent 是默认接待者，不是唯一可以交流的 Agent。

### 2.2 同一个房间可以同时和多个 Agent 聊

Room 中人和 Agent 都是一等参与者：

这里的 team-mode participant/ACL 是领域模型；当前 Web MVP 的人类参与者仍是 trusted local single-user
principal，不提供生产登录或成员邀请。下文“Agent 邀请 Agent”专指受策略约束的 Agent delegation，不是
邀请新的组织成员。

- 用户可在同一条消息中 `@研究员 @架构师`；服务端把 mention 解析为稳定的 `AgentId[]`，并分别投递。
- 多个 Agent 可以并发思考，但同一个 `(room, agent)` 的 turn 串行，保证该 Agent 自己的上下文顺序。
- 每个回复都带 `causationId`，UI 可将同一问题的多路回答分组展示。
- 协调 Agent 采用“安静主持”默认值：当用户明确只 `@` 专业 Agent 时不抢答；用户 `@协调Agent` 或要求汇总时再综合。
- Agent 可以邀请另一个 Agent，但只能调用结构化 `send_room_message`/`delegate_to_agent` 工具；模型输出中的普通 `@name` 文本不能自动执行。
- 自动邀请需要“允许本次”和“本房间允许”两种授权，均可审计和撤销。

建议的首期默认路由：

| 场景 | 默认接收方 | 说明 |
|---|---|---|
| 创建项目时的首条目标 | 协调 Agent | 负责澄清、形成初始 brief |
| 普通消息，无 Agent mention | Room（当前人类主体为 trusted local user）+ 协调 Agent | 可在房间设置中关闭协调 Agent 自动响应 |
| 明确 `@` 一个或多个专业 Agent | 被 mention 的 Agent | 协调 Agent保持安静，除非也被 mention |
| 回复某个 Agent | 原 Agent | UI 显示明确收件人，可再增加 mention |
| Agent 邀请 Agent | 经权限策略后的目标 Agent | 走 durable inbox，不做内存对象直调 |

这些是可版本化 `RoomPolicy`，不是散落在 prompt 中的约定。首期建议限制：禁止自我邀请；最大 2 跳；同一根消息最多 8 次 Agent invocation；重复参与者环路直接阻断并产生可见事件。

### 2.3 文档仍是团队事实源

聊天负责讨论，文档负责形成共识。Agent 对文档的修改默认产生 `StagedChangeSet`/proposal：

- 提案绑定文档版本和具体 block/node。
- 人可逐块接受、拒绝或继续局部修改。
- 多 Agent 同时给建议时，各自形成独立提案，不直接并发覆盖主文档。
- 接受提案时使用 revision CAS；基础版本已变化则要求重算或人工处理冲突。
- Room 消息、TeamTask、ExecutionJob、文档提案之间用稳定引用关联，而不是把状态藏在自然语言中。

## 3. 调研起点与已闭合差距

### 3.1 调研启动时的历史快照

本节原先记录的是架构调研的出发点，不再代表当前实现：当时 Tobe 已有从目标创建 workspace、
基础 `Session`/`ChatMessage`/`AssistantRun`、评论侧栏 mention、`AgentProfile`/`TeamTask`/`TaskActivity`、
请求内 Pi 流式协调、工具策略和项目上下文构建，但尚未把这些能力收敛为独立的 Room、Execution 与
Knowledge 生命周期。这个历史差距解释了为什么本方案选择“三生命周期 + Tobe-owned facts”，应保留为
决策背景，而不能继续当作实时缺口清单。

### 3.2 已闭合的核心差距与保留边界

- 主聊天已升级为持久 Project Room：participant、typed mention、可靠 inbox/outbox、事件 replay、独立
  Session Host、Pi runtime 和产品 UI 均有实现；Room 身份不再依赖一次 HTTP 请求内的 Agent 对象。
- Room turn 已通过预算化 context builder、cursor delta、文档/知识按需读取和 provenance trace 控制上下文；
  provider session 与 summary 仍只是可重建缓存。
- 长任务已由 `ExecutionJob`/`ExecutionAttempt`、lease、heartbeat、checkpoint、generation fencing、artifact/event
  read model 和独立 daemon 承担；`AssistantRun` 与 `TeamTask` 保持各自职责，不复用为 runtime 状态机。
- Runtime 生产组合同时支持内建 Generic CLI 与部署方受信的 `external-module`；加载路径、export、contract
  version 和 environment allowlist 均来自 daemon 配置，不能由 Job payload 指定。
- Execution admission 已锁定 aligned immutable document version；需要确认的工具调用使用持久、绑定参数且
  一次性消费的人工 confirmation，而不是信任模型声称“已获批准”。
- Git 路径已从 frozen binding/base 经 attempt isolated clone/workspace、proposal/review、trusted default-ref CAS merge 闭合到
  ready index snapshot；HTTP cancel、三个 cleanup crash stage 的 reclaim 和 durable recovery quarantine/operator
  action 也已有实现。
- 仍保留的安全边界是：OpenHands 仅为 fail-closed 候选；不提供远程 Git credential/fetch/push 或 monorepo
  subpath mount；不自动恢复来源不明的 dirty workspace。实时完成度与门禁证据继续由 `SYSTEM.md` 和 active
  tracker 维护。

## 4. 目标模型：产品两种体验，运行时三个生命周期

用户感知的确应是两种方式：

1. **常驻会话：** 在 Room 里随时找 Agent 讨论，低延迟、连续、有记忆。
2. **独立任务：** Agent 或人把复杂工作升级为 Job，离线执行，完成后回到 Room 和 review。

但实现上还需要一个不保存长期状态的入口协调器，所以是三个生命周期：

| 生命周期 | 责任 | 延迟/可靠性偏好 | 请求结束后 |
|---|---|---|---|
| `CoordinatorRequestRun` | 接待、澄清、解析意图、轻量工具、路由 | 首 token 优先；允许随请求中断 | 结束 |
| `RoomAgentSession` | 群聊、连续人格、即时专业回复、按需查历史 | 低延迟；热驻或快速冷恢复 | 身份保留，进程对象可冷却 |
| `ExecutionJob` | 研究、浏览器、代码、Git、长耗时工具 | durability、隔离、恢复优先 | 必须继续到持久终态 |

### 4.1 CoordinatorRequestRun

- 继续运行在 Next.js 请求生命周期内，沿用现有 Pi 集成。
- 可以流式输出；浏览器断开后允许中止本轮。
- 只做有界动作：澄清、生成简短提案、解析 mention、读取少量上下文、调用 `RoomMessageRouterPort` 或 `ExecutionSubmissionPort`。
- 不能拥有 durable job，也不能把内存 Agent 当成后续回调地址。
- 当它提交 Room 消息或 Job 并拿到 accepted receipt 后，后续工作命运与 HTTP 请求解耦。

### 4.2 RoomAgentSession

- 每个 `(roomId, agentId)` 有一个稳定 session identity。
- 活跃时由长驻 Session Host 保温；闲置可降为 cold，下一次 mention 从 checkpoint + event cursor 恢复。
- 一个 Agent session 同时只执行一个 turn；新投递进入 FIFO inbox。不同 Agent 可并行。
- session 能按需搜索 Room 历史、文档和知识，不默认接收所有历史。
- 热状态是性能优化，不是事实源；宿主进程可随时被重启。
- 只承担对话和短工具，不运行无界 shell/browser/research loop。需要长工作时提交 Execution Job 并立即返回 Job 卡片。

### 4.3 ExecutionJob

- Job 创建后立即持久化并返回 `202 accepted`。
- Scheduler 从 DB queue claim；每次执行形成独立 attempt 和递增 generation。
- Runtime Daemon 用 heartbeat 续租，所有 checkpoint/complete 都必须带 fencing generation。
- 当前 host execution 是受信本地部署，不等于每 attempt 的 container/VM sandbox。只有被匹配到
  `workspace=git-worktree` wrapper 的 attempt 才有受管 isolated clone/workspace；该 capability 名不表示
  native Git registered worktree。浏览器关闭、Next.js 重启或 worker 崩溃不丢 durable Job。
- 输出是结构化 result、artifact、文档/知识 proposal，而不是直接修改权威状态。
- Job 成功把 TeamTask 推入 review，不直接替用户标记 done。

## 5. 总体架构与合理分层

### 5.1 部署拓扑

```text
┌──────────────────────── Browser ─────────────────────────┐
│ Notion-like Docs | Project Room | Tasks | Review | Jobs │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTP commands + SSE events
┌───────────────────────────v──────────────────────────────┐
│ Next.js Web/BFF                                           │
│ auth | request-scoped Pi coordinator | query APIs         │
│ command validation | idempotency | event projection      │
└──────────────┬──────────────────────────┬─────────────────┘
               │                          │
         Room commands               Execution commands
               │                          │
┌──────────────v─────────────┐   ┌────────v─────────────────┐
│ Room Session Host(s)       │   │ Execution Control Plane │
│ session lease / FIFO       │   │ JobStore / scheduler    │
│ Pi adapter / DSH candidate │   │ attempt / lease / sweep │
└──────────────┬─────────────┘   └────────┬─────────────────┘
               │                          │ claim protocol
               │                          v
               │                 ┌──────────────────────────┐
               │                 │ Runtime Daemon(s)        │
               │                 │ sandbox / tools / Git    │
               │                 │ Generic CLI / external   │
               │                 │ module / candidates      │
               │                 └──────────┬───────────────┘
               │                            │
┌──────────────v────────────────────────────v───────────────┐
│ Tobe-owned data                                            │
│ SQLite WAL (MVP) | outbox/events | object artifacts | Git  │
│ docs | room | tasks | jobs | permissions | knowledge index│
└────────────────────────────────────────────────────────────┘
```

Web MVP 只做文本和文档协作，不需要引入 WebRTC/SFU。普通 HTTP command + 可重放 SSE 足够；当前事实源是
WAL 模式的本地 SQLite。Redis Streams 可作为未来多实例 wakeup/传输层，Postgres 也只是未来可替换的
durable store；无论采用哪种存储，消息、inbox 与 outbox 都不能退化为进程内事实。若未来加入语音/视频，
再独立接入 LiveKit 等媒体层。

### 5.2 代码层次

建议按依赖方向组织，而不是按页面堆业务：

```text
src/domain/
  room/                 Room、Message、Mention、Session、Grant 状态机
  document/             Version、Proposal、ChangeSet
  task/                 TeamTask 业务工作流
  execution/            Job、Attempt、Artifact 状态机
  knowledge/            Space、Snapshot、ChangeRequest

src/application/
  coordinator/          请求级用例编排
  room/                 接收消息、路由、回复落库、恢复
  execution/            submit/claim/heartbeat/complete/cancel
  knowledge/            snapshot、proposal、review、merge、index

src/ports/
  coordinator/
  room-runtime/
  execution/
  context/
  knowledge/
  permissions/

src/adapters/
  persistence/prisma/
  room-runtime/pi/
  room-runtime/deepseek-harness/     # 候选，不是当前生产 adapter
  execution/pi/
  execution/generic-cli/
  execution/external-module/        # 部署方受信扩展边界
  execution/openhands/              # fail-closed 候选 skeleton
  execution/langgraph/              # 候选
  git/
  artifacts/
  event-transport/

src/interfaces/
  http/                 Next route handlers，只有 DTO 转换
  sse/
  tools/                Agent 可调用的受治理工具

apps/
  room-session-host/       独立 Room host 进程
  execution-daemon/       Generic CLI / external-module 共享控制协议
  knowledge-merge-worker/ trusted CAS merge + index publish
```

依赖约束：

- domain 不 import Next.js、Prisma、Pi、DSH、OpenHands。
- coordinator 只依赖 port，不直接创建专业 Agent 或 claim Job。
- Room runtime 只能通过 `ExecutionSubmissionPort` 创建 Job，不能启动 daemon。
- Job completion 只写 result + outbox，不能回调某个内存 Agent。
- provider adapter 不能直接更新 TeamTask、文档或权限。
- Room、Execution、Knowledge 各自拥有状态机、schema version 和 contract test kit。
- 跨模块只传稳定 ID、版本化 command/event 和不可变引用；不共享 ORM model 或第三方 SDK 类型。

这允许独立升级 DSH、替换 Pi、拆出 Scheduler 或迁移数据库，而不改 UI/领域契约。

## 6. 稳定契约

### 6.1 核心 ports

```ts
interface CoordinatorTurnPort {
  run(input: CoordinatorTurnV1): AsyncIterable<CoordinatorEventV1>;
}

interface RoomMessageRouterPort {
  accept(input: RoomMessageCommandV1): Promise<RoomDispatchReceiptV1>;
}

interface RoomSessionRuntimePort {
  capabilities(): RoomRuntimeCapabilitiesV1;
  open(input: OpenRoomSessionV1): Promise<RoomSessionHandle>;
  resume(input: ResumeRoomSessionV1): Promise<RoomSessionHandle>;
}

interface RoomContextPort {
  buildTurn(input: BuildRoomTurnContextV1): Promise<RoomTurnContextV1>;
  searchRoom(input: SearchRoomV1): Promise<ContextHitV1[]>;
  readDocument(input: ReadDocumentVersionV1): Promise<DocumentSliceV1>;
}

interface PermissionPolicyPort {
  authorize(input: CapabilityRequestV1): Promise<PolicyDecisionV1>;
}

interface ExecutionSubmissionPort {
  submit(spec: ExecutionSpecV1): Promise<ExecutionReceiptV1>;
}

interface ExecutionQueuePort {
  claim(input: ClaimRequestV1): Promise<ExecutionLeaseV1 | null>;
  heartbeat(input: HeartbeatV1): Promise<void>;
  checkpoint(input: CheckpointV1): Promise<void>;
  complete(input: CompleteAttemptV1): Promise<void>;
}

interface KnowledgeQueryPort {
  resolveSnapshot(input: KnowledgeSnapshotRequestV1): Promise<KnowledgeSnapshotV1>;
  search(input: KnowledgeSearchV1): Promise<KnowledgeHitV1[]>;
}

interface KnowledgeChangePort {
  stage(input: KnowledgeChangeProposalV1): Promise<KnowledgeReviewRefV1>;
}

interface GitWorktreePort {
  prepare(input: PrepareWorktreeV1): Promise<PreparedWorktreeV1>;
  finalize(input: FinalizeWorktreeV1): Promise<GitDeliveryV1>;
  cleanup(input: CleanupWorktreeV1): Promise<void>;
}
```

`RoomSessionRuntimePort` 不应被设计成“所有 provider 能力完全一样”。`capabilities()` 必须显式声明 `nativeResume`、`interrupt`、`checkpoint`、`toolStreaming`、`childSession` 等；缺少能力时由 Tobe 用持久事件 fresh-replay，不能伪造语义。

### 6.2 命令与事件 envelope

所有跨进程消息统一使用：

```ts
type CommandEnvelopeV1<T> = {
  version: 1;
  commandId: string;
  idempotencyKey: string;
  organizationId: string; // 由服务端身份上下文写入
  actor: { type: 'user' | 'agent' | 'system'; id: string };
  causationId?: string;
  correlationId: string;
  occurredAt: string;
  payload: T;
};

type DomainEventV1<T> = {
  version: 1;
  eventId: string;
  aggregateType: string;
  aggregateId: string;
  seq: number;
  type: string;
  causationId?: string;
  correlationId: string;
  occurredAt: string;
  payload: T;
};
```

语义是 at-least-once delivery + 幂等消费，不承诺虚假的 exactly-once。每个副作用用 `commandId`、`deliveryId` 或 `toolCallId` 去重。

### 6.3 外部入口

可暂时保留 `/api/agent/run`，但内部转换为版本化联合命令：

```ts
type AgentCommandV1 =
  | { kind: 'coordinator.turn'; input: CoordinatorTurnV1 }
  | { kind: 'room.message'; input: RoomMessageCommandV1 }
  | { kind: 'execution.start'; input: ExecutionSpecV1 };
```

- `coordinator.turn` 可返回流式 `200`。
- `room.message`、`execution.start` 在事务持久化成功后返回 `202` receipt；accepted 不表示完成。
- 浏览器通过 `GET /api/rooms/:roomId/events?after=<seq>` 和 `GET /api/execution-jobs/:jobId/events?after=<seq>` 续读。
- 客户端不能提供 organization/user 权威字段。当前权威值来自进程冻结的 trusted local
  organization/user/device context；受信 Web runtime header 只是匹配该 tuple 的 transport receipt，不是
  authentication。未来 production IdP 或 server-side login/session/JWT mapping 需要独立部署与验收。
- mention 文本只用于展示，服务端写入稳定的 `RoomMessageMention`。

## 7. 上下文管理：常驻身份，不常驻无限 prompt

这是整个方案的关键。若直接把“常驻 session”理解为不断追加历史，系统很快会遇到成本、延迟、旧信息污染、权限泄漏和无法复现的问题。

### 7.1 四层信息模型

| 层 | 内容 | 是否权威 | 生命周期 |
|---|---|---|---|
| Project truth | 文档版本、Room 消息、TeamTask、已合并知识 commit | 是 | 按项目保留策略 |
| Agent episodic state | 游标、bounded summary、未完成意图、偏好 | 否，可重建 | 跟 RoomAgentSession |
| Job snapshot | 任务目标、文档版本、Room watermark、Git commit、附件 hash | 对该 Job 不可变 | 跟 Job/审计保留 |
| Derived caches | embedding、全文索引、provider cache、热 Agent 对象 | 否 | 可淘汰、可重建 |

第三方 runtime 的 session state 只能落在第二或第四层，绝不能替代第一层。

### 7.2 每次 Room turn 的上下文配方

`RoomContextPort.buildTurn` 按确定性配方构造上下文：

1. **固定控制层：** Agent profile/version、Room policy/version、工具能力、权限边界、输出语言。
2. **触发层：** 当前消息、reply target、typed mentions、focus document node。
3. **增量层：** 从该 Agent 的 `lastRoomSeq` 到当前 watermark 中与其有关的消息；未 mention 的噪声不默认注入。
4. **线程层：** 当前 reply chain 的有限窗口。
5. **文档层：** 用户聚焦的 block、引用的文档版本和相邻必要结构，而非整份 workspace。
6. **会话层：** 有来源范围的 bounded summary、未完成 promise、最近少量 turn。
7. **检索层：** 初始只放高置信少量命中；其余通过工具按需读取。
8. **预算层：** 为系统规则、当前输入、文档、历史、检索、模型输出分别设 token 上限和截断策略。

建议提供以下只读工具：

```text
search_room(query, before_seq, limit)
read_room_range(from_seq, to_seq)
read_document(document_id, version_id, node_ids)
search_knowledge(query, knowledge_snapshot, scopes)
inspect_task(task_id, revision)
request_context_expansion(reason, refs)
```

Agent 可以自行判断是否搜索历史，但每次检索都留下 query、命中来源、版本和使用记录。被检索的文档/消息以 `untrusted_context` 数据块进入模型，不能覆盖 system policy。

### 7.3 Summary 的正确地位

会话摘要是带 provenance 的缓存，不是事实：

```ts
type SessionSummaryV1 = {
  sessionId: string;
  fromRoomSeq: number;
  toRoomSeq: number;
  sourceEventHash: string;
  agentConfigVersion: string;
  claims: Array<{ text: string; sourceRefs: string[] }>;
  openLoops: Array<{ text: string; sourceRefs: string[] }>;
  createdAt: string;
};
```

- 摘要中的重要结论必须可追溯到 Room 消息、文档版本或知识 commit。
- 修改/删除源内容后，摘要按 source range 失效或重算。
- 不把工具密钥、隐藏推理或敏感原文写进摘要。
- provider 原生 resume 失败时，用最近有效摘要 + 持久增量恢复 fresh session。

### 7.4 长任务的不可变 ContextManifest

Job 创建时冻结上下文，不把“以后会变化的当前状态”作为隐式依赖：

```ts
type ContextManifestV1 = {
  manifestId: string;
  organizationId: string;
  room: { roomId: string; throughSeq: number };
  documents: Array<{ documentId: string; versionId: string; contentHash: string }>;
  knowledgeCommit: FrozenKnowledgeBindingV1 | null;
  attachments: Array<{ artifactId: string; sha256: string }>;
  agentConfigVersion: string;
  toolPolicyVersion: string;
  roomPolicyVersion: string;
  retrievalRecipeVersion: string;
  createdAt: string;
};

type FrozenKnowledgeBindingV1 = {
  schemaVersion: 1;
  bindingId: string;
  spaceId: string;
  workspaceId: string;
  agentId: string | null;
  mountPath: string;
  defaultBranch: string;
  baseCommit: string;
};
```

规则：

- 浏览器、请求级协调 Agent 和 Runtime 都不能直接提交 `ContextManifest`。它们只提交
  `goal + workspaceId/projectId + 可选 documentVersionId/conversationId` 等来源引用；
  Execution 控制面按当前组织权限读取权威文档、版本、Room watermark 与知识 commit，
  计算内容 hash 后生成 manifest。组织 Runtime policy 同样只能从服务端配置解析。
- `knowledgeCommit` 只保存 admission 时解析出的非敏感 frozen binding/base。它不包含
  `repoPath`、repo URL、credential 或 prepared workspace；daemon claim 后只能以 frozen `bindingId`
  在同组织重验 binding/space 并取得私有 repo 信息，不能重新自由选择 binding，也不能重新解析
  default branch。`prepare` 必须始终使用 frozen `baseCommit`。
- binding 选择必须唯一且 fail closed：只接受当前 workspace 的 `access=propose`；有 frozen agent 时
  优先唯一 agent-specific binding，再退到唯一 global binding；无 agent 时只允许 global binding。
  agent-scope space 还必须匹配 owner。无唯一合法 binding 时写 `null`；硬要求 Git workspace 的 Job
  则在 admission 被拒绝。
- 默认 snapshot consistency。任务若需要刷新上下文，显式生成新 manifest revision 和审计事件，不能静默漂移。
- Job 输出必须报告基线版本；当前文档已变化时，delivery 显示 divergence，并进入 rebase/review。
- 长任务完整日志不回灌到常驻会话；只回传结构化摘要、artifact refs、引用和变更提案。
- Job 若需要人回答，进入 `waiting_input`，在 Room 中创建明确问题；回答生成不可变、可审计的
  human-input receipt，再以同一 `responseId` 幂等恢复原 attempt。回答不能只把 Job 改回 queued：
  claim 必须携带该 receipt，daemon 必须调用 `resume({ humanInput })`，存在待投递回答时禁止 fallback 到
  `start()`。

### 7.5 上下文生命周期示例

```text
用户 @研究Agent
  -> 读取当前 message + 相关 thread + 文档焦点 + session summary
  -> Agent 发现需要更早决策，调用 search_room
  -> Agent 判断任务较长，调用 start_execution_job
  -> 固化 ContextManifest(room seq 184, doc v27, knowledge commit abc)
  -> 该 Job 明确要求并匹配 git-worktree wrapper，在独立 clone/workspace 工作
  -> Room 在此期间继续到 seq 231、doc v31
  -> Job 返回基于 v27 的 proposal，UI 标注已落后 4 个版本
  -> 人 review/rebase，而不是静默覆盖 v31
```

这正是“常驻会话 + 独立任务”能够长期工作的前提。

## 8. Room Session 设计

### 8.1 数据模型

```text
ProjectRoom
  id, organizationId, workspaceId, status, policyVersion, revision

RoomMessage
  id, roomId, seq, authorType, authorId, contentJson,
  replyToMessageId?, focusNodeId?, causationId, createdAt

RoomMessageMention
  messageId, targetAgentId

RoomAgentSession
  id, roomId, agentId, agentConfigVersion,
  durableStatus, lastRoomSeq, lastEventSeq,
  checkpointRef?, providerSessionRef?, generation, revision

RoomInboxItem
  id, sessionId, sourceMessageId, deliveryId, mode,
  status, deliveryAttempt, rootCausationId, hopCount, createdAt

RoomAgentEvent
  sessionId, seq, type, payloadJson, createdAt

DelegationGrant
  roomId, grantedByUserId, granteeAgentId, targetAgentId?,
  capability, scope(once|room), expiresAt?, consumedAt?, revokedAt?
```

`RoomMessage` 是公开协作事实；模型 step、tool event、checkpoint 是 Agent 私有事件。`providerSessionRef` 只是优化引用。

### 8.2 状态机与 owner lease

```text
cold -> warming -> idle -> running -> idle
           |          |        |
           +-------> recovering <--- crash / lease loss
                         |
                         +-> idle  恢复成功
                         +-> cold  等待再次唤醒
idle -> draining -> cold
* -> closed
```

- Session Host 对 `(roomAgentSessionId, generation)` 获取单 owner lease。
- 建议默认 lease 30 秒、每 10 秒 heartbeat；均配置化。
- warm idle TTL 建议 20 分钟；Room 有在线用户时可延长。running/warming 不得被 LRU 驱逐。
- lease、事件和回复写入均带 generation；旧 Host 恢复后的 stale write 被 CAS 拒绝。
- 同一 session 单 turn FIFO。明确 `steer` 的输入才可在下一模型 step 注入；普通消息进入下一个 turn。
- 崩溃发生在 streaming 中间时，已展示片段标记 `interrupted`；重试沿用 delivery correlation，不生成看似无关的第二条回答。

### 8.3 消息投递

1. Coordinator/HTTP handler 鉴权并验证命令。
2. 一个 DB 事务中写 `RoomMessage`、mentions、每个目标 Agent 的 inbox item 和 outbox。
3. 立即返回 receipt。
4. wakeup transport 通知 Session Host；即使通知丢失，poll/sweeper 仍能发现 pending inbox。
5. Host claim session，构造有限上下文并调用 adapter。
6. token/tool delta 作为 transient event 推送；最终消息幂等落库。
7. 其他未被 mention 的 Agent 不运行，但未来可通过历史搜索看到该消息。

## 9. Execution Plane 设计

### 9.1 TeamTask 与 ExecutionJob 不合并

```text
TeamTask：团队为什么做、由谁负责、何时评审
ExecutionJob：某次机器工作如何排队、领取、执行、恢复

TeamTask 1 ----- 0..N ExecutionJob
ExecutionJob 1 - 1..N ExecutionAttempt
ExecutionJob 1 - 0..N ExecutionEvent / Artifact
```

`publish_team_task` 继续表示发布工作项/困难求助；新增 `start_execution_job` 表示真正消耗 runtime capacity。两者不能复用一个工具。

### 9.2 数据模型

```text
ExecutionJob
  id, organizationId, teamTaskId?, sourceRoomId?, sourceMessageId?,
  requestedByType, requestedById, agentId, specVersion, specJson,
  contextManifestId, status, desiredState, priority, deadlineAt?,
  maxAttempts, currentAttempt, resultJson?, failureClass?, timestamps

ExecutionAttempt
  id, jobId, attemptNo, generation, runtimeId, claimTokenHash,
  leaseExpiresAt, heartbeatAt?, providerSessionRef?, checkpointRef?,
  workspaceLifecycleJson?, status, failureClass?, failureMessage?, timestamps

ExecutionEvent
  jobId, seq, attemptNo, type, payloadJson, createdAt

ExecutionArtifact
  id, jobId, attemptNo, kind, uri, sha256, size, metadataJson

RuntimeRegistration
  id, organizationId?, location, capabilitiesJson,
  maxConcurrency, activeSlots, heartbeatAt, disabledAt?

OutboxEvent
  id, aggregateType, aggregateId, seq, destination,
  payloadJson, deliveryAttempt, deliveredAt?
```

`workspaceLifecycleJson` 是 attempt 私有控制面状态，不进入普通 DTO/API，也不能传给 Runtime。Git
workspace 的最小版本是单调追加的 receipt：

```ts
type GitWorkspaceLifecycleV1 = {
  schemaVersion: 1;
  kind: 'git-worktree';
  binding: FrozenKnowledgeBindingV1;
  prepared: PreparedGitWorktreeV1;
  runtimeCompletion?: {
    status: 'succeeded' | 'failed' | 'cancelled';
    result?: JsonValue;
    error?: JsonValue;
  };
  finalized?: FinalizedGitWorktreeV1;
  changeRequestId?: string;
  cleanedAt?: string;
};
```

没有独立 phase enum；逻辑阶段由 receipt 是否存在及字段存在性构成固定的可选后缀：
`absent -> binding+prepared -> runtimeCompletion -> finalized -> changeRequestId -> cleanedAt`。已写
receipt 不删除、不改写；相同内容 replay 返回成功，同一阶段出现不同内容返回 conflict。
`checkpointJson` 仍只属于 Runtime checkpoint，不得复用来保存 workspace lifecycle。

### 9.3 状态机和失败语义

```text
queued -> claimed -> running -> succeeded
   ^         |          |
   |         |          +-> waiting_input -> queued/resume
   |         |          +-> retry_wait -> queued
   |         |          +-> cancel_requested -> cancelled
   |         |          +-> failed
   +---------+ lease expired before safe start
```

- Job admission 创建首个 pending attempt；首次 claim 或过期 lease reclaim 都递增 generation。只有业务重试才创建新的 attempt number。
- `waiting-for-human` 是成功暂停边界，不是失败或普通 fence。Runtime 发出该事件后不得再产生业务事件；
  Store 在同一事务中持久化 event/input request、释放 lease 与 capacity、递增 generation 并将
  Attempt/Job 转为 `waiting_input`。daemon 收到 `suspended` receipt 后停止 heartbeat、关闭 iterator，
  但不得调用 `interrupt()`、complete、archive 或 cleanup。
- 人工 answer 以 Request/Job revision 做首次 CAS，写入 actor-owned response 后把 Attempt 置回 pending、
  Job 置回 queued；answer 本身不递增 generation。下一次 claim 才获得新 ownership generation，并把
  `{ requestId, responseId, response }` 交给 `resume()`。HTTP exact retry 由幂等键和 canonical response 判定，
  不依赖后来已变化的 Job revision。
- `runtimeRunId` 必须在 `attempt-started` event 的同一事务中写入 Attempt。声明
  `waitingForHuman=true` 的 Runtime 必须同时声明 native resume 并实现 `resume()`；控制面不允许以能力降级
  规避这一约束。
- `waiting_input` 取消先把 Job 改为 `cancel_requested` 并取消 pending input，再由 daemon 以 maintenance
  claim 中断保留的 runtime session、清理 workspace、写 terminal event；不能留下
  `Job=cancelled / Attempt=waiting_input / InputRequest=pending` 的矛盾组合。
- suspended Git workspace 的恢复必须验证受管 isolated clone 路径、receipt marker、proposal branch 与
  attempt identity，允许该己方 workspace 含本次任务的 dirty 修改；这与“来源不明 dirty workspace
  不自动接管”的
  fail-closed 规则并不冲突。
- 当前本地 SQLite 使用条件更新/CAS，并由 bootstrap 强制 `journal_mode=wal`；应用进程通过
  `SafePrismaLibSqlAdapterV1` 设置 busy timeout、串行化单连接访问和 terminal transaction cleanup。
  `SQLITE_BUSY` 只在可幂等重放的完整 durable command 边界有限重试。若未来引入 Postgres，应使用
  短事务 + `FOR UPDATE SKIP LOCKED`，并与 SQLite 跑同一 contract suite。
- heartbeat、checkpoint、event、workspace lifecycle、ChangeRequest upsert 与 complete 都受当前
  `attemptId + generation + worker/claim token + unexpired lease` fencing；每次 lifecycle 写入还必须验证
  attempt 为 `running`。
- lease 过期后旧 attempt 的 completion 必须返回 conflict，不能覆盖新 owner。
- cancel 已是 durable desired state。running Job 的请求只写 `cancel_requested`，不修改 attempt
  generation、不清 lease、不释放 capacity；Daemon 观察后 TERM -> grace -> KILL，持久化唯一
  `attempt-completed/interrupted`（workspace attempt 同事务追加 `runtimeCompletion(cancelled)`），完成
  cleanup 后再 `complete(cancelled)`。若 lease 先过期，新 generation 可 reclaim `cancel_requested` Job，
  沿用原 capacity reservation 完成收尾；capacity 只在最终 complete 时释放一次。
- 外部副作用必须有幂等键；无法判断是否已执行时进入 `waiting_input/needs_review`，不盲目重试。
- Runtime `attempt-completed` terminal event 与 `workspaceLifecycleJson.runtimeCompletion` 必须在同一个 fenced 事务中
  提交，避免 crash 后重复启动已结束的 non-resumable CLI。最终 result、artifact refs、TaskActivity、
  Room completion outbox 在 complete 事务提交。
- Job 成功默认将关联 TeamTask 推到 `review`，由人确认 `done`。

### 9.4 从聊天升级到 Job

1. Agent 判断任务超过交互预算，或用户点击“开始工作”。
2. Agent 先即时回复“已准备创建独立任务”，不让聊天等待。
3. `start_execution_job` 先形成待确认的结构化意图；只有绑定 actor、Room、工具参数摘要、
   过期时间且一次性消费的人类 grant 才可提交目标与来源引用。Execution 控制面随后检查授权/配额，
   并从权威数据构造不可变 spec + ContextManifest；没有 grant 时必须 fail closed。
4. 一个事务创建/关联 TeamTask、ExecutionJob、TaskActivity、Room outbox。
5. Room 显示 Job 卡片；详细日志留在 Job 页面，Room 只显示阶段性状态。
6. Daemon claim 后在隔离环境执行。
7. 完成 outbox 唤醒来源 Agent session，由它把结构化结果总结回 Room。
8. 文档和知识改动进入 review。

## 10. Git 知识库设计

### 10.1 两种逻辑范围统一抽象

抽象上区分：

- **Agent 独立 repo：** 个性化经验、私有 playbook、该 Agent 专属资料。
- **团队共享知识库：** 团队决策、领域知识、项目约定和共享技能。

当前 MVP 只操作部署方配置的本机受信 repo，并将整个 repository root 绑定为 `mountPath='/'`。
`repoUrl`/`credentialRef` 只保留为模型扩展位，不代表已经支持远程 credential、fetch 或 push；把共享
monorepo 的某个子目录单独挂载为安全边界也不在 MVP 范围内。

统一为 `KnowledgeSpace`：

```text
KnowledgeSpace
  id, organizationId, scope(team|agent), ownerAgentId?,
  repoUrl, defaultBranch, credentialRef, readPolicy, writePolicy

KnowledgeBinding
  workspaceId, agentId?, spaceId, mountPath, access(read|propose)

KnowledgeSnapshot
  id, spaceId, commitSha, indexVersion, createdAt

KnowledgeChangeRequest
  id, jobId, attemptId, spaceId, baseCommit, headCommit,
  branchName, status, diffSummary, reviewerId?, mergedCommit?, timestamps
```

若未来增加经过验证的 monorepo 子目录隔离，可采用如下逻辑目录；这不是当前 mount 能力：

```text
/team/decisions/
/team/domain/
/team/playbooks/
/projects/<project-id>/
/agents/<agent-id>/
```

届时目录 ACL 必须由 `KnowledgeQueryPort`/`KnowledgeChangePort` 强制执行，不能依赖 prompt 提醒。

### 10.2 需要 Git workspace 的 Job/attempt 流程

1. Job admission 从服务端生成的 manifest workspace 和可信 frozen agent 身份选择唯一 binding。只接受
   `access=propose`；有 agent 时优先唯一 agent-specific binding，再退到唯一 global binding，无 agent
   时只允许 global binding。agent scope 还必须匹配 owner；同优先级歧义、跨组织、read-only 或本地
   port 没有 `repoPath` 都 fail closed。
2. admission 解析 default branch 为不可变 SHA，把
   `{ bindingId, spaceId, workspaceId, agentId, mountPath, defaultBranch, baseCommit }` 写入
   `ContextManifest.knowledgeCommit`。`repoPath` 和 credential 不进入 manifest 或 Runtime。若没有唯一
   binding 则写 `null`；硬要求 `git-worktree` 的 Job 直接拒绝。
3. Daemon claim 后只按 frozen `bindingId` 重验授权并取得私有 repo 信息，以 attempt number 创建受管
   branch `agent/<agentId>/job/<jobId>/attempt/<n>` 和服务端生成的 workspace 路径。当前 local port 使用
   `git clone --no-hardlinks` 创建独立 clone、移除 origin，并从 frozen `baseCommit` checkout proposal branch；
   它不调用 `git worktree add`，不能写成 native registered worktree。
4. `prepareOrRecover` 成功后，先把完整 opaque `prepared` receipt fenced 写入
   `ExecutionAttempt.workspaceLifecycleJson`，再向 Runtime 传递受限的 `file://` URI 与 frozen revision；
   不传 repo 路径、credential 或完整 prepared receipt。
5. Runtime 在该受管目录中工作；Agent 只有 read + propose 权限，没有 default branch push/merge
   credential。有新知识时提交 commit，trailer 记录 `Job-Id`、`Attempt-Id`、`Context-Manifest`、
   `Agent-Id`。
6. Runtime `attempt-completed` terminal event 与 `runtimeCompletion` 在同一 fenced 事务持久化。failed/cancelled 跳过
   finalize 和变更单；succeeded 才执行 `finalizeOrRecover`，生成 head SHA、patch hash、文件清单、
   diff summary 与敏感信息扫描结果，再 fenced 写入 `finalized` receipt。
7. succeeded-and-changed 使用内部 worker command fenced/idempotent upsert 唯一
   `KnowledgeChangeRequest`，并在同一事务写 `changeRequestId`；unchanged 不创建变更单。变更单 durable
   后才允许 cleanup。
8. `cleanupOrRecover` 删除 isolated clone/workspace 但保留源 repo 的 proposal branch，fenced 写入
   `cleanedAt`，然后才 complete
   attempt/Job 并停止 heartbeat。不能先 complete 再依赖进程内 cleanup，否则 crash 后 attempt 无法 reclaim。
9. 人批准后，独立受信 merge worker 验证 proposal ref/head/base/commit range，并以
   `git update-ref <default-ref> <new> <expected-old>` 执行 default-head CAS；冲突进入 `conflicted`，daemon、
   Runtime 和 Agent 均无 approve/merge authority。merge receipt 持久化后构建索引，只有完整构建成功的
   `(spaceId, commitSha, indexVersion)` `KnowledgeSnapshot` 才发布为 ready。该闭环及其 review/operator UI
   已实现；Job audit、patch artifact 和 merged commit 保持可追溯。

如果 Job 没有产生新知识，不强制 commit。运行日志、临时文件、下载材料也不自动进入知识库。

`prepareOrRecover`、`finalizeOrRecover` 与 `cleanupOrRecover` 的“幂等”必须是 exact replay，不是
best effort：

- prepare 只在受管路径、独立 clone 的 `.git`/receipt marker、branch、base、attempt identity 全部相同时复用。
- finalize 重放只在 workspace clean，branch HEAD、parent/base、attempt commit/trailer 全部匹配时重建
  相同 receipt。
- cleanup 重放可把“预期受管路径已不存在”视为成功。
- 任何部分匹配或状态漂移都 fail closed，禁止 `--force` 接管未知状态。
- matching 但 dirty 的 workspace 也 fail closed。当前没有保存或恢复来源不明未提交修改的 durable
  协议，因此绝不能把 prepared-clean reclaim 或 committed-finalize replay 称为 dirty-workspace crash recovery。

heartbeat 从 prepare 前一直持续到 cleanup 和 complete 完成。daemon/reclaim 按 receipt 的首个缺失
阶段继续：无 `prepared` 则 prepare；有 `prepared` 无 `runtimeCompletion` 才 resume/restart Runtime；
terminal success 后继续 finalize/ChangeRequest；terminal failure/cancel 或 finalized unchanged 直接继续 cleanup；
已有 `cleanedAt` 则只 complete。旧 generation 不能写 lifecycle、建变更单、mark cleaned 或 complete。
上述 phase-aware durable recovery 已接入 daemon；prepared-clean workspace 的跨进程 crash/reclaim、
HTTP running cancellation，以及 `before-workspace-cleanup`、`after-workspace-cleanup`、
`after-cleaned-lifecycle-persist` 三个 cleanup crash stage 的 reclaim 均已有进程级覆盖。该结论仍不承诺
自动恢复来源不明的 dirty workspace：无法 exact replay 的 dirty/partial 状态必须进入持久 quarantine，由
operator inspect 后选择 retry，或仅在可证明安全且策略允许时 discard。
若 daemon crash，旧 child process 还必须由进程 containment 确认退出或可 reconcile/interrupt，否则
数据库 fencing 无法阻止两个 generation 同时修改同一 workspace。

### 10.3 知识安全

- 对 secrets、私钥、token、个人数据和大二进制做 pre-commit/ingestion 检查。
- `mountPath` 是真实文件边界，不是只把 child cwd 指向子目录；最小实现仅允许 `/`，扩展后必须在
  finalize commit 前拒绝任何越界 changed path。
- 引用外部材料时保存 URL、抓取时间、内容 hash 和许可证/来源字段。
- 知识文本作为不可信数据进入模型；其中的“忽略之前指令”等内容不能升级为控制指令。
- 删除/权限变更后同步使检索索引失效。
- Room Agent 默认检索已合并 commit；只有负责该 Job 的执行 Agent 能读取自己的未审分支。

## 11. 开源项目调研与选型

调研以 2026-08-20 可见源码为准；版本更新很快，生产使用必须锁 commit/tag 并跑兼容测试。许可证结论是工程筛选，不替代法律审查。

| 项目 | 调研版本 | Room 常驻会话 | Durable 长任务 | Git/隔离 | 许可证与风险 | 本方案定位 |
|---|---|---:|---:|---:|---|---|
| DeepSeek Harness | `141eb6f`，`dsh-v0.1.0-rc.8` | 高潜力 | 低 | 一般 | MIT；developer preview、breaking changes | DSH room adapter 实验候选 |
| Multica | `3622db2` | 中低 | 高 | 高 | 自定义 source-available；托管/商业嵌入受限 | 只借鉴 daemon/job/worktree 思路 |
| OpenHands + Software Agent SDK | Canvas `4a8cabc`；SDK `1de2e6d` / tag `v1.42.1` | 中低 | 高 | 高 | MIT；Server 默认偏单机/轻量 | Generic CLI 验证开放 daemon 后的 repo/code adapter POC |
| LangGraph | `f09cfe8`，core `1.2.11` | 中 | 高 | 需自建 | Core MIT；Agent Server 另有部署/许可边界 | 可选 workflow execution adapter |
| Letta Code | `0d245b4`，package `0.30.27` | 高 | 低 | 中 | Apache-2.0；pre-1.0、单节点文件状态明显 | memory/session 参考或备选 adapter |
| AG2 | `8ac1b1e`，`v1.0.2` | 高潜力 | 中 | 需扩展 | Apache-2.0；1.0 runtime 很新 | 后续 Room 对照实验 |
| Microsoft AutoGen | `027ecf0`，Python `0.7.5` | 中高 | 中 | 中 | MIT；已进入 maintenance mode | 不作为新基础 |
| AgentScope 2.0 | `ad4d283`，`2.0.6` | 中高 | 中低 | 高 | Apache-2.0；需安全加固 | session/service/sandbox 参考，后续备选 |

### 11.1 DeepSeek Harness

适合 Room 的原因：

- append-only `SessionEvent`、live Agent registry、FIFO inbox。
- create/resume 与 cold recovery；child session 可继续。
- 工具和 session persistence 有插件 seam。
- SDK 子进程可以长期存活并承载多个 session。

不能直接成为成形平台的原因：

- generic jobs/workflows 是进程内机制，没有跨进程 queue、lease、heartbeat、fencing、worktree 或可靠终态协议。
- 当前 SDK wire 缺少 per-session close、prompt cancel、prompt-result correlation 和协议版本协商。
- ACP 主要适合 fresh session 且只给 committed reply，不适合作为低延迟 token-stream Room adapter。
- 默认 SQLite `DatabaseSync` 会阻塞事件循环，需要压测并隔离。
- 官方明确标记 developer preview。

结论：锁定版本，放在 Tobe 自有 `RoomSessionRuntimePort` 后做实验；Prisma、Room event 或公开 API 不得泄漏 DSH/Cordis 类型。默认排除有额外条款的可选 Anthropic/Claude bundle，单独审查后再启用。

### 11.2 Multica

值得借鉴：DB claim、daemon、任务恢复、运行日志、Git worktree、runtime 注册和本地/远程执行边界都很接近目标。

不能直接嵌入：其许可证在 Apache-2.0 之外增加了条件，未取得商业许可时禁止把源码作为第三方 hosted service 或商业产品组件；还包含 branding/attribution 条件。它也不是默认可信的多租户 sandbox。

结论：clean-room 实现更窄的 Tobe Execution Plane；不复制源码、内部协议或 UI。若未来购买商业许可，也仍保持 adapter 边界，避免产品事实依赖其模型。

### 11.3 OpenHands / Software Agent SDK

这是最符合 repo 类长任务的候选：

- 后台 run、pause/interrupt/resume、goal loop、预算和迭代上限。
- append 事件、状态恢复、owner lease 与 generation fencing。
- Agent Server 能按 conversation 创建 `openhands/<conversationId>` branch/worktree。
- WebSocket 增量事件、REST reconcile、remote workspace、Docker/Apptainer/cloud providers。

限制：

- Conversation 是单 Agent 执行状态机，不是多人 Room；同一 conversation 有 run lock。
- 默认 durability 是本地文件，README 将 Agent Server 定位为 development/testing/lightweight deployment；NFS 上 flock 不可靠。
- lease 不等于完整 HA 调度；任意 tool side effect 仍不是 exactly-once。
- host 模式不是 sandbox，file/git API 权限接近运行 server 的 OS 用户。

结论：将其作为后续 `ExecutionRuntimeDriver`，一个 Job/attempt 对应 conversation/worktree；Tobe 外层持有 JobStore、配额、ACL、artifact 和终态。先用协议完全可控的 Generic CLI driver 验证独立 daemon、lease 与恢复，再并行做 OpenHands POC；不直接让 OpenHands Server 成为控制面。

### 11.4 LangGraph

优势是 graph checkpoint、interrupt、持久 thread 和可组合 workflow，适合确定性较强的研究/审批/多步骤长任务。缺点是同一 thread 单 run、checkpoint 写入和排队不适合每条 Room 消息的低延迟热路径。Core 为 MIT；官方 Agent Server 的商业部署边界、Postgres/Redis要求需单独评估。

结论：可作为执行 daemon 内的 workflow adapter，但 Tobe 仍拥有 JobStore；不把 Room timeline 映射成一个 LangGraph thread。

### 11.5 Letta Code

优点是 Agent/Conversation/Session 分离、App Server 常驻、多 runtime WebSocket、持久记忆和 Git-backed MemFS，很适合“有性格、有长期记忆”的暖 Agent。

限制是同一 `{agent_id, conversation_id}` 一次只应有一个 turn；本地状态依赖文件/JSONL/Git 和完整卷备份；任务状态、重试、幂等与 reconnect checkpoint 明确仍要由嵌入方拥有；内建 subagent 会启动新 CLI 子进程，不是高频 mailbox。

结论：作为 session/memory 设计参考，暂不作为第一依赖。Tobe 的团队知识必须经过 review，不能直接等同于 Letta agent memory。

### 11.6 AG2 与 Microsoft AutoGen

AG2 1.0 的 Hub、typed channels、WAL、checkpoint、重连游标和 at-least-once 协议与 Room 很贴近；Apache-2.0 也适合商用。但 1.0 才在 2026-07 发布，Network/durability 栈过新，stream subscriber 串行等待也需要低延迟压测。可以作为 DSH 的对照实验，但不建议 v1 同时引入两套 Python/Node 平台。

Microsoft AutoGen 的 actor/topic/team 架构成熟，但官方已经进入 maintenance mode，并建议新项目采用其他框架。结论是不作为新基础。AG2 Classic 同样不是新系统基础。

### 11.7 AgentScope 2.0

AgentScope 2.0 有明确 AgentState、typed streaming、interrupt/resume、Redis/SQL storage、leader/worker、多种 sandbox，是可信的 async service 候选。其旧 `agentscope-runtime` 已只读并计划归档，不应依赖。

关键限制：session replay log 上限 1000 且 run 完成会清理；Redis queue 是 destructive drain，未看到 consumer-group ack/redelivery；lock 没有明确 fencing token；snapshot、事件、工具副作用之间没有原子事务。历史上还出现过 SSRF/path traversal 类风险，说明 prompt 控制的 URL/path 必须强隔离。

结论：可借鉴 service、权限和 workspace 层，或后续做 adapter；不能代替 Tobe 的 Room log/JobStore。

### 11.8 最终技术选型

| 层 | 首期选择 | 第二选择/实验 | 不选择为权威层 |
|---|---|---|---|
| 请求协调 | 现有 Next.js + Pi | 仅替换模型/provider | 任意外部长驻服务 |
| Room source of truth | Tobe DB + outbox + SSE | Redis Streams 做 wakeup | DSH/Letta/AG2 transcript |
| Room Session Host | Tobe 自有 host + Pi adapter | DSH pinned adapter；AG2 对照 | Next.js 请求对象 |
| Execution control plane | Tobe JobStore/Scheduler/Daemon protocol | Postgres 扩展、managed workers | Multica/OpenHands 内部状态 |
| Execution runtime | 开放 Runtime Registry + capability matcher + Generic CLI 基准 adapter | OpenHands 用于 repo/code；LangGraph 用于 workflow；团队自定义 Runtime | Room runtime 的 background job 或单一厂商引擎 |
| Git knowledge | Tobe GitWorktreePort + review | OpenHands worktree adapter | Agent 直接 push main |
| 搜索/上下文 | Tobe ContextManifest + provenance | 可替换全文/向量引擎 | provider 私有 memory |

### 11.9 开放 Runtime 注册与选择

Multica 最值得保留的不是其具体实现，而是“控制面不绑定某一个 Agent CLI/SDK”的产品方式。Tobe 将它提升为正式契约：

```ts
type RuntimeCapabilitiesV1 = {
  taskKinds: Array<'coding' | 'research' | 'browser' | 'document' | 'workflow'>;
  nativeResume: boolean;
  checkpoint: boolean;
  streaming: 'none' | 'text' | 'typed-events';
  interrupt: 'none' | 'process-kill' | 'graceful';
  workspace: 'none' | 'directory' | 'git-worktree';
  sandbox: 'host' | 'container' | 'vm' | 'remote';
  structuredArtifacts: boolean;
  waitingForHuman: boolean;
  supportedModels: string[];
};
```

Runtime 选择同时支持四种入口：

1. `auto`：按 Job 所需能力、组织安全策略、当前容量与健康度选择。
2. 用户显式选择：高级用户在创建 Job 时指定允许的 Runtime。
3. Agent Profile 偏好：为不同 Agent 配置 preferred/fallback Runtime，但不能越过组织策略。
4. 团队策略：管理员控制允许的 Runtime、部署位置、仓库权限、预算和是否允许 fallback。

匹配规则是：

```text
Job required capabilities
  ∩ organization policy
  ∩ explicit user choice / Agent preference
  ∩ live Runtime capacity and health
  -> selected Runtime
```

fallback 必须保持所有 required capabilities；不能因首选 Runtime 离线而降级到无 sandbox、不可恢复或无 Git 隔离的执行器。Runtime 只接收 attempt、上报事件/checkpoint/artifact，不得直接修改 Job、TeamTask、Room 或文档状态。

基础 `GenericCliExecutionRuntimeDriverV1` 的 descriptor 固定为 `workspace='none'`。只有 composition root
显式构造 `LocalGitWorktreePort + lifecycle coordinator` 的 deployment wrapper 才能提升为
`git-worktree`；wrapper 在缺少受信 workspace input 时 fail closed。Generic CLI 只接收 daemon 给出的
`file://` URI 和 frozen revision，并以其受管 mount path 为 child cwd；没有 wrapper 时继续使用受信配置
中的 cwd。strict daemon config 必须显式提供 managed root、commit author 和 enable 开关，缺一项就不得
注册 Git capability。

## 12. 安全、权限与租户边界

### 12.1 身份和能力

- 当前 Web MVP 没有 network identity provider：platform context 使用进程冻结的 trusted local
  organization/user/device，`x-dao-*` 只可作为受信 Web runtime 的 matching transport receipt，未知值
  fail closed，不能视为认证机制。Room 显式 receipt 也只能引用已存在且完整匹配的
  organization/user/membership/device tuple。
- production identity provider、server-side login/session/JWT 到 organization/user/roles 的映射、成员邀请/
  provisioning 和企业 SSO 属于部署或未来硬化范围，不是当前已交付能力。
- Agent 身份、配置和工具集均版本化；执行时绑定确切版本。
- 所有工具经过统一 Tool Gateway；策略按 organization、room、agent、job、resource 和 operation 判定。
- 浏览器永远拿不到 provider key、Git write credential、runtime server 高权限 token。
- “看到工具”不等于“有权限调用工具”；每次调用都重新校验资源 ACL。

### 12.2 执行隔离

- 当前 MVP 的 host execution 仅限受信本地部署；一 Job/attempt 一 container/VM/remote sandbox 是后续
  生产隔离硬化目标，不是当前已提供的多租户能力。
- 最小挂载，只暴露该 attempt 的 isolated workspace 和临时目录。
- 默认拒绝访问云 metadata、内网和任意出网；按 tool policy 开 allowlist。
- CPU、内存、磁盘、进程数、网络、时间和模型预算均设上限。
- secret 通过短期 capability 注入，不写 prompt、日志、artifact 或 Git。
- Runtime Daemon 与控制面双向认证；claim token 存 hash，定期轮换。

### 12.3 Prompt injection 和来源

- 系统规则、用户指令、检索资料、网页、文档和工具输出使用不同 content role/typed block。
- 外部内容永远是 data；其中的命令不得提升权限。
- 每个进入上下文的片段保留 source ref、版本、ACL decision 和 hash。
- 高风险动作（外发消息、写 Git、启动付费长任务、删除/发布）要求显式 capability 或人工批准。
- Agent-to-Agent 委派继承更窄权限，不自动继承发起 Agent 的所有 credential。

## 13. 容量、背压与可观测性

Room 与 Job 使用不同的容量策略：

### Room

- 每 session 有界 inbox，同时限制条数与字节数。
- mention 不静默丢弃：状态必须是 accepted、delayed 或 rejected_overload。
- Host 饱和时先冷却 LRU idle session，绝不杀 running session。
- Room 消息可以成功落库，即使某个 Agent 暂时限流；receipt 返回逐目标 admission 结果。
- token delta 可以在客户端落后时合并/丢弃，但 final message 和 tool/result event 必须可重放。

### Execution

- DB queue 是真实 backlog，不使用进程内 Promise/Map 当调度器。
- 按 organization、priority、runtime capability 和 Agent 设置公平并发配额。
- 超出 admission quota 时在创建前返回 `429 + Retry-After`；一旦 accepted 就不能丢 Job。
- workspace/build artifact 和审计 metadata 使用不同 retention。

统一 trace 维度：

```text
correlationId
  -> coordinatorRunId
  -> roomMessageId / deliveryId / roomSessionId
  -> teamTaskId / jobId / attemptId / generation
  -> contextManifestId / workspace / artifact / knowledgeChangeRequestId
```

分别统计：command acceptance、session dispatch、provider first token、完整 turn、queue wait、attempt runtime、recovery、context token 构成、检索命中和知识合并率。不要把模型首 token 延迟混入消息持久化 SLO。

## 14. 实施依赖顺序（状态见 active tracker）

以下 Phase 保留为架构依赖与验收顺序，不是实时进度表；已经落地的能力与最新门禁结论均以文件头所列
`SYSTEM.md` 和 active tracker 为准。

### Phase 0：冻结术语和契约

- 在 `SYSTEM.md` 定义 ProjectRoom、RoomAgentSession、RoomMessage、TeamTask、ExecutionJob、ExecutionAttempt、KnowledgeSpace。
- 明确 `RoomAgentSession != provider session`，`TeamTask != ExecutionJob`，`AssistantRun != Job`。
- 建立 command/event/receipt JSON Schema、版本策略和 contract tests。
- 为生产 adapter 与候选 adapter 分别声明真实 capability，不做虚假的万能 interface；OpenHands skeleton
  保持 `disabled/unavailable`，不能进入健康 Runtime 候选集。

### Phase 1：建立真正的 Project Room

- 首期可将现有 `Session.id` 迁移映射为 `roomId`，但新 API 不再暴露含混的 sessionId。
- 扩展 author、typed mentions、seq、causation、reply/focus refs。
- 新增 RoomAgentSession、Inbox、Event、DelegationGrant、Outbox。
- 实现 HTTP command + SSE replay/watermark。
- 把评论侧栏已有 Agent mention 逻辑收敛到同一 Room router。

### Phase 2：常驻 Room Session Host（DSH 仍为候选）

- 保留请求级协调 Pi；另提取专业 Agent 的 `RoomSessionRuntimePort`。
- 以 Pi room adapter 验证 durable inbox、single owner lease、generation fencing、warm TTL 和 fresh-replay。
- 把 `AssistantRun` 收窄成 Room turn/trace projection，不再承担长任务含义。
- DSH 只在后续评估中以 pinned adapter 做 shadow/canary，并运行相同 contract/latency/recovery suite。

### Phase 3：上下文子系统

- 实现 `RoomContextPort`、typed context blocks、token budgets、cursor-based delta。
- 为 Room、文档、知识建立权限感知搜索。
- 增加带 source range/hash 的 session summary。
- 实现 ContextManifest 和可重放的 context audit；移除默认全历史注入。

### Phase 4：Execution Control Plane

- 建立 Job、Attempt、Event、Artifact、RuntimeRegistration、Outbox 表。
- 收敛 submit/claim/heartbeat/checkpoint/complete/cancel/sweep 协议。
- 覆盖 stale lease、retry classifier、ambiguous side effect、waiting_input。
- Local 与 Managed Daemon 共享协议；开发期可同机部署，但代码和状态机仍分离。
- 先以独立进程和 Generic CLI 基准 adapter 跑通 dequeue、claim、heartbeat、fencing、shutdown 与
  crash recovery；命令、参数和环境只来自受信 daemon 配置，不能由 Job payload 覆盖。
- 允许 daemon 从部署方指定的绝对路径加载 contract-versioned `external-module` driver；factory export、
  runtime identity、descriptor shape 和 allowlisted environment 必须校验，加载或协议不匹配时启动失败。
- daemon 必须使用 Node/SSR 构建，禁止 React、Next.js client、`document/window` 或 public assets
  进入产物；测试必须直接启动构建后的 bundle，不能只 import TypeScript composition root。
- OpenHands repo-task 与 LangGraph workflow 只作为候选 POC；OpenHands 在具体协议验证完成前保持
  disabled/unavailable，不能伪造健康或成功执行。

### Phase 5：Chat -> Job -> Room 闭环

- 受治理的 `start_execution_job` 与“开始工作”入口直接提交 durable Job，不再只预填
  聊天 prompt。
- Job 进度以卡片投影到持久 Room/TaskActivity。
- 完成时通过 outbox 唤醒来源 Room Agent 总结，TeamTask 进入人工 review。

### Phase 6：Git 知识 review

- 建立 KnowledgeSpace/Binding/Snapshot/ChangeRequest 数据与审阅状态边界。
- 建立 per-attempt isolated clone/workspace、proposal branch、commit trailer 和 diff metadata；完整
  artifact/secrets scan 独立演进。
- admission 选择唯一合法 `KnowledgeBinding(access=propose)`，将 non-sensitive binding 和解析后的
  immutable `baseCommit` 冻结到 `ContextManifest.knowledgeCommit`；repo path/credential 保持 daemon 私有。
- `ExecutionAttempt.workspaceLifecycleJson` 不对普通 DTO/API 暴露；按 prepared、
  runtimeCompletion、finalized、changeRequestId、cleanedAt 单调推进，每次写入均受 generation/owner/lease
  fencing。terminal event 与 runtimeCompletion 原子提交，heartbeat 覆盖完整收尾。
- `prepareOrRecover/finalizeOrRecover/cleanupOrRecover` 使用 exact replay 与 phase-aware daemon recovery
  与 fenced/idempotent ChangeRequest upsert；真实 team/global-binding success+changed、prepared-clean
  crash/reclaim 和 running cancellation process E2E 已跑通；来源不明 dirty workspace 明确 fail closed。
- running cancellation 以 `cancel_requested` 保留 generation/lease/capacity，由 daemon
  interrupt、写 interrupted terminal、cleanup、complete，并允许 lease-expired reclaim 接手收尾。
- 基础 Generic CLI 始终保持 `workspace=none`；仅显式 composition wrapper 声明
  `workspace=git-worktree`。这是 capability 名；当前 local port 实际使用 isolated clone，不是 native
  registered worktree。cleanup 三个 crash stage 已覆盖，但来源不明 dirty workspace 仍不自动恢复。
- 人工 diff review、durable merge operation、独立 trusted worker 的 default-ref CAS、冲突/重试状态和
  operator UI 已接通。
- 普通知识索引的输入仅限 default branch 的 merged commit；index build 成功后才激活 ready snapshot，
  半成品或失败构建不得对普通 Agent 可见。

### Phase 7：后续扩展候选（不属于 MVP 验收）

- Postgres `SKIP LOCKED`、Redis Streams wakeup、多 Session Host/Daemon。
- 组织公平调度、容量预测、artifact lifecycle、备份恢复。
- production identity provider、login/session/JWT integration、成员邀请/provisioning 与企业 SSO。
- DSH/AG2/AgentScope 对照压测后决定是否扩大使用。
- 多租户 sandbox、网络 egress、审计和故障演练。

## 15. 验收标准与基准门槛

### 功能正确性

- 从空白目标创建 Project 后，协调 Agent 立即可用；用户不需要先选择 Agent。
- 同一 Room 可 `@` 一个或多个专业 Agent；每个 Agent 都收到可靠投递并产生可关联回复。
- Agent-to-Agent 邀请必须经结构化工具和 grant；“允许本次/本房间允许/撤销”完整可审计。
- 达到 hop/fan-out/turn budget 后产生可见 `delegation_blocked`。
- Agent 能按需检索历史；默认 prompt 不包含完整 Room 历史。
- 专业 Agent 文档修改进入 proposal；并发版本冲突不会覆盖团队最新内容。
- “开始工作”立即返回 Job receipt；关闭浏览器后继续执行。
- Job 成功形成 delivery/review，不能直接假定 TeamTask done。
- 每个声明 `workspace=git-worktree` 的 Job attempt 有独立 clone/workspace 和 proposal branch；基础
  Generic CLI 仍为 `workspace=none`。只有人工 merge 后知识才可被普通检索。

### 可靠性

- 对 accepted Room 消息做 Session Host kill/restart，零静默丢失；重复 wakeup 不产生重复最终回复。
- 同一 `(room, agent)` 的两个 Host 竞争时只有一个 generation 能写入。
- provider resume 失败时可从 Tobe event/summary fresh-replay。
- Worker 在 run、checkpoint、complete 前后分别 kill，Job 能恢复或进入明确需人工处理状态。
- stale attempt 的 heartbeat、artifact 和 completion 全部被拒绝。
- 在 prepare、terminal event、finalize、ChangeRequest、cleanup 后分别 kill daemon，新 generation 从
  durable receipt 的首个缺失阶段 exact replay；旧 generation 不能写 lifecycle/CR/cleaned/complete，
  non-resumable Runtime 不会在已有 `runtimeCompletion` 后重启。
- finalize、变更单与 cleanup 期间 heartbeat 持续；terminal event 与 runtimeCompletion 不出现半提交。
- cancel、runtime failed 和 success-but-unchanged 均不产生 ChangeRequest，但最终不遗留受管 isolated clone。
- SSE 断线后按 seq 重连，不丢 final event。
- 本地受信 repo 的 Git 基线变化、merge conflict、残留 workspace 与 recovery quarantine 都有自动化测试；
  这不扩展为远程 fetch/push 支持。

当前实现证据覆盖真实 team/global-binding success+changed、prepared-clean crash/reclaim、HTTP running cancel
联动 standalone daemon，以及 cleanup 前、Git cleanup 后、`cleanedAt` 持久化后三个 crash stage 的 reclaim。
来源不明 dirty-workspace content recovery 仍不在支持能力内；无法证明 exact replay 安全的状态必须 fail closed 并进入
durable quarantine，而不是自动提交、覆盖或无限 reclaim。完整门禁的最新结论不在本节维护。

### 延迟与容量（首期目标）

- Room command 持久化 ack p95 `<300ms`，与模型延迟分开统计。
- 热 session 从 accepted 到发起 provider request p95 `<500ms`。
- 冷 session 恢复额外开销 p95 `<2s`（不含 provider first token）。
- Job submit ack p95 `<300ms`；队列等待独立展示。
- 常驻 60 分钟 soak 中，session 内消息严格有序、内存无持续线性增长。
- 在固定模型/同一区域下比较 Pi 与 DSH：首 event、首 token、完整 turn、恢复延迟、CPU/内存、重复/丢失率。未通过 contract + soak 前，DSH 不进入默认路径。

### 上下文质量

- 每次模型调用能导出 context manifest/trace，100% 的检索片段有 source/version。
- Room 历史增长 10 倍时，常规 turn token 用量不随历史线性增长。
- 删除/撤权的文档不会继续通过 summary/vector cache 泄漏。
- Job 结果能报告其 Room watermark、文档版本和 knowledge commit；基线落后时 UI 明确提示。

### 工程边界

- 任何未来 DSH adapter 必须通过与 Pi 相同的 Room contract suite。
- 任何未来 Managed Daemon 必须与 Local Daemon 及其他 Job runtime adapter 通过同一 execution protocol suite。
- Coordinator、Room、Execution、Knowledge 模块可单独构建和测试；没有跨层 import 第三方 runtime 类型。
- Execution daemon composition 只依赖 Node-safe 精确入口；生产 bundle 无浏览器全局，并有直接执行 smoke test。
- 完成每个实现切片后运行项目完整门禁（当前为 `npm run verify:iteration`），并补充 crash/recovery/contract 测试。

## 16. 主要风险与控制

| 风险 | 后果 | 控制 |
|---|---|---|
| 把常驻 session 误做成无限历史 | 延迟/成本线性增长，旧事实污染 | cursor + bounded summary + 按需检索 + token budget |
| 第三方 runtime 成为事实源 | 升级锁死、数据不可迁移 | Tobe event/manifest 为权威，runtime 只做 adapter |
| Room 与 Job 状态混用 | 断线丢任务、错误重试 | 独立状态机、独立容量和 receipt |
| at-least-once 导致重复副作用 | 重复消息、重复外发/提交 | idempotency key、generation fencing、terminal completion receipt、人工处理 ambiguous |
| Agent 相互递归邀请 | 成本失控和消息风暴 | typed delegation、grant、hop/fan-out/turn budget |
| 未审知识污染所有 Agent | 错误永久扩散 | attempt branch、人工 merge、merged-only indexing |
| Git workspace 泄漏/冲突 | 数据互踩、磁盘耗尽 | attempt 专属 isolated clone、私有单调 lifecycle、exact replay、全程 heartbeat、cleanup-before-complete、quota/sweeper |
| 取消先清 lease 后留 workspace | 无 owner 可收尾，残留分支/目录 | 已改为 cancel_requested：保留 generation/lease/capacity，由 daemon interrupt/cleanup/complete；过期后可 reclaim |
| 把 clean reclaim 误报为 dirty recovery | 未提交修改来源不明，可能双写或错误接管 | dirty matching workspace fail closed；只对 durable receipt 与可证明的 clean/committed 阶段做 exact replay |
| runtime host 权限过大 | 租户逃逸、凭据泄漏 | per-job sandbox、最小挂载、egress 和短期凭据 |
| DSH/AG2 等快速 breaking change | 生产不稳定 | pin commit、adapter、contract/canary、可回退 Pi |
| Multica 许可证误用 | 商业与分发风险 | 只 clean-room 借鉴；不复制/嵌入，必要时法律审查 |

## 17. 最终决策清单

可以立即按以下决策推进。以下 `[x]` 只表示架构决策已冻结，不是实现完成清单；
实际落地状态以文件头所列 `SYSTEM.md` 和 active tracker 为准。

- [x] 产品采用“常驻会话 + 独立任务”。
- [x] 架构划分三个生命周期：请求协调、Room Session、Execution Job。
- [x] 现有 Next.js 请求内 Pi 保留为入口/协调 Agent。
- [x] Project Room 定为默认入口，并支持同时和多个 Agent 对话；Room persistence、Host、API、Pi adapter、
  bounded context 与 UI 已按该边界实现。
- [x] Room/文档/任务/权限由 Tobe 持有。
- [x] Tobe 自有轻量 Session Host 与 durable Execution Control Plane，二者保持独立进程与状态机边界。
- [x] Execution Plane 采用开放 Runtime Registry 和 capability-aware 选择，不绑定单一执行器。
- [x] DSH 仅作为 pin 版本的 Room 实验 adapter 候选，不作为 Job authority；adapter 尚未实现。
- [x] 基础 Generic CLI 是 `workspace=none` 的 daemon 基准 adapter；受信 `external-module` 是部署扩展机制；
  显式 deployment wrapper 才能组合 `git-worktree`。OpenHands 是 fail-closed 的 repo/code 候选，
  LangGraph 是 workflow 候选，并保留团队自定义 Runtime。
- [x] Multica 只做架构参考，不直接复用源码。
- [x] 上下文采用分层事实源、按需检索和不可变 ContextManifest。
- [x] Git 知识采用 frozen binding/base、per-attempt durable lifecycle、isolated clone/workspace、proposal branch、人工 review、
  trusted default-ref CAS merge 和 ready-only index publication。
- [x] Agent 不直接写主文档或知识主分支。

仍可通过真实用户测试调整、但不阻塞架构的默认参数：协调 Agent 的自动响应开关、warm TTL、最大委派跳数、每根消息 invocation 预算、Room inbox 配额和 Job admission quota。这些全部进入版本化 policy/config，不固化在某个 Agent prompt 或 SDK 中。

## 18. 调研来源（固定版本）

- [DeepSeek Harness @ `141eb6f`](https://github.com/deepseek-ai/deepseek-harness/tree/141eb6fef83422698aef7a981029e843e8161534)
- [Multica @ `3622db2`](https://github.com/multica-ai/multica/tree/3622db21cf90b87a75089f9444041fe8714fe1a6)
- [OpenHands Canvas @ `4a8cabc`](https://github.com/OpenHands/OpenHands/tree/4a8cabc5fdc81bb6d899785f33ea7449387beb4c)
- [OpenHands Software Agent SDK @ `1de2e6d`](https://github.com/OpenHands/software-agent-sdk/tree/1de2e6d1bfcf70c7c3d4eb13616811943f33dd75)
- [LangGraph @ `f09cfe8`](https://github.com/langchain-ai/langgraph/tree/f09cfe8ffc1eeffd68f4b628ed69c30f7cad229f)
- [Letta Code @ `0d245b4`](https://github.com/letta-ai/letta-code/tree/0d245b4fb8be8dc1ae0b550ae729ff9279f378fd)
- [AG2 @ `8ac1b1e`](https://github.com/ag2ai/ag2/tree/8ac1b1ec90170ca0208aa79928a09dc857cd73fd)
- [Microsoft AutoGen @ `027ecf0`](https://github.com/microsoft/autogen/tree/027ecf0a379bcc1d09956d46d12d44a3ad9cee14)
- [AgentScope 2.0 @ `ad4d283`](https://github.com/agentscope-ai/agentscope/tree/ad4d2839e8ad57b6b9dffa7b583be7bee33009fb)
