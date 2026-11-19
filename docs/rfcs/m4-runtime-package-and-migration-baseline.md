# M4 架构评估：独立 `packages/agent-runtime` 拆包与 Prisma 迁移基线压平

- 关联议题：[#23](https://github.com/wangwu-30/tobe/issues/23)（M4: Runtime & DX Weight-Loss）、[#16](https://github.com/wangwu-30/tobe/issues/16)（RFC-2）
- 结论性质：**Provisional（暂行架构决策，按真实边界收益分阶段执行，避免无收益重构）**

---

## 一、现状

### 1.1 运行时代码与打包边界
- 当前仓库是单 `package.json` 单体结构：Next.js Web（`src/app`, `src/components`, `src/surfaces`, `src/canvas`, `src/lib`, `src/objects`）与 3 个独立 Node 守护进程（`apps/execution-daemon`, `apps/room-session-host`, `apps/knowledge-merge-worker`）共享同一份 `src/agent/*`、`src/objects/*`、`src/lib/db/prisma.ts` 与 `src/generated/prisma`。
- 三个守护进程各自通过独立 Vite SSR 配置（`vite.execution-daemon.config.mts`, `vite.room-session-host.config.mts`, `vite.knowledge-merge-worker.config.mts`）打成单文件 `.vite/*/index.mjs`，平均单次构建耗时 < 1 秒。
- 实测静态依赖图（42 个运行在 `apps/*` 与 `src/agent/{execution,room-host,knowledge}` 下的非测试 `.ts` 文件）：
  - **Runtime -> App 方向仅 22 处跨界导入**：`@/framework/resilience`（8）、`@/lib/db`（6）、`@/objects/room`（3）、`@/objects/knowledge`（2）、`@/objects/execution-job`（1）、`@/generated/prisma`（1）、`@/lib/ai`（1）。
  - **Web -> `@/agent/*` 方向有 43 处反向导入**：`@/agent/execution`（16）、`@/agent/room-runtime`（6）、`@/agent/knowledge`（5）、`@/agent/tools`（5）、`@/agent/room-host`（4）、`@/agent/tool-policy`（3）、`@/agent/events`（2）、`@/agent/run`（1）、`@/agent/room`（1），主要用于读取类型契约、工具治理策略与 FTS5 知识检索接口。

### 1.2 数据库迁移与本地引导层
- `prisma/migrations/` 当前保留 **43 份** 历史增量迁移（从 `20260312090000_current_schema_baseline` 到 `20260823010000_add_team_scoped_conversations`）。
- `scripts/bootstrap-local-db.mjs`（2,660 行）承担本地 SQLite WAL 强制开启、历史迁移回放与多份历史漂移数据的增量表结构修复。
- 实测在全新空库上回放全部 43 份迁移耗时 **< 1.5 秒**；本地开发与 CI 中的真实主要验证税并不来自 SQLite 迁移回放，而是来自测试运行器与构建串联。

---

## 二、目标

在不破坏现有 SQLite 存量数据库无缝升级、也不引入额外构建链复杂度的前提下，明确：
1. **运行时边界**：保证 Web 与 3 个守护进程的契约隔离可机械校验，只在存在独立发布或独立安装需求时再物理拆出 npm workspace。
2. **数据库引导边界**：保持全新库与历史存量库都可确定性升级，同时把 2,660 行手写修补器收窄为“纯快照建表 + 最小向前兼容检测”，降低后续 Schema 变更的维护风险。

---

## 三、差距

### 3.1 物理抽离 `packages/agent-runtime` 的收益与代价
- **结构差异**：目前 3 个守护进程依赖 `@/lib/db/prisma`、`@/generated/prisma` 与 `@/objects/{room,knowledge,execution-job}`，Web 又反过来依赖 `@/agent/{execution,knowledge,tools,tool-policy}`。如果强行把 `src/agent/*` 搬进 npm workspace `packages/agent-runtime`，必须同时再拆出 `packages/prisma-client` 和 `packages/shared-contracts` 才能打破循环依赖，且 Next.js (`transpilePackages`)、3 份 Vite 配置、Prisma Client 生成路径与 `tsconfig` paths 都要成套改造。
- **真实权衡**：当前 3 个守护进程构建总耗时仅 ~3 秒，且 M4 Slice 23A 已通过 `npm run dev:all` + `npm run test:unit`（Node 原生 `node:test`）+ 清理 21 份孤儿 Playwright 配置解决了最痛的本地开发与单测税。**现阶段（单人本地部署、单仓库发布）物理拆成多包 npm workspace 不会缩短构建或测试时间，反而会增加跨包类型同步与发布脚本税。**
- **推荐判定**：**暂不拆成物理 npm workspace**；改以 ESLint/路径边界护栏 + 稳定端口接口守住 `src/agent/*` 不反向导入 `src/components/*` / `src/app/*` / `src/surfaces/*`，待未来真正需要独立部署/独立 npm 发包时再按本方案第 4 节拆包。

### 3.2 压平 43 份历史迁移与瘦身 `bootstrap-local-db.mjs` 的风险与机会
- **结构差异**：直接删除 43 份历史迁移并替换成单份 baseline，会导致任何已有本地 `dev.db`（`_prisma_migrations` 表里只记录了历史迁移名）的用户在升级时出现迁移表冲突或整库重建风险。
- **真正痛点**：不是 43 个 `.sql` 文件本身（全量执行 < 1.5s），而是 `scripts/bootstrap-local-db.mjs` 中为早期 `202603*` 旧库写的大量手工表结构检测/重建逻辑已累积到 2,660 行，使新加字段/表时必须同时维护 Prisma migration 与 JS 修补器两套逻辑。
- **推荐判定**：**采用“双路径基线（Fresh Baseline + Legacy Upgrade Guard）”而非粗暴删迁移**——仅当需要正式发布 v1.0 破坏性版本边界时才归档旧迁移；在当前 0.x 阶段优先把 `bootstrap-local-db.mjs` 拆成 `bootstrap-core.mjs`（WAL + 迁移执行）与 `legacy-repair-202603.mjs`（只读归档历史修补），禁止新迁移再向修补器堆砌手写 DDL。

---

## 四、执行计划

### 4.1 运行时边界治理（当前已落地 + 后续触发条件）
1. **已完成（M4 Slice 23A / 23B）**：
   - 删除 21 份无引用的历史孤儿 Playwright 配置（36 -> 15 份活跃配置）。
   - 引入 `scripts/node-ts-register.mjs` 与 `npm run test:unit`，在 `scripts/control-plane-test-inventory.mjs` 中原生支持 `runner: 'node'`，首批 9 份纯逻辑单测脱离 Playwright 运行（~4s）。
   - 提供 `npm run dev:all`（`scripts/dev-all.mjs`）一键拉起 Web + 3 个独立 Node 守护进程并观测健康态。
   - 按 `PATTERNS.md` 下沉 `src/app/api/workspaces/route.ts`（1,173 -> ~210 行）至 `src/objects/workspace/{create-commands,web-starter-template}.ts`，并拆分 `deliverable-sidebar.tsx` 的项目树与参考资料树（-1,080 行）。
2. **未来触发物理拆包 `packages/agent-runtime` 的前提**：当守护进程需要独立于 Next.js 容器发布、或第三方需要直接 `import` 运行时 SDK 时，按三步执行：
   - Step 1：把 `@/framework/resilience/safe-data` 与 Prisma schema/generated client 抽成 `packages/db-contract`；
   - Step 2：将 `src/agent/{execution,room-host,room-runtime,knowledge,context,tool-policy}` 迁入 `packages/agent-runtime`，Web 仅通过显式子路径导出消费；
   - Step 3：移除根目录 3 份 `vite.*.config.mts`，改由 `packages/agent-runtime` 自管构建，并在移除前保持 `npm run test:control-plane` 全部绿灯。

### 4.2 数据库引导层瘦身路线（后续独立切片）
1. 将 `scripts/bootstrap-local-db.mjs` 的历史 `202603*` 漂移修补逻辑按日期拆出为 `scripts/db/legacy-repairs.mjs`，主入口只保留 WAL 强制校验、迁移执行与 `_prisma_migrations` 核对（目标 < 300 行）。
2. 约定所有新 Schema 变更仅通过标准 `prisma/migrations/` 向前推进，不再往 `legacy-repairs.mjs` 新增分支。
3. 待 v1.0 明确切分升级基线窗口后，提供显式 `v1_baseline` 全量 DDL，并仅保留对前一受支持版本迁移点的检查。

---

## 五、验收标准

- **已验证（M4 Slice 23A / 23B）**：
  - 活跃 Playwright 配置数由 36 降至 15；`npm run test:unit` 在无 Playwright 环境下通过全部解耦单测且保留 1:1 inventory 与 `skip/only/todo/fixme` AST 门禁。
  - `npm run dev:all -- --no-web` 在全新隔离 SQLite 库上实测 3 个独立 Node 守护进程全部报告 `ready` 并在 `SIGTERM` 下零孤儿退出（`exitCode=0`）。
  - `src/app/api/workspaces/route.ts` 与 `src/components/workspace/deliverable-sidebar.tsx` 职责拆分后通过完整 `npm run verify:iteration` CI 门禁。
- **待验证（后续触发条件满足时）**：
  - `packages/agent-runtime` 物理拆包与 `bootstrap-local-db.mjs` 历史修补模块拆分均标注为 **待验证 / 按需触发**，当前不强行引入多包或破坏存量 SQLite 升级路径。
