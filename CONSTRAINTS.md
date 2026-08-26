# 成形重构约束

更新时间：2026-08-23
当前产品工作流：[一人 AI Wiki](./docs/briefs/one-person-ai-wiki.md)（active）
高级运行时记录：[Agent Room 与持久执行落地追踪器](./docs/agent-room-execution-workstream.md)

## 产品硬边界

- 当前产品是 Web-only 的一人 AI Wiki：一个 singleton `Organization`、一个 human `owner`、多个 AI
  `AgentProfile`、多个 Wiki Spaces。
- 不得把 team-mode schema、membership role、organization ACL 或 header receipt 描述为已经交付
  multi-user、登录/session/JWT、成员邀请/provisioning 或企业 SSO。
- 用户主对象只有 **Wiki Space** 与 **Page**。Wiki Space 是 canonical Project root facade；Page 是
  `Document` facade。`Project`、`Deliverable`、`Content` 只能作为内部兼容名或明确标注的历史术语。
- Git `KnowledgeSpace` 不是 Wiki Space。不得共用用户名称、创建入口、默认导航或写入授权。
- 首页默认先 Chat。普通消息不得隐式创建空 Wiki Space；只有 owner 显式确认后才能创建，并且必须让
  Wiki Space 接管同一 `Session`，不得复制消息或另起隐藏 Session。
- Chat 是默认能力。Room、Agents、Team Tasks、Execution Jobs 与 Git Knowledge 是 `Advanced` 能力，
  不得重新成为默认入口或与 Wiki 主路径同权展示。
- AI 只能准备 **Suggested changes / 建议修改**；human owner 才能 apply/approve。真正写入由受信
  command/worker 在重验与 CAS 后完成。
- 产品严格 Web-only；不得恢复 desktop/Electron 入口、bridge、package 或 release gate。
- OpenHands 在协议实现与验证前保持 disabled/offline/capacity-zero/fail-closed。
- 不得隐藏 tldraw watermark。发布前必须取得兼容许可证或明确接受适用条款。

## 架构绝对禁止

- 在 `framework/` 中出现成形业务对象名，如 `Page`、`Document`、`Thread`、`Goal`。
- 在 `derive/` 中调用数据库、文件系统或其他副作用。
- 把一般 UI status、thread classification、plan progress、agent watching 等推导状态重新持久化。
- 在 `api/` route 中沉淀业务逻辑。
- 新增对象却不更新 [SYSTEM.md](./SYSTEM.md)。
- 新增 `renderAs` 却不同时定义 `RenderAdapter`。
- 新增 Agent tool 却不声明 safety level。
- 为兼容历史 key 或 schema 名，把 Project/Deliverable/Content 重新写进新可见主路径文案。
- 把 Room Agent Session 与 `ExecutionJob` 合并为一个状态机、lease、capacity 或 recovery lifecycle。
- 让 Agent、Runtime、execution daemon 或普通 Web route 直接应用 Page 建议修改、更新 Git Knowledge 默认分支
  或激活索引。

## 需要确认

- 修改 `framework/` 的公开接口。
- 删除现有公开导出。
- 修改 [SYSTEM.md](./SYSTEM.md) 的核心不变量。
- 放宽或跳过 `npm run verify:iteration`。
- 引入新的 workstream 或重排当前 phase 顺序。
- 执行 `privileged` 级别工具，或把 `confirm` 级工具降级为自动执行。
- 将任何 Advanced 能力提升为首页或 Wiki Space 的默认路径。

## 默认行为

- 新 derive 函数默认为纯函数。
- 新 Agent tool 必须声明 `safe | confirm | privileged` safety level。
- 新 `Action` 只承载请求级或 Room turn 内行为、确认结果与审计投影；分钟到小时级执行、lease、
  checkpoint 和 recovery 必须进入 `ExecutionJob + ExecutionAttempt`。
