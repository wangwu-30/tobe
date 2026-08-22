# Agent Room 与持久执行落地追踪器

更新时间：2026-08-22
状态：paused handoff snapshot（未通过最终门禁）

交接入口：[2026-08-22 Web Agent Collaboration Handoff](./HANDOFF-2026-08-22.md)。当前快照保留了
未完成的 execution recovery 测试契约、Team Tasks UI 收口和 Room delegation 测试修复，且最新 TypeScript
门禁失败；不得把本页历史专项通过记录解读为当前 release-ready。

相关文档：[系统契约](../SYSTEM.md) · [产品 brief](./briefs/team-document-agent-marketplace.md) · [Runtime 调研](./agent-runtime-architecture-research.md)

## 当前范围

本 workstream 把 Web-only Project Room、团队文档、TeamTask、durable Execution Job、开放 Runtime 与
Git 知识库组成 `Room -> Job -> review -> trusted CAS merge -> ready knowledge` 闭环。Project Room 是默认
多 Agent 入口；Room Agent Session 负责低延迟连续协作，Execution Job 负责可脱离浏览器的排队、租约、
attempt、等待输入、取消与恢复，两者不共享状态机或容量。

代码与生产组合点已经覆盖 Room/API/Host/UI、bounded context、Execution 产品面、HTTP running cancel、
三段 cleanup crash recovery、durable quarantine/recovery UI、人工 review、trusted Git CAS merge 和
index-ready snapshot。tracker 当前暂停并交接，完成判定仍以本页交付矩阵、验收标准和 dated verification
record 为准，不能从“代码存在”或单个 targeted suite 推导完整门禁结论。

明确 non-goal：区块链栈；Postgres/Redis/多地域和容器级多租户硬化；语音视频；production identity
provider、登录/session/JWT integration、成员邀请/provisioning 与完整企业 SSO；
远程 Git credential/fetch/push 和子目录 mount；未经验证的 DSH/OpenHands/LangGraph 协议 adapter；
对来源不明 dirty workspace 的自动恢复。

## 已冻结决策

- 产品严格 Web-only；生产运行面是 Next.js Web 加 execution daemon、Room Session Host、knowledge merge
  worker 三个独立 Node 服务。
- team-mode schema、membership role 与 organization ACL 已实现；当前运行身份仍是进程冻结的 trusted local
  single-user principal。Web runtime identity header 只是 transport receipt，不是认证机制；Room 显式 receipt
  只能引用已存在且完整匹配的 organization/user/membership/device tuple。
- Project Room 是默认入口；请求级协调 Agent 与多个专业 Agent 可按 typed mention/reply routing 并行参与。
- 请求协调、Room Agent Session 与 Execution Job 是三个独立生命周期；`TeamTask != ExecutionJob`，
  `AssistantRun != ExecutionJob`。
- Execution admission 只接受经 membership ACL 授权的 trusted local principal 显式对齐的可见不可变版本；服务端冻结内容、文件 hash、revision
  与 ContextManifest，草稿、恢复点、prompt 或模型参数不能替代 `aligned` 事实。
- required-confirmation 工具在共享 policy wrapper fail closed。`start_execution_job` 使用专用 durable Room
  confirmation：冻结 actor/session/delivery/workspace/canonical parameters，由 owner 以 revision CAS 批准并
  exactly-once 创建 Job；它不是任意工具的通用 grant consumer。
- Room context 必须有 ACL recheck、provenance、trust、truncation trace 与显式 category/total budget；Room、
  文档和 ready knowledge 是事实源，summary/provider cache 可淘汰。
- 生产 Runtime extension 是 `generic-cli | external-module`。基础 Generic CLI 始终声明 `workspace=none`；
  `external-module` 只能从部署配置加载受信绝对本地模块并接收 allowlist 环境。OpenHands 保持
  disabled/offline/capacity zero，协议未验证时不能被 catalog upsert 伪装为健康 deployment。
