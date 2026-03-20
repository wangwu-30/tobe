# 成形重构约束

更新时间：2026-03-20
当前工作流：见 [docs/chengxing-refactor-tracker.md](./docs/chengxing-refactor-tracker.md)

## 绝对禁止

- 在 `framework/` 中出现成形业务对象名，如 `Deliverable`、`Thread`、`Goal`
- 在 `derive/` 中调用数据库、文件系统或其他副作用
- 把 thread classification、plan status、agent watching 这类推导状态重新持久化
- 在 `api/` route 中沉淀业务逻辑
- 新增对象却不更新 [SYSTEM.md](./SYSTEM.md)
- 新增 `renderAs` 却不同时定义 `RenderAdapter`
- 新增 agent tool 却不声明 safety level
- 为了兼容历史命名，继续把旧术语回流到公共契约

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
- 新的 `Action` 可以承载确认态、长跑态和恢复态
- 新的对象默认遵循 `schema/queries/commands/index` 骨架
- 新的切片结束后，先更新 tracker，再判断是否继续下一切片

## 安全边界

- `Persona` 只改变行为倾向，不单独承担权限边界
- 权限、确认门槛、写限制由 `Policy` 管
- `RenderAdapter` 负责不同 `renderAs` 的文件 / 预览 / anchor / diff 契约
- `Action` 的 pending / confirmation / progress 是真实生命周期，不是需要被强行删除的杂质

## 验证约束

- 纯文档或纯 skill 切片可以不跑 `npm run verify:iteration`，但必须在 tracker 的 verification history 里写明原因
- 任何产品代码、行为、契约变更切片，结束前都必须跑 `npm run verify:iteration`
- 不允许只跑 `tsc`、`eslint` 或单条 Playwright spec 就关闭产品切片
