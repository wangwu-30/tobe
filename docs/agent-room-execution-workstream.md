# Agent Room 与持久执行落地追踪器（历史基线）

更新时间：2026-08-23（closure commit 推送前）
历史 workstream 状态：implementation、四项终审 blocker、产品验收与 Project Room 对比度竞态修复已完成；精确 closure commit 门禁待执行

> **当前 workstream（2026-08-23）**：产品入口已转向 [一人 AI Wiki](./briefs/one-person-ai-wiki.md)。
> 当前契约是 Home Chat 默认、普通对话不创建空 Wiki Space、human owner 显式确认后由 canonical
> Wiki Space root 接管同一 Session；Wiki Space 是 canonical Project root facade，Page 是 Document
> facade。Room、Agents、Team Tasks、Execution Jobs 与 Git Knowledge 变为 Advanced 能力，且 Git
> `KnowledgeSpace` 不等于 Wiki Space。本文后续的 “Project Room default” 均为 2026-08-22/23 已交付
> 基线的历史事实，不是当前产品默认入口；其 gate 数字只证明当时精确 tree。Wiki-first 行为完成度与
> 验证结果必须另增 dated record，不能复用本文历史 PASS。
> 当前 Wiki-first gate：**待 root/main workstream 最终填写**；本文没有为当前文档、文案或行为树虚构 PASS。

交接入口：[2026-08-22 Web Agent Collaboration Handoff](./HANDOFF-2026-08-22.md)。原快照中的
execution recovery 测试契约、Team Tasks UI 和 Room delegation 测试 blocker 已关闭，后续四项终审 blocker
也已完成代码修复并纳入 01:51 结束的 post-fix 完整门禁。01:15、01:51 与 02:05 的门禁仍只证明各自
fingerprint；之后发现并修复了 Project Room disabled-to-enabled opacity 对比度竞态。修复后的完整门禁于
11:51 通过。当前用户已授权 commit/push handoff 分支，但未授权创建 PR 或 merge；推送前必须让精确、
clean 的 closure commit 再次通过同一完整门禁，本地 gate PASS 也不等于 release。

相关文档：[系统契约](../SYSTEM.md) · [产品 brief](./briefs/team-document-agent-marketplace.md) · [Runtime 调研](./agent-runtime-architecture-research.md)

## 历史 workstream 范围

本历史 workstream 把 Web-only Project Room、团队文档、TeamTask、durable Execution Job、开放 Runtime 与
Git 知识库组成 `Room -> Job -> review -> trusted CAS merge -> ready knowledge` 闭环。在该历史基线中，
Project Room 是默认多 Agent 入口；Room Agent Session 负责低延迟连续协作，Execution Job 负责可脱离浏览器的排队、租约、
attempt、等待输入、取消与恢复，两者不共享状态机或容量。

代码与生产组合点已经覆盖 Room/API/Host/UI、bounded context、Execution 产品面、HTTP running cancel、
三段 cleanup crash recovery、durable quarantine/recovery UI、人工 review、trusted Git CAS merge 和
index-ready snapshot。implementation scope 与 review-blocker 修复已完成，post-fix 完整 gate 已通过；delivery
closure 取决于文档冻结后的同树复跑。结论必须区分 implementation、产品验收、历史 gate、post-fix gate 和
待确认的最终冻结树证据，并且不外推为
production multi-user identity、多节点数据库或未实现 adapter 的交付。

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
- **历史基线决策**：Project Room 是当时的默认入口；请求级协调 Agent 与多个专业 Agent 可按 typed
  mention/reply routing 并行参与。当前 Wiki-first workstream 保留该能力，但只从 Advanced 进入。
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
- Web Interface Guidelines review 是 repo-local skill；可静态确定的高置信反模式由同树 scanner fail closed，
  动态 accessibility、contrast、overflow 与完整交互继续由 axe、真实 Chromium 和人工 review 验证。