- `git-worktree` 是 Runtime capability 名；当前 workspace 实现是 attempt 专属 isolated clone/workspace 与
  deterministic proposal branch，不是 Git registered worktree。只有显式组合 Git lifecycle 的 deployment
  才能发布该 capability，缺少受信 binding 时 admission fail closed。
- Agent 对知识库只有 read + propose；只有人工 review 后的 trusted merge worker 能重验 proposal/default
  ref 与 patch hash，以 expected-old CAS 更新默认分支，并在索引成功后激活 `ready` snapshot。
- dirty/partial/drifted workspace 不做猜测性恢复；系统持久化 quarantine，释放精确 capacity，并向满足
  owner/admin role ACL 的当前 trusted local principal 提供 inspect/retry/verified-discard UI 与审计历史。
- 本地 SQLite bootstrap 强制并校验 WAL；Web 与三个独立 Node 服务统一从 shared Prisma client 取得
  safe local libSQL adapter。
  adapter 对本地连接设置 busy timeout、串行化访问并确保 terminal transaction cleanup；明确识别的
  `SQLITE_BUSY` 只在可幂等重放的完整 durable command 边界做有限重试。

## 当前实现事实

### Identity 与 organization ACL

- 当前产品没有 network identity provider，也不提供登录、成员邀请或 provisioning。默认 platform context
  来自进程冻结的 local organization/user/device；不匹配该 tuple 的 runtime receipt fail closed。
- organization、user、membership、role、device schema 与资源 ACL 是 team-mode contract，能够约束 Room、
  Execution、Task 与 Knowledge 的组织边界；这不构成 production multi-user identity 的交付声明。
- production IdP、服务端 login/session/JWT 映射与完整企业 SSO 属于部署或未来范围，不能用当前 ACL 测试、
  header resolver 或 seeded membership 代替其验收证据。

### Project Room 与 bounded context

- 工作区默认 assistant route 是 Room；缺失或非法 tab canonicalize 回 Room。Project-scoped default Room、
  durable HTTP `202` message acceptance、replayable SSE、grant 与 tool-confirmation API 已接入。
- atomic router 为每个被 mention 的 Agent 创建 delivery，reply 可定向原 Agent；同一 session FIFO，跨 session
  可并行。独立 Session Host 使用 Prisma store、production context source 和 Pi runtime composition，并支持
  lease reclaim/restart。
- Room UI 包含 durable feed、composer、typed mentions、presence/activity、delegation grants 和 confirmation UI。
- Context builder 对 message/summary/document/retrieval 使用稳定顺序与显式预算，记录 ACL/provenance/trust/
  truncation；production source 重验 live lease、Agent enabled、项目/文档可见性、knowledge binding 与 ready
  snapshot digest。Host 当前通过 compatibility bridge 把 rich blocks 送入 Runtime，runtime wire contract
  本身不宣称已原生承载全部 metadata。

### Execution 与恢复

- Job list/detail 与 events/logs/artifacts read model、waiting-input answer/resume、cancel 和 recovery API/UI 已接入。
- `start_execution_job` durable confirmation 只能使用已存 canonical parameters；篡改、过期、changed-binding、
  concurrent approval 均 fail closed，成功审批记录唯一 Job receipt 与 Room origin。
- running HTTP cancel 经正式 route 写入 recoverable `cancel_requested`，standalone daemon heartbeat 观察后
  interrupt Runtime，原子写 interrupted terminal + `runtimeCompletion(cancelled)`，cleanup 后才 complete、清 lease
  并释放一次 capacity。waiting-input cancel 同时取消 pending input，并由 maintenance claim 收口。
- workspace receipt 按 `binding+prepared -> runtimeCompletion -> finalized -> changeRequestId -> cleanedAt` 单调追加。
  daemon 在 before-workspace-cleanup、after-workspace-cleanup、after-cleaned-lifecycle-persist 三个 crash window
  都能按首个缺失阶段 reclaim；已有 durable completion 时不得重启 non-resumable Runtime。
