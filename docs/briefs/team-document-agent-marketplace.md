# 团队文档与 Agent 任务协作

更新时间：2026-08-21

## 现状

- `tobe` 是严格 Web-only 的团队文档工作区。Next.js Web 之外有三个独立 Node 服务：execution daemon、
  Room Session Host 与 knowledge merge worker；没有 desktop/Electron 产品运行时。
- Project Room 是工作区默认多 Agent 入口。持久 Room/message/session/inbox/event/outbox/grant、typed mention
  routing、HTTP/SSE、独立 Session Host、Pi adapter、Room UI 与 durable tool confirmation 已接入生产组合。
- Room Agent Session 与 Execution Job 是独立生命周期：前者负责低延迟连续协作，后者负责可脱离浏览器的
  queue、attempt、lease、waiting-input、cancel、checkpoint 与 recovery。
- bounded context 以显式 category/total budget 组装 message/summary/document/ready-knowledge block，保留 ACL、
  provenance、trust 与 truncation trace，并在 production source 重验 lease、Agent、文档和 knowledge binding。
- Execution 产品面包含 list/detail、events/logs/artifacts、waiting-input/resume、HTTP cancel、Room/Task 回流和
  durable quarantine/recovery UI。running cancel 已有真实 HTTP route + standalone daemon 路径。
- 知识变更使用 attempt 专属 isolated Git workspace/proposal branch。人工 review 后，独立 trusted worker
  执行 default-ref expected-old CAS，构建确定性索引，并只在 snapshot `ready` 后激活普通检索。
- 本地 SQLite bootstrap 强制 WAL；应用与三个 Node 服务共用 safe Prisma/libSQL adapter。busy timeout、
  连接级串行化、terminal transaction cleanup 与幂等 durable command 的有限 busy retry 只服务单机并发，
  不等于 Postgres/多节点调度能力。
- `AgentProfile / TeamTask / TaskActivity` 与 Execution/Room/Knowledge 对象按组织隔离。`agent-market` 的任务、
  接单、交付语义仅作参考；钱包、EIP-712、USDC、链上合约、RPC 与 IPFS 不进入产品。
- team-mode organization/user/membership/device schema、membership role 与 organization ACL 已接入，但当前
  Web MVP 的 actor 是进程冻结的 trusted local single-user principal。identity header 只是受信 Web runtime
  的 transport receipt，不是认证机制；本产品当前没有 production IdP、登录/session/JWT integration、成员
  邀请/provisioning 或企业 SSO。

## 目标

以团队文档和 Project Room 为产品事实源，把内容对齐、多 Agent 协作、独立执行和人工审阅放在同一个
Web 工作区。用户从显式对齐的可见不可变文档版本出发，在 Room 中与协调 Agent/专业 Agent 协作；需要
离线或高隔离执行时创建 durable Job；执行结果回到来源 Room/TeamTask；知识变更只有经人工 review、
trusted CAS merge 和 ready index activation 后才进入普通 Agent 上下文。

核心闭环：

`aligned immutable version -> Project Room -> durable Job -> proposal -> human review -> trusted CAS merge -> ready snapshot`

## 关键边界

1. **对齐与 admission**
   - 只有满足 membership ACL 的 trusted local principal 能对齐属于当前组织/工作区的 visible immutable
     `milestone | head` 版本。
   - 同一版本最多一个活动 `aligned` 标签；Execution admission 拒绝未对齐、不可见或漂移的版本。
   - 服务端从 admitted version 冻结内容、文件 hash、revision、Room watermark 与非敏感 knowledge binding；
     客户端、模型和 Runtime 不能直接提交 ContextManifest 或组织 Runtime policy。
2. **Room 与 Job 分离**
   - durable Room message accepted 后不依赖原 HTTP 连接；multi-Agent routing 为每个目标 Agent 创建 delivery。
   - Room session 使用 per-session FIFO 与 lease/reclaim；Job 使用独立 queue/attempt/generation/capacity。
   - `publish_team_task` 与 `start_execution_job` 是两个工具。后者在 shared policy wrapper fail closed，并使用
     专用 durable confirmation request/approval command exactly-once 创建 Job。
3. **有界上下文**
   - Room/文档/ready knowledge 是权威事实；summary/provider cache 可淘汰。
   - 每个 block 带 ACL decision、provenance、trust 与 truncation；撤权、config 变化或 digest 篡改必须失效。
   - 当前 Host 通过 compatibility bridge 将 rich blocks 送入 Runtime，不把这一点表述为 native wire support。
