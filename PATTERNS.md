# 成形重构任务模式

更新时间：2026-03-20
当前工作流：见 [docs/chengxing-refactor-tracker.md](./docs/chengxing-refactor-tracker.md)

## 开始当前重构 workstream

1. 先读 [docs/chengxing-refactor-tracker.md](./docs/chengxing-refactor-tracker.md)
2. 再读 [refactor_plan.md](./refactor_plan.md)
3. 如已存在，读 [SYSTEM.md](./SYSTEM.md)、[CONVENTIONS.md](./CONVENTIONS.md)、[CONSTRAINTS.md](./CONSTRAINTS.md)、[PATTERNS.md](./PATTERNS.md)
4. 选一个 bounded slice
5. 落地代码 / 文档 / 测试
6. 更新 tracker
7. 如有产品代码改动，执行 `npm run verify:iteration`
8. 重新判断下一切片，而不是因为当前切片结束就停止

## 添加新对象

1. 更新 [SYSTEM.md](./SYSTEM.md)
2. `prisma/schema.prisma` 增加 model 或调整映射
3. 建立 `src/objects/{name}/schema.ts`
4. 建立 `src/objects/{name}/queries.ts`
5. 建立 `src/objects/{name}/commands.ts`
6. 建立 `src/objects/{name}/index.ts`
7. 如有推导结果，补 `src/derive/{name}.ts`
8. 更新 tracker 与相关 docs
9. 跑 `npm run verify:iteration`

## 添加新 renderAs

1. 在 `src/agent/render-adapters/{type}.ts` 定义 render adapter
2. 在 `src/agent/tools/{type}/` 添加工具实现
3. 在 `src/agent/toolkit.ts` 注册 `TYPE_TOOLS`
4. 在 `src/canvas/{type}-canvas/` 建立画布
5. 如需新文件契约或预览契约，回写 [SYSTEM.md](./SYSTEM.md)
6. 跑 `npm run verify:iteration`

## 添加新 agent 工具

1. 在 `src/agent/tools/{category}/{tool-name}.ts` 实现工具
2. 明确 `safetyLevel`、确认策略与写权限
3. 注册到 `ToolKit`
4. 如改了 agent 原语或工具边界，更新 [SYSTEM.md](./SYSTEM.md) / [CONSTRAINTS.md](./CONSTRAINTS.md)
5. 跑 `npm run verify:iteration`

## 修改推导逻辑

1. 改 `src/derive/{name}.ts`
2. 确认纯函数，无 DB、无副作用
3. 补单测
4. 如用户可见行为变了，更新相关文档
5. 跑 `npm run verify:iteration`

## 拆巨石文件

1. 先识别当前巨石承担的多个职责
2. 先抽 façade / 公开接口
3. 让调用方先依赖 façade，而不是直连旧巨石内部
4. 再按对象层、runtime 层或 surface 层迁移实现
5. 删除旧的兼容影子
6. 跑 `npm run verify:iteration`

## 统一 agent runtime

1. 先统一内部执行层
2. 再统一 `context / toolkit / persona / policy / render adapter`
3. 再让旧 route 转调新执行层
4. 全部通过后再删除旧 route
5. 跑 `npm run verify:iteration`

## 踩到通用坑

1. 先判断是成形专属还是跨项目通用
2. 成形专属经验：更新 [docs/chengxing-lessons-learned.md](./docs/chengxing-lessons-learned.md)
3. 通用工程经验：记入外部知识库
4. 若该经验改变当前执行边界，同时更新本地 contract docs