- 已发布 migration 不回写。Canvas 缺表通过 forward migration 补齐，bootstrap 验证 exact columns、named
  indexes、uniqueness 与 foreign-key actions，partial/lookalike schema fail closed。
- Agent proposal 与 comment-source apply 共用 staged-change review/apply seam。comment apply 的 proposal、
  checkpoint、file/document CAS 与 thread transition 必须处于同一个事务。
- prior-draft/inherited comment 只有 review-context authority；source mutation authority 只属于 exact current
  draft、open、同 source file 且 workspace/file/thread revisions 全部匹配的 thread。

## 当前实现事实

### Identity 与 organization ACL

- 当前产品没有 network identity provider，也不提供登录、成员邀请或 provisioning。默认 platform context
  来自进程冻结的 local organization/user/device；不匹配该 tuple 的 runtime receipt fail closed。
- organization、user、membership、role、device schema 与资源 ACL 是 team-mode contract，能够约束 Room、
  Execution、Task 与 Knowledge 的组织边界；这不构成 production multi-user identity 的交付声明。
- production IdP、服务端 login/session/JWT 映射与完整企业 SSO 属于部署或未来范围，不能用当前 ACL 测试、
  header resolver 或 seeded membership 代替其验收证据。

### Project Room 与 bounded context（历史默认入口实现）

- 在该历史基线中，工作区默认 assistant route 是 Room；缺失或非法 tab canonicalize 回 Room。Project-scoped default Room、
  durable HTTP `202` message acceptance、replayable SSE、grant 与 tool-confirmation API 已接入。
- atomic router 为每个被 mention 的 Agent 创建 delivery，reply 可定向原 Agent；同一 session FIFO，跨 session
  可并行。独立 Session Host 使用 Prisma store、production context source 和 Pi runtime composition，并支持
  lease reclaim/restart。
- Room UI 包含 durable feed、composer、typed mentions、presence/activity、delegation grants 和 confirmation UI。
- Context builder 对 message/summary/document/retrieval 使用稳定顺序与显式预算，记录 ACL/provenance/trust/
  truncation；production source 重验 live lease、Agent enabled、项目/文档可见性、knowledge binding 与 ready
  snapshot digest。Host 当前通过 compatibility bridge 把 rich blocks 送入 Runtime，runtime wire contract
  本身不宣称已原生承载全部 metadata。
- 真实双 Host 子进程证据覆盖同 delivery 单响应、delegation exactly-once、winner crash 后 source reclaim
  且 target 不重投、duplicate invocation durable block，以及跨 session 并行和单 session FIFO。
- Pi production Room tools 从 live session lease 解析 `workerId + generation` source fence；该 authority
  不扩展到 durable Execution、文档 apply 或 knowledge merge。

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
- production-required recovery port 已同步到 daemon/coordinator/store test composition；验证覆盖 inspect、
  exact durable receipt recovery、mismatched recovered receipt fail closed 与 quarantined discard forwarding。

### Document proposal、comment apply 与 lineage

- Agent proposal 只记录 pending review，不修改 live draft。
- Human apply 对 multi-file update/create/delete、checkpoint、Document/WorkspaceFile revisions 和 proposal
  transition 使用单事务 CAS；late failure 全量 rollback。
- comment-source apply 在同一事务内创建并应用 canonical staged change、生成 recovery checkpoint、推进
  draft/file revisions 并迁移 thread；workspace/file/thread drift 均无副作用 conflict。mirror refresh 是 commit 后
  best-effort projection，不包含在数据库原子性声明中。
- direct draft comments 只查询 exact current revision；较早 active unbound drafts 作为 inherited candidates，
  按 draft revision 新到旧排序并排在 formal version lineage 前。
- snapshot 绑定 `draftRevision <= snapshotRevision` 的 active unbound threads；future/resolved threads 不动。
  lineage 缺失或循环 fail closed，兄弟分支不泄漏。checkpoint 和正式版本使用当前 formal draft base 作为 parent，
  不以最近创建版本替代 lineage。