- unknown dirty/partial state 进入 durable quarantine；满足 owner/admin role ACL 的当前 trusted local principal
  可 inspect、retry 或只在验证安全时确认 discard，所有动作保留审计记录。系统不承诺重建或自动挽救未知
  未提交修改。
  本文沿用 `workspace` 作为 lifecycle 通称：当前 Git port 实际创建 `git clone --no-hardlinks` 的 attempt
  专属 isolated clone，移除 origin 后 checkout deterministic proposal branch；它不是 `git worktree add`
  产生的 registered worktree。

### Knowledge review 与 ready snapshot

- admission 冻结非敏感 binding/base commit；repo path 和 credential 只由 daemon 按 frozen `bindingId` 重验后
  私下取得，不进入 ContextManifest、Runtime descriptor、event 或公开 DTO。
- success+changed 产生唯一 pending-review ChangeRequest；failed/cancelled/unchanged 不产生，所有路径 cleanup
  后才 complete。proposal workspace 清理，proposal ref 保留，未经审阅时 default branch 不变。
- Review API/UI 展示真实 Git diff 并记录人工决定。独立 merge worker 校验 authority、proposal ref、default ref
  和 canonical patch hash，执行 `git update-ref <default> <head> <base>`，并持久化 merge operation。
- 索引从 immutable tree 构建 byte-stable artifact；失败不移动 active pointer，retry 可继续，只有 build 完成并
  原子激活的 `ready` snapshot 才进入普通 Room retrieval。

## 完整落地交付矩阵

| 主链路 | 生产事实 | Web 产品面 | 验证证据组成 | 当前基线 |
|---|---|---|---|---|
| Project Room | persistence、atomic router、HTTP/SSE、独立 Host、Pi adapter | 默认 Room、typed mention、grants、confirmation、activity | team-mode ACL、local-principal fail-closed、FIFO/并行、双 Host、kill/restart、SSE replay、browser journey | 生产组合已接入；不代表 production multi-user identity |
| Bounded context | budgeted builder、Prisma source、ACL/ready-snapshot recheck | Room feed 使用受限上下文 | 10x 历史非线性增长、summary/ACL/config invalidation、tamper/revocation | V1 生产集成；rich metadata 经 compatibility bridge |
| Execution product | read models、input/resume、completion projection、HTTP cancel | Job list/detail/log/artifact/input/cancel/recovery | route + standalone daemon、waiting-input、terminal projection、browser UI | 生产组合已接入 |
| Knowledge review | review API、trusted worker、Git CAS、index builder、ready activation | configuration、diff、review、merge/conflict/index 状态 | same-base conflict、replay、index fail/retry、execution-to-ready browser path | 生产闭环已接入 |
| Recovery | durable incident、capacity release、inspect/retry/discard commands | Job-detail recovery panel 与 audit history | dirty/partial fail-closed、owner/admin policy、verified discard、三 cleanup crash stages | 生产组合已接入 |
| SQLite durability | WAL bootstrap、safe Prisma/libSQL adapter、bounded busy retry | 无独立产品入口 | WAL assertion、bootstrap/script contracts、Room/daemon/merge-worker concurrency paths | 单机 SQLite 边界已接入；不代表多节点数据库能力 |
| Delivery gate | deterministic inventory、三个 Node build/suites、Web build、browser preflight | production browser E2E | static + control-plane + bootstrap + build + preflight + E2E | 以最新 dated verification record 为准 |

任何一行都必须同时具备代码、production composition 与相应测试证据；完整交付结论还必须来自同一次
`npm run verify:iteration`。targeted test、历史记录或 browser spec 的存在不能替代该结论。

## 验收标准

- 新建/打开项目默认进入 Project Room；typed mentions 能原子路由多个 Agent，accepted 消息不依赖浏览器连接。
- Room Session 与 durable Job 的身份、lease、capacity 和 recovery 保持隔离；Room 发起 Job 必须经过 durable
  confirmation，并保留 Room/message origin。