4. **开放 Runtime**
   - production daemon 支持 `generic-cli | external-module`。Generic CLI 无 shell 执行部署方 binary，基础能力
     为 `workspace=none`；`external-module` 只能从部署配置中的受信绝对本地路径加载，只收到 allowlist 环境。
   - 两者都可由 deployment 显式组合 Git lifecycle wrapper 后发布 `workspace=git-worktree` capability。
   - OpenHands 是 disabled/offline/capacity-zero skeleton；在协议验证前所有操作 fail closed，不发送 HTTP。
5. **Git proposal 与 trusted merge**
   - `git-worktree` 是 capability 名；当前实现是 attempt 专属 isolated clone/workspace 与 deterministic proposal
     branch，而不是 Git registered worktree。repo path/credential 不进入 manifest、Runtime 或公开 DTO。
   - private receipt 只能按 `prepared -> runtimeCompletion -> finalized -> changeRequestId -> cleanedAt` 单调追加，
     每阶段受 generation/lease fencing；exact replay 成功，同阶段不同内容 conflict。
   - Agent 只有 read + propose。trusted worker 重验 authority、proposal/default ref 和 patch hash，执行
     `git update-ref <default> <head> <base>`；index build 失败不移动 active pointer。
6. **取消与恢复**
   - running HTTP cancel 保留 attempt generation/lease/capacity，daemon interrupt 后原子持久化 cancelled terminal，
     cleanup 后才 complete/清 lease/释放 capacity；waiting-input cancel 同时取消 pending input。
   - before-workspace-cleanup、after-workspace-cleanup、after-`cleanedAt` persistence 三个 crash stage 均按 durable
     receipt reclaim，不重复 Runtime terminal、proposal commit 或 ChangeRequest。
   - dirty/partial/drifted 状态进入 durable quarantine；满足 owner/admin role ACL 的当前 trusted local principal
     可 inspect/retry/verified-discard。系统不自动恢复未知未提交修改，unsafe discard 保持禁用。
7. **本地数据库并发边界**
   - bootstrap 必须取得并验证 `journal_mode=wal`，连接设置 `busy_timeout` 与 foreign keys。
   - local-file Prisma 统一走 safe libSQL adapter；commit 失败等 terminal path 必须 rollback/close 并释放连接队列。
   - 仅对已识别的 `SQLITE_BUSY` 重放输入不变的完整 durable command；lease/CAS conflict 和其他错误原样失败。
8. **身份与部署边界**
   - Room 显式 identity receipt 只可引用数据库中已存在且完整匹配的
     organization/user/membership/device tuple；该 resolver 不提供认证、登录或邀请流程。
   - production identity provider、server-side login/session/JWT mapping、成员邀请/provisioning 与完整企业
     SSO 是部署或未来范围；team-mode 对象和 ACL 不能被外推为这些能力已经交付。
9. **Git 非目标**
   - 当前只支持受信本地 repository root binding；remote Git credential/fetch/push 与 monorepo subpath mount
     是明确 non-goal。

## Web 产品验收

- 新建或打开项目默认显示 Project Room；非法/缺失 assistant tab 回到 Room。
- 用户可直接 mention 多个 Agent、查看 durable feed/activity、管理 delegation grant，并审批或拒绝待确认 Job。
- 文档执行入口要求先选择并对齐 visible immutable version；Job receipt 保留来源 Room/message。
- `/tasks` 支持发布、领取、交付、审阅和合法状态流转；`/jobs` 支持筛选、详情、events、logs、artifacts、
  waiting-input、cancel 与 recovery；`/knowledge` 支持配置、真实 diff、review、merge/conflict/index 状态。
- Room/Job/Knowledge 所有读取与写入按 organization ACL 隔离；客户端组织标识不能覆盖 trusted local
  platform context。这验证 team-mode authorization contract，不代表 production multi-user login 已交付。
- 未审 proposal 不进入默认分支或普通检索；index failure 不发布 snapshot；只有 `ready` snapshot 可检索。
- 新主链路不要求区块链网络、钱包、代币、合约地址或 CID。

## 门禁组成

`npm run verify:iteration` 的权威顺序是：

1. static：Prisma generate、Next typegen、TypeScript、ESLint；
2. control-plane：确定性 inventory、script contracts、三个 Node service build 与全部配置化 suite；
3. 隔离数据库 bootstrap；
4. production Web build；
5. Chromium shared-library preflight；
6. production browser E2E。

代码存在、production composition、targeted test 与完整门禁是不同证据。特定运行的 pass/fail 与精确数字
只追加到 active tracker 的 dated verification record；本文不把历史数字或 spec 存在外推为当前全绿。
本轮完整结论由本轮最终 gate 补录，补录前不预设成功。
