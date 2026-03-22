# 成形代码约定

更新时间：2026-03-20
当前工作流：由 `program-autopilot` 激活的 workstream tracker 决定，不再硬编码到单一 tracker

## 目录边界

目标目录结构：

```text
src/
├── framework/      # 可复用引擎
├── objects/        # 业务对象
├── derive/         # 纯推导函数
├── agent/          # 成形业务层 agent
├── canvas/         # renderAs 对应的中央结果面
├── surfaces/       # 产品表面
├── api/            # 路由适配层
└── shared/         # 成形内部共享
```

### 分层职责

- `framework/`
  可复用 runtime，不出现成形业务对象名。
- `objects/`
  业务对象的 schema、读写命令与导出边界。
- `derive/`
  纯函数推导层，无 DB、无副作用。
- `agent/`
  成形专属的 context、toolkit、persona、policy、render adapter 与业务 tool。
- `canvas/`
  每种 `renderAs` 的中央画布与结果壳适配。
- `surfaces/`
  工作区、侧栏、状态面板、评审面板、上下文面板等产品表面。
- `api/`
  只做请求解析与边界适配，不沉淀业务逻辑。

## 对象目录骨架

每个对象默认使用：

```text
src/objects/{name}/
├── schema.ts
├── queries.ts
├── commands.ts
└── index.ts
```

如果对象暂时只需要读或只需要写，可以先缺一项，但 `index.ts` 必须作为公开出口。

## Agent 目录骨架

```text
src/agent/
├── context.ts
├── toolkit.ts
├── persona.ts
├── policy.ts
├── render-adapters/
├── run.ts
└── tools/
```

### render-adapters

- `render-adapters/{type}.ts`
  定义该 `renderAs` 的文件契约、预览契约、anchor 语义和 diff 方式。

### tools

- `tools/base/`
- `tools/{renderAs}/`
- `tools/research/`
- `tools/meta/`

每个工具单文件实现，避免把工具注册和工具实现混成巨石。

## 命名约定

- 文件名：`kebab-case`
- 类型：`PascalCase`
- 函数：`camelCase`
- 常量：`UPPER_SNAKE_CASE`
- 运行时导出优先显式命名导出，不默认导出一大坨对象

## 文件规模

- 默认目标：文件不超过 400 行
- 默认目标：单个核心 runtime 文件尽量保持在 200 行左右
- 如果超过阈值但边界仍清晰，可以暂时保留；不要为了凑行数制造更差的抽象

## 导入方向

- `framework/` 不得 import `objects/`、`derive/`、`agent/`、`canvas/`、`surfaces/`
- `derive/` 只 import 类型，不 import实现
- `api/` 只 import `objects/` 与 `agent/` 的公开导出
- `surfaces/` 与 `canvas/` 不要反向依赖 `api/`

## 健壮性约定

- 运行时安全能力统一落在 `src/framework/resilience/`，不要把相同职责分散回各 surface / route 的局部 helper。
- 前端非流式 API 调用默认使用 `apiCall` 或 `apiCallOrThrow`；只有流式 assistant runtime、外部 provider 请求和 preview bridge 代理这类特例才保留裸 `fetch`。
- 任意 JSON 解析默认使用 `safeJsonParse`；不要在 feature 代码里重新长出局部 `try/catch + JSON.parse`。
- `src/app/api/**/route.ts` 的 HTTP 导出必须通过 `defineRoute(...)` 包裹，route 文件只保留参数解析和响应适配。
- 页面级和大区块级 UI 默认按失败域包 `ZoneErrorBoundary`；Next route 层错误页通过 `app/error.tsx` 或子路由 `error.tsx` 承接。

## 文档同步规则

- 对象模型变了：更新 [SYSTEM.md](./SYSTEM.md)
- 约束变了：更新 [CONSTRAINTS.md](./CONSTRAINTS.md)
- 常见任务路径变了：更新 [PATTERNS.md](./PATTERNS.md)
- 当前切片状态变了：更新 [docs/chengxing-refactor-tracker.md](./docs/chengxing-refactor-tracker.md)
- 验证经验或坑位变了：更新 [docs/chengxing-lessons-learned.md](./docs/chengxing-lessons-learned.md)

## 迁移顺序约定

- 先抽 façade / 边界，再做大规模文件搬迁
- 先统一内部 runtime，再做外部 route 收口
- 优先删兼容影子，不优先叠新包装层