- inherited thread 可以作为 actionable/stale/superseded review context 展示，但不能直接取得 source mutation authority。

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
| Project Room（历史默认入口，当前 Advanced） | persistence、atomic router、HTTP/SSE、独立 Host、Pi adapter | 历史默认 Room、typed mention、grants、confirmation、activity | team-mode ACL、local-principal fail-closed、FIFO/并行、双 Host、kill/restart、SSE replay、browser journey | 生产组合已接入；不代表 production multi-user identity |
| Bounded context | budgeted builder、Prisma source、ACL/ready-snapshot recheck | Room feed 使用受限上下文 | 10x 历史非线性增长、summary/ACL/config invalidation、tamper/revocation | V1 生产集成；rich metadata 经 compatibility bridge |
| Execution product | read models、input/resume、completion projection、HTTP cancel | Job list/detail/log/artifact/input/cancel/recovery | route + standalone daemon、waiting-input、terminal projection、browser UI | 生产组合已接入 |
| Knowledge review | review API、trusted worker、Git CAS、index builder、ready activation | configuration、diff、review、merge/conflict/index 状态 | same-base conflict、replay、index fail/retry、execution-to-ready browser path | 生产闭环已接入 |
| Recovery | durable incident、capacity release、inspect/retry/discard commands | Job-detail recovery panel 与 audit history | dirty/partial fail-closed、owner/admin policy、verified discard、三 cleanup crash stages | 生产组合已接入 |
| SQLite durability | WAL bootstrap、safe Prisma/libSQL adapter、bounded busy retry | 无独立产品入口 | WAL assertion、bootstrap/script contracts、Room/daemon/merge-worker concurrency paths | 单机 SQLite 边界已接入；不代表多节点数据库能力 |
| Document review | proposal-only append、atomic staged apply、comment-source same-transaction apply、formal lineage binding | diff/review/apply 与 inherited review context | multi-file/CAS/rollback/delete/replay/prior-draft/branch browser | 生产闭环、专项证据与 11:51 完整 gate 已完成；精确 closure commit 待复跑 |
| Web guideline governance | repo-local skill、deterministic scanner、fail-closed static ordering | audited Web surfaces | scanner contracts + axe + real Chromium + manual boundary | 项目级 skill/scanner/浏览器证据已纳入 11:51 gate；对比度竞态已修复；不宣称完整 compliance |
| Delivery gate | deterministic inventory、三个 Node build/suites、Web build、browser preflight | production browser E2E | static + control-plane + bootstrap + build + preflight + E2E | 01:15/01:51/02:05 为历史 PASS；11:51 stabilization gate PASS；精确 clean closure commit 待复跑 |

任何一行都必须同时具备代码、production composition 与相应测试证据；完整交付结论还必须来自同一次
`npm run verify:iteration`。targeted test、历史记录或 browser spec 的存在不能替代该结论。

## 历史 workstream 验收标准

- 历史基线要求新建/打开项目默认进入 Project Room；typed mentions 能原子路由多个 Agent，accepted
  消息不依赖浏览器连接。当前产品入口以一人 AI Wiki brief 为准，Room routing 能力保留在 Advanced。
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
- Canvas forward migration `20260822010000_add_canvas_tables` 能从 legacy canvas metadata 向前补齐
  `NodeRelation` / `ProjectCanvasLayout`，并覆盖 partial schema fail-closed 与 successful second-run inert。
- 真实尾部 `@` mention overlay 在编辑器末端仍保持可见、可定位和可操作。
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

### 15 requirements pre-push status（历史 Project Room workstream）

Items 1-14 describe implemented scope and accumulated evidence. The 11:51 accessibility-stabilized gate covers them;
item 15 becomes final local delivery evidence only after the exact clean closure commit passes without later tree edits.

