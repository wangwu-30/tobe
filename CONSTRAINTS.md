# 成形重构约束

更新时间：2026-08-21
当前工作流：[docs/agent-room-execution-workstream.md](./docs/agent-room-execution-workstream.md)（active）

## 绝对禁止

- 在 `framework/` 中出现成形业务对象名，如 `Deliverable`、`Thread`、`Goal`
- 在 `derive/` 中调用数据库、文件系统或其他副作用
- 把 thread classification、plan status、agent watching 这类推导状态重新持久化
- 在 `api/` route 中沉淀业务逻辑
- 新增对象却不更新 [SYSTEM.md](./SYSTEM.md)
- 新增 `renderAs` 却不同时定义 `RenderAdapter`
- 新增 agent tool 却不声明 safety level
- 为了兼容历史命名，继续把旧术语回流到公共契约
- 引入 desktop/Electron 入口、bridge、package 或 release gate；本仓库产品面严格 Web-only
- 把 team-mode schema、membership role 或 organization ACL 描述成已经交付 production multi-user
  identity、登录/session/JWT integration、成员邀请/provisioning 或企业 SSO
- 把 Room Agent Session 与 `ExecutionJob` 合并为同一个状态机、lease、capacity 或恢复语义
- 让 Agent、Runtime、execution daemon 或普通 Web route 直接更新知识默认分支或激活索引

## 需要确认

- 修改 `framework/` 的公开接口
- 删除现有公开导出
- 修改 [SYSTEM.md](./SYSTEM.md) 的核心不变量
- 放宽或跳过 `npm run verify:iteration`
- 引入新的 workstream 或重排当前 phase 顺序
- 执行 `privileged` 级别工具，或把 `confirm` 级工具降级为自动执行

## 默认行为

- 新的 derive 函数默认为纯函数
- 新的 agent tool 必须声明 safety level：
  - `safe`
  - `confirm`
  - `privileged`
- 新的 `Action` 只承载请求级或 Room turn 内的行为、确认结果与审计投影；分钟到小时级执行、租约、检查点和恢复必须进入 `ExecutionJob + ExecutionAttempt`
- 新的对象默认遵循 `schema/queries/commands/index` 骨架
- 新的切片结束后，先更新 tracker，再判断是否继续下一切片
- 新增 `*.test.ts` 必须进入 control-plane inventory 且恰好匹配一次；禁止跳过、待实现、仅运行或修复标记

## 安全边界

- `Persona` 只改变行为倾向，不单独承担权限边界
- 权限、确认门槛、写限制由 `Policy` 管
- 当前 Web MVP 的身份上下文是进程冻结的 trusted local single-user principal。header 只可作为受信 Web
  runtime 的 transport receipt，不能被描述为认证机制；Room 显式 receipt 也只能引用已存在且完整匹配的
  organization/user/membership/device tuple。生产 IdP、登录/session/JWT、成员邀请/provisioning 与企业 SSO
  属于部署或未来范围
- `RenderAdapter` 负责不同 `renderAs` 的文件 / 预览 / anchor / diff 契约
- `Action` 的短时 pending / confirmation / progress 可以作为请求级审计事实，但不能成为 durable Job 的权威状态；Job 的 queue、attempt、lease、waiting-input 与 recovery 只属于 Execution 控制面
- Execution admission 只能接受经 membership ACL 授权的 trusted local principal 显式对齐的可见不可变版本；客户端 prompt、Room 消息、草稿或
  recovery point 不能替代 `aligned` 事实
- required-confirmation 工具必须在共享 policy wrapper fail closed；`start_execution_job` 只能通过冻结
  actor/session/delivery/parameter hash 的 durable Room confirmation 和 exactly-once approval command 执行
- Room context 必须有 ACL recheck、provenance/trust 标记与显式预算；summary/cache 不是事实源，撤权后不得复用
- 基础 Generic CLI 始终为 `workspace=none`；受信 `external-module` 只能来自部署配置中的绝对本地路径和
  allowlist 环境。OpenHands 在协议验证前保持 disabled/offline/capacity zero
- `git-worktree` 只是 capability 名；当前 Git port 必须使用 attempt 专属 isolated clone/workspace 与 proposal
  ref，不得把它描述成 native Git registered worktree。只有受信 merge worker 可执行 expected-old CAS，
  并且只有 `ready` snapshot 可以进入普通检索
- 远程 Git credential/fetch/push 与 monorepo subpath mount 是明确 non-goal；不得从本地 trusted repository
  root binding 推导这些能力
- 本地 SQLite bootstrap 必须强制并确认 WAL；产品 Prisma client 必须走 safe local libSQL adapter。
  `SQLITE_BUSY` 重试只允许包住输入不变且可幂等重放的完整 durable command，禁止重放任意事务片段

## 健壮性约束

- 禁止在 `src/` 里裸用 `JSON.parse`；唯一例外是 `src/framework/resilience/safe-data.ts`
- 禁止在前端非流式调用链里裸用 `fetch`；默认统一走 `framework/resilience/api-client.ts`
- 禁止在 `src/app/api/**/route.ts` 里直接导出裸 HTTP handler；必须通过 `defineRoute(...)`
- 允许保留裸 `fetch` 的场景只包括：
  - assistant runtime 的流式请求
  - 外部 search provider 请求
  - preview bridge 的服务端代理
- 新的运行时防护不要回退成局部补丁；优先扩展 `framework/resilience/`，而不是复制 wrapper/helper

## 验证约束

- 纯文档或纯 skill 切片可以不跑 `npm run verify:iteration`，但必须在 tracker 的 verification history 里写明原因
- 任何产品代码、行为、契约变更切片，结束前都必须跑 `npm run verify:iteration`
- 不允许只跑 `tsc`、`eslint` 或单条 Playwright spec 就关闭产品切片
- 文档不得把“代码存在”“targeted suite 通过”写成“完整门禁通过”；完整结果只能追加为带命令和
  精确结果的 dated verification record，历史 pass 数字不得覆盖或改写；本轮结论由本轮最终 gate 补录