- 新对象默认遵循 `schema/queries/commands/index` 骨架。
- 新切片结束后先更新 active tracker，再判断是否继续下一切片。
- 新增 `*.test.ts` 必须进入 control-plane inventory 且恰好匹配一次；禁止 skip、todo、only 或 fixme。
- 现有 i18n key 为兼容接口，术语迁移优先改 value；只有新交互没有合适 key 时才新增 key，并同时补齐
  `en-US` 与 `zh-CN`。
- 任何创建 Wiki Space 的入口都必须复用统一的 explicit-confirmation + idempotency + same-Session command。
- 普通 Chat/Wiki Space/Page 流程不得展示 Runtime selector、lease/attempt、quarantine/recovery 或 Git merge
  控制台；这些只属于 Advanced。

## 安全边界

- `Persona` 只改变行为倾向，不单独承担权限边界；权限、确认门槛和写限制由 `Policy` 管。
- trusted local identity context 是进程冻结的 organization/user/device tuple。header 只可作为受信 Web
  runtime 的 transport receipt，不能描述为认证机制。
- AI 的 Page Suggested changes 不能修改 live draft。human apply 必须在同一事务中校验 organization、owner
  authority、base/draft revision、file hashes、suggested-change state 与 recovery checkpoint。
- comment-source apply 与普通 Suggested changes 必须复用同一 canonical apply seam；exact current draft 之外
  的 comment 只能作为 review context。
- Execution admission 只能接受 owner 显式对齐的可见不可变 Page version；prompt、Chat/Room message、draft
  或 recovery point 不能替代 `aligned` 事实。
- required-confirmation tool 必须在共享 policy wrapper fail closed。自然语言、模型参数或 tool-call ID 不能
  充当授权。
- Room context 必须有 ACL recheck、provenance/trust 标记和显式预算；summary/cache 不是事实源，撤权后
  不得复用。
- 基础 Generic CLI 始终为 `workspace=none`。受信 `external-module` 只能来自部署配置中的绝对本地路径并
  接收 allowlist 环境。
- `git-worktree` 是 capability 名；当前 Git port 使用 attempt 专属 isolated clone/workspace 与 proposal ref，
  不能描述为 registered worktree。
- 只有 trusted merge worker 可执行 expected-old CAS；只有 `ready` snapshot 可以进入普通 Agent 检索。
- 远程 Git credential/fetch/push 与 monorepo subpath mount 是 non-goal，不得从本地 repository binding
  推导这些能力。
- 本地 SQLite bootstrap 必须强制并确认 WAL；产品 Prisma client 必须使用 safe local libSQL adapter。
  `SQLITE_BUSY` 只可在输入不变、可幂等重放的完整 durable command 边界有限重试。

## 健壮性约束

- 禁止在 `src/` 里裸用 `JSON.parse`；唯一例外是 `src/framework/resilience/safe-data.ts`。
- 禁止在前端非流式调用链里裸用 `fetch`；默认使用 `framework/resilience/api-client.ts`。
- 禁止在 `src/app/api/**/route.ts` 里直接导出裸 HTTP handler；必须通过 `defineRoute(...)`。
- 裸 `fetch` 仅可保留在 assistant runtime 流式请求、外部 search provider 请求和 preview bridge 服务端代理。
- 新运行时防护优先扩展 `framework/resilience/`，不得复制局部 wrapper/helper。
- Wiki Space 创建结果未知时只能查询或重放同一 idempotency request；不得生成第二个 root。
- same-Session 接管必须保持消息顺序、attachment/source provenance 和原 session identity；失败必须无
  半创建 Wiki Space 或部分 binding。

## 验证约束

- 纯文档或纯文案切片可以不跑完整 `npm run verify:iteration`，但必须运行与所改文件相称的 lint/格式/
  链接检查，并明确说明未跑完整门禁。
- 任何产品行为、代码或公共契约变更切片，结束前必须跑 `npm run verify:iteration`。
- 不允许只跑 `tsc`、ESLint 或单条 Playwright spec 就关闭产品代码切片。
- 文档不得把“代码存在”“targeted suite 通过”写成“完整门禁通过”。完整结果只能追加为带命令和精确
  结果的 dated record。
- 历史 gate 数字、fingerprint 与时间不得覆盖或改写；新 workstream 的验证只能新增记录。