1. **Web-only、team-first、Project Room default（历史默认入口）**：production build 与 home/workspace Chromium journey 通过。
2. **Initial goal 是第一条 human Room message**：workspace create API、persistence 与 browser assertion 纳入完整门禁。
3. **Host default 与 typed mentions/replies**：atomic router、raw `@text` boundary、Room persistence/process/browser 通过。
4. **Room Session 与 durable Job 生命周期分离**：独立 Host/daemon、live Room source fence、process restart evidence 通过。
5. **Bounded ACL/provenance-aware context**：预算、排序、撤权/篡改/invalidation evidence 通过；rich metadata 仍经 compatibility bridge。
6. **Immutable visible alignment gates Jobs**：admission 与 atomicity evidence 通过，draft/prompt 不替代 aligned fact。
7. **Open runtime 与 OpenHands fail-closed**：`generic-cli | external-module` production seam 通过；OpenHands 仍 disabled/offline/capacity-zero。
8. **Per-attempt isolated Git workspace**：real lifecycle、dirty/quarantine 与 exact-receipt recovery evidence 通过。
9. **Agent/team knowledge 与 human-only merge**：real diff、CAS、index retry、ready snapshot evidence 通过。
10. **Agent proposal 与 human atomic apply**：proposal non-mutation、multi-file/delete/replay、comment apply、checkpoint、CAS 和 injected rollback 通过。
11. **Durable delegation expiry/replay/fencing/budgets**：two-Host race、winner crash/restart、duplicate block、parallel/FIFO 通过。
12. **Job success 只把 TeamTask 推到 review**：projection、rollback/idempotency 与 UI journey 通过。
13. **SQLite durability**：WAL、terminal cleanup、second writer 与 Canvas forward migration/bootstrap evidence 通过。
14. **Web Interface Guidelines governance**：repo-local skill、fail-closed scanner、axe 和 real Chromium 通过；不宣称 fully compliant。
15. **Same-tree release gate**：01:15、01:51 与 02:05 均为历史 PASS；对比度稳定化后的 11:51 gate 为 control-plane `508 passed`、Chromium `134/134 passed (3.4m)`。本记录进入 closure commit 后，该 clean commit 必须无后续编辑地再次通过同一命令，才允许 push。

## 产品验收记录

2026-08-23 的只读产品验收覆盖首页、文档工作区、Web 工作区和设置页：P0 `0`、P1 `0`、
P2 `1`、P3 `0`；无横向溢出、4xx/5xx、console error/warning 或 page error。唯一 P2 为 Home Canvas
的 tldraw production-license watermark，属于发布前 license/产品决策，不是本轮功能 blocker；不得通过
CSS、DOM patch 或测试分支隐藏。该验收不替代 iteration gate，ignored artifacts 位于
`.tmp/product-acceptance/`。

## Pi SDK 0.84.2 迁移与自动更新记录（2026-08-24）

- npm registry 已核对：弃用的 `@mariozechner/pi-ai` / `pi-agent-core` 明确指向
  `@earendil-works/*`；迁移时后继包最新版本均为 `0.84.2`。仓库已切换到
  `@earendil-works/pi-ai` / `pi-agent-core@^0.84.2`，并移除未使用的 Vercel AI SDK、旧 Pi namespace
  和旧 TypeBox 依赖。
- 新 SDK 的 Node 下限已统一为 `>=22.19.0 <23`，`.node-version` 固定 `22.23.2`，Node 服务与测试
  bundle target 统一为 `node22`；工具 schema 统一使用 `typebox@1.3.7`，避免 SDK 与应用各持一份不兼容的
  schema runtime。
- provider 接线改为共享 `Models` collection；Agent 与 Room runtime 显式注入 `streamFn`，适配
  `errorMessage` / `streamingMessage` 和 state setter。默认模型为 `openai-codex::gpt-5.4`；只对历史默认
  `openai-codex::gpt-5.2-codex` 做显式迁移，其他不存在的模型 fail closed，不跨 provider 静默回退。
