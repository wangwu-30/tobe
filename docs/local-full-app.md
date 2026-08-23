# 成形本地 Web 全功能启动

## 目标

让本地 `npm run dev` 直接进入可工作的应用状态，而不是先手动修数据库。

## 现在的正式启动路径

1. 运行 `npm run dev`
2. `predev` 会先执行 `npm run db:bootstrap:local`
3. 本地 `dev.db` 会按 `prisma/migrations` 自动补齐缺失迁移
4. 如果数据库里已经满足某个迁移的最终结构，但缺少迁移记录，bootstrap 会直接补记这条迁移，而不会重复执行导致撞表
5. 数据库准备好后，再启动 Next 开发服务器

## 为什么不用 `prisma migrate deploy`

当前仓库里的本地 `dev.db` 属于“已有 SQLite 库，但没有 Prisma migration history”的情况。

直接跑 `prisma migrate deploy` 会尝试从 baseline migration 重新建表，导致：

- `Organization already exists`
- `Document already exists`
- 其它已有表重复创建失败

所以本地 Web 开发现在走成形自己的 bootstrap 路径：

- 优先识别“这条迁移的结果是否已经存在”
- 已存在就记为已应用
- 不存在才真正执行对应 `migration.sql`

## 关键文件

- 本地开发 bootstrap: `scripts/bootstrap-local-db.mjs`
- 本地数据库：`dev.db`

## 当前保证

- `Document.projectRootPath`
- `WorkflowPlaybook.steps / constraints / checklist / archivedAt`
- `WorkspacePlan.activeWorkflowPlaybookId`

这些近期新增字段已经能通过 bootstrap 自动进入本地库，不需要再手工 `db push`。