- Job admission 拒绝未对齐或不可见版本；Runtime 只收到服务端冻结的 immutable context 和非敏感 binding。
- 10x Room 历史不使 context 线性增长；ACL/config/summary/knowledge 撤权或篡改后不得泄漏缓存内容。
- Generic CLI 与 trusted `external-module` 可由 production daemon 配置；OpenHands 保持不可调度并 fail closed。
- running cancel 从真实 HTTP route 到 standalone daemon 完成 interrupt/terminal/cleanup；三个 cleanup crash
  stage reclaim 均不重复 Runtime terminal、proposal commit 或 ChangeRequest。
- matching dirty/partial workspace 进入 durable quarantine；unsafe discard 不可用，人工动作受 owner/admin role
  ACL 和显式确认约束；当前 actor 是满足该 ACL 的 trusted local principal。
- success+changed 只产生 proposal；人工 review 后 trusted worker 以 real default-ref CAS 合入，index 失败不
  激活 snapshot，只有 ready snapshot 对普通 Agent 可见。
- SQLite bootstrap 实际返回 `journal_mode=wal`；safe adapter 在 commit 失败等 terminal path 释放 native
  transaction，busy contention 的 bounded retry 不吞掉 lease/CAS conflict 或其他数据库错误。
- `npm run test:control-plane` 构建并测试 execution daemon、Room Session Host、knowledge merge worker；
  `npm run verify:iteration` 还必须完成 production Web build、browser preflight 与完整 browser E2E。

## Prompt-to-artifact checklist

- **Prompt**：写清用户可见结果、supported boundary 与 non-goal。
- **Contract**：定位 schema/migration、版本化 command/event/receipt、ACL 与不变量。
- **Production path**：定位真实 API、worker/host composition root、Runtime extension 和 Web surface。
- **Tests**：覆盖 unit/persistence/process/browser，并让每个 `*.test.ts` 在 inventory 中恰好匹配一次。
- **Gate**：按 static → control-plane → bootstrap → production build → browser preflight → browser E2E 执行。
- **Tracker**：只按 repository facts 更新矩阵，区分 code、composition、targeted test 与 full gate。
- **Artifacts**：记录隔离 app-data、logs/report/trace 路径；dated record 写明命令、精确结果和环境边界。

## 历史验证记录

以下是各次运行当时的原始快照；保留其数字和边界，不把它们外推为当前代码或本轮完整门禁结果。

- 2026-08-21：底层/daemon 当前专项通过：daemon `35/35`、Git `16/16`、coordinator `15/15`、
  lifecycle `4/4`、execution-job `22/22`、knowledge `8 + 6`、runtime `16`、Room contract/policy `6`，
  driver suites 通过；Node-only bundle 修复后完整 execution-daemon suite `14/14`。
- 2026-08-21：真实 team/global-binding Git success+changed、prepared-clean process reclaim 与 running
  cancellation 已跑通。取消测试覆盖 durable CAS 后的 daemon 路径，不是 HTTP route E2E；不得据此
  宣称 dirty-workspace crash recovery、cleanup-stage crash recovery 或整个 Room workstream 完成。
- 2026-08-21：完整 `npm run verify:iteration` 的 Prisma generate、Next typegen、TypeScript、ESLint、所有
  migration、production Next build 均通过；E2E `30 passed / 69 environment-blocked`。69 条失败均为
  Chromium 启动缺少 `libgbm.so.1`，未进入产品断言；Execution control-plane production API `11/11`
  通过。完整门禁因此仍未通过，需在具备 Playwright 系统依赖的环境重跑。

## 本轮最终 gate 记录

由本轮最终 gate 补录：在同一条 `npm run verify:iteration` 实际结束后记录时间、命令、各阶段精确结果、
失败边界与 artifact 路径。在补录前，本节不产生新的 pass/fail 结论，以上历史快照也不代表当前工作树。