- OAuth canonical store 为 `.oauth/auth.json`。Web、Room Host 和 `npm run auth:openai-oauth` 共用同一
  `proper-lockfile` 跨进程锁、锁内 read-modify-write 与临时文件 rename；legacy
  `.oauth/openai-codex.json` 只保留兼容读取，并在后续刷新时进入 canonical store。
- 自动更新由 `.github/dependabot.yml` 每周发起 PR，两个 Pi package 同组；GitHub Actions 在 PR 上执行
  完整 `iteration-gate`。不启用自动合并，不向不可信依赖 PR 提供真实 provider secret；`main` 的 required
  check、reviewer 和 Dependabot no-bypass 仍须仓库管理员在 GitHub ruleset 中启用。
- 冻结前定向验证：Node `22.23.2` 下 `npm ci`、TypeScript、迁移范围 ESLint、OAuth credential helper
  `2/2`、Pi Room adapter `11/11`、Room Host Pi composition `3/3`、Room Host production build 和
  `git diff --check` 均通过。`npm audit` 为 `33`（3 low / 7 moderate / 23 high / 0 critical）；没有使用
  `npm audit fix --force`，剩余项由后续依赖 PR 分批审阅。
- 本次冻结工作树已在 `2026-08-24 03:32 +08:00` 完成完整 `npm run verify:iteration`：Web guideline
  scanner、Prisma/typegen、generated test builds、TypeScript、ESLint、fresh DB bootstrap、production Web build
  和 browser preflight 均通过；inventory `72/72`，script contracts `53 passed`，control-plane Playwright
  `474 passed`，Chromium `148/148 passed (3.6m)`。pre-record fingerprint 为
  `sha256:df27d79608233055508cba113ee1ab6a0c83e48e10ec441b14feada5c3475643`。文档记录进入
  closure commit 后，仍需在该 clean commit 上无编辑复跑同一门禁，再推送并核对远端 SHA。

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

## 首次完整 gate 历史记录（非当前最终证据）

- 时间：`2026-08-23 01:15 +08:00`
- base HEAD：`b53e5bee8becff2d3b110cd2b45331ed1bbd280d`
- pre-document working-tree fingerprint：`sha256:1cfa5cb56f47493b3d42e4959bb89066daf0e810e4af99b601811e2c3ed1edc4`
- 命令：`LD_LIBRARY_PATH=/tmp/tobe-browser-libs/usr/lib/x86_64-linux-gnu PLAYWRIGHT_BROWSERS_PATH=/data00/home/wangjiaheng.555/dev/tobe/.tmp/playwright-browsers npm run verify:iteration`
- Web guideline scanner：PASS。
- Prisma / typegen / generated test builds / TypeScript / ESLint：PASS。
- control-plane inventory：`69/69`，每个 test file 恰好匹配一次。
- script contracts：`41 passed`。
- control-plane Playwright：`461 passed`：core `267`、execution daemon `24`、Room Host `28`、knowledge worker `6`、state `7`、file `11`、execution job `68`、recovery `6`、knowledge `22`、Room `15`、confirmation `7`。
- control-plane 总计：`502 passed`（script contracts `41` + Playwright suites `461`）。
- fresh DB bootstrap：PASS，包含 `20260822010000_add_canvas_tables`。
- production Web build：PASS；仅保留既有 runtime-plugin-loader dynamic dependency warning。
- browser preflight：PASS。
- Chromium：`133 passed (3.4m)`。
- artifacts：`.tmp/iteration-regression/artifacts`。
- 结论：仅对上述 fingerprint `PASS`；不是当前工作树的最终结论。

后续终审修复已改变工作树，因此本记录只能证明上述 fingerprint。新的门禁事实另列于下节，不覆盖本历史
记录。该历史门禁完成时 Git delivery 状态为未 commit、未 push、未创建 PR、未 merge；任何本地 gate 都
不应被解释为 release、远端检查通过或 fully Web Interface
Guidelines compliant。

## Post-fix 完整 gate 历史记录（已被后续源码修复取代）

- 结束时间：`2026-08-23 01:51 +08:00`
- base HEAD：`b53e5bee8becff2d3b110cd2b45331ed1bbd280d`
- post-fix pre-record working-tree fingerprint：`sha256:c90374c82dd396b91be7626887e4d7f532a9094ea3db6efe31e83dc193daf758`
- 命令：`LD_LIBRARY_PATH=/tmp/tobe-browser-libs/usr/lib/x86_64-linux-gnu PLAYWRIGHT_BROWSERS_PATH=/data00/home/wangjiaheng.555/dev/tobe/.tmp/playwright-browsers npm run verify:iteration`
- Web guideline scanner：PASS。
- Prisma / typegen / generated test builds / TypeScript / ESLint：PASS。
- control-plane inventory：`69/69`，每个 test file 恰好匹配一次。
- script contracts：`46 passed`。
- control-plane Playwright：`462 passed`：core `267`、execution daemon `24`、Room Host `28`、knowledge worker `6`、state `7`、file `11`、execution job `68`、recovery `7`、knowledge `22`、Room `15`、confirmation `7`。
- control-plane 总计：`508 passed`（script contracts `46` + Playwright suites `462`）。
- fresh DB bootstrap：PASS，包含 `20260822010000_add_canvas_tables`。
- production Web build：PASS；仅保留既有 runtime-plugin-loader dynamic dependency warning。
- browser preflight：PASS。
- Chromium：`134 passed (3.4m)`，包含 Canvas ACL 与 workspace-scoped relation DELETE 回归。
- artifacts：`.tmp/iteration-regression/artifacts`。

本次门禁中的 `403`、`400`、`404`、`409` 与故意触发的 `500` 均来自拒绝/容错负向路径，其归属断言
全部通过。三份文档写入后曾对当时的冻结工作树复跑同一
门禁：`2026-08-23 02:05 +08:00` 结束，fingerprint
`sha256:c4dcce3c3399ba8ffb087abab8769da26434826b63974407bbbeda92e5281afe`，各阶段计数不变，browser report
为 `status: passed`，端口 `3216` 正常关闭。该门禁完成时 Git delivery 状态为未 commit、未 push、未创建
PR、未 merge；后续经授权的 commit/push 不等于 PR、merge、远端 CI、release 或 fully Web Interface
Guidelines compliant。之后的源码和测试修复已改变工作树，因此该记录不再是最终 delivery evidence。

## 对比度稳定化完整 gate 记录（pre-record 证据）

- 结束时间：`2026-08-23 11:51 +08:00`
- base HEAD：`b53e5bee8becff2d3b110cd2b45331ed1bbd280d`
- 原因：Project Room canonical route 切换会同时解除五个 header 控件的 `disabled`；共享 Button 原先动画
  `opacity`，使 axe 可能在语义已启用、视觉仍半透明的短窗口扫描并报低对比度。
- 修复：disabled 仍使用 `opacity-50`，但 opacity 不再跨状态动画；WCAG 用例等待 canonical `node` query 和
  代表性 header action enabled 后再扫描，不使用固定 sleep。
- static、Prisma/typegen/build、TypeScript、ESLint、fresh bootstrap、production build、browser preflight：PASS。
- control-plane inventory：`69/69`；script contracts：`46 passed`；Playwright suites：`462 passed`；总计：
  `508 passed`。
- Chromium：`134/134 passed (3.4m)`；Project Room WCAG A/AA 与 team Web surfaces WCAG A/AA 均通过。
- 结论：证明文档更新前的稳定化源码/测试。最终 delivery 以本记录进入 closure commit 后，对该 clean commit
  无编辑复跑同一完整门禁并核对远端 SHA 为准。
