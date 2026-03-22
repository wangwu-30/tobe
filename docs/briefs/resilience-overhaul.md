# 成形运行时健壮性改造方案

> 变更类型：架构改造
> 日期：2026-03-22
> 状态：已实施（2026-03-22，`npm run verify:iteration` 62 passed）

---

## 现状

### 背景

成形完成了 Phase 0–11 的核心重构，解决了"代码放在哪"的问题。但重构过程聚焦于分层、命名、职责拆分，没有系统性地处理"代码出错了怎么办"。

### 当前运行时安全机制

| 层级 | 机制 | 现状 |
|------|------|------|
| React 渲染错误 | ErrorBoundary | **不存在**。0 个 ErrorBoundary，0 个 `error.tsx` |
| 全局异常监听 | `window.onerror` / `unhandledrejection` | **不存在** |
| API route 错误处理 | try/catch | 50 个 route 中 31 个**没有** try/catch |
| JSON 解析 | 安全解析 | **不存在**。18+ 处裸 `JSON.parse`，无 try/catch 保护 |
| 网络请求 | 统一 fetch client | **不存在**。60+ 处散落的裸 `fetch()` 调用 |
| 轮询控制 | 退避策略 | **不存在**。固定 3s 间隔，失败不退避 |

### 观测到的问题

1. **交付物不按预览展示**：`renderAs='web'` 需要手动启动预览才能看到内容，否则显示空占位卡
2. **无法对交付物评论**：评论入口在 AI 工作阶段消失；web 预览的 bridge 注入不可靠
3. **未知异常导致客户端白屏**：任何组件渲染抛错 → 整个应用崩溃，无降级 UI
4. **i18n 不完整**：中英文硬编码混用，切换语言后部分文案不变

### 问题根因定性

这不是 4 个独立 bug，而是**一个系统性缺失**的 4 种表现：项目没有运行时安全层。

---

## 目标

**建立编译期 + 运行时的双重安全网，让渲染崩溃、网络异常、数据异常、服务端错误这四类问题成为结构性不可能。**

具体目标状态：

| 维度 | 目标 |
|------|------|
| 渲染错误 | 任何组件抛错只影响该区块，显示降级 UI + 重试按钮，兄弟区块不受影响 |
| 网络异常 | 所有 API 调用通过统一 client，自带超时、重试、退避，失败时显示可操作的状态 |
| 数据异常 | 所有 JSON 解析通过安全函数，ESLint 规则禁止裸 `JSON.parse` |
| 服务端错误 | 所有 route handler 通过统一 wrapper，不可能遗漏 try/catch |
| 预览展示 | 预览生命周期由状态机驱动，有内容时自动启动，不依赖用户手动操作 |
| 评论能力 | 评论入口在所有 renderAs × workflowPhase 组合下可用，至少提供手动评论 fallback |
| 新代码防退化 | ESLint 规则在 CI 阶段拦截裸 `JSON.parse`、裸 `fetch`、硬编码文案 |

---

## 差距

### 架构差距：四道防线全部缺失

目标架构需要四道防线，当前全部为空白：

```
用户看到的界面
      │
┌─────┴──────┐
│ 防线 1 视图防护 │  ErrorBoundary 分层 + error.tsx + 全局异常监听
└─────┬──────┘    当前：不存在
      │
┌─────┴──────┐
│ 防线 2 数据安全 │  安全解析 + 类型归一化 + ESLint 禁裸解析
└─────┬──────┘    当前：不存在
      │
┌─────┴──────┐
│ 防线 3 通信韧性 │  统一 API client + 重试 + 退避 + 超时
└─────┬──────┘    当前：不存在
      │
┌─────┴──────┐
│ 防线 4 服务端契约│  Route handler wrapper + 统一错误格式
└─────┴──────┘    当前：不存在
      │
  数据库 / 文件系统
```

### 防线 1 差距明细：视图防护

**ErrorBoundary**：`grep "ErrorBoundary" src/` → 0 结果。React 的任何渲染错误都导致整个应用白屏。

**error.tsx**：`find src/app -name "error.tsx"` → 0 结果。Next.js 提供的路由级错误捕获完全未使用。

**全局监听**：`grep "unhandledrejection" src/` → 0 结果。`void loadWorkspace()` 等 pattern 中如果 promise reject，全局无人接住。

**风险点**：
- `use-workspace-route-controller.ts` 的 `loadWorkspaceView` 无 try/catch，`readWorkspaceView` 网络断开时直接抛出
- `EditorWrapper` 中 Plate 编辑器初始化如果 `initialContent` 格式非法 → 渲染 crash
- `comment-sidebar.tsx`（2184 行）任何子组件抛错 → 整个评论面板消失

### 防线 2 差距明细：数据安全

**裸 JSON.parse 清单**（无 try/catch 保护）：

| 文件 | 行号 | 风险 |
|------|------|------|
| `objects/file/schema.ts` | 75 | 文件内容非法 JSON → 对象层 crash |
| `objects/conversation/view.ts` | 300 | 对话存储数据损坏 → 加载失败 |
| `canvas/document-canvas.tsx` | 760, 769 | 交付物内容解析失败 → 画布白屏 |
| `derive/thread-classify.ts` | 200 | 评论分类失败 → 评论列表异常 |
| `components/comments/comment-sidebar.tsx` | 2019 | 文件内容非法 → 评论上下文丢失 |
| `components/workspace/deliverable-version-controls.tsx` | 1140 | 版本内容非法 → 版本控件 crash |
| `lib/comments/agents.ts` | 144, 202 | Agent 配置非法 → 评论失败 |
| `lib/comments/review-anchor.ts` | 9 | 锚点数据非法 → 评论定位失败 |
| `lib/platform/mirror-manager.ts` | 136 | 镜像数据非法 → 同步 crash |
| `lib/platform/run-service.ts` | 344 | package.json 非法 → 预览启动失败 |
| `lib/workspace/file-presentation.ts` | 14 | 文件判定失败 → 错误的编辑器类型 |

### 防线 3 差距明细：通信韧性

**裸 fetch 分布**：`src/surfaces/` 14 处、`src/hooks/` 3 处、`src/components/` 15+ 处。共 60+ 处分散的 `fetch()` 调用。

**问题模式**：
- 无统一超时：默认浏览器超时（可能数分钟），用户无感知地等待
- 无重试：一次网络抖动 → 功能直接失败
- 无退避：`PREVIEW_RUN_POLL_INTERVAL_MS = 3000` / `CONVERSATION_POLL_INTERVAL_MS = 3000` 固定间隔
- 错误格式不统一：有的返回 `{ error: string }`，有的返回 `{ message: string }`，有的返回纯文本

### 防线 4 差距明细：服务端契约

**无 try/catch 的 API route**（31/50）：

包括 `agent/run`、`project-list`、`notes`、`threads/messages`、`preview/stop`、`staged-changes` 等核心路由。

任何一个 route 抛出未捕获异常 → Next.js 返回 500 HTML → 前端 `response.json()` 解析 HTML 失败 → 前端抛出 SyntaxError → 如果在渲染路径上 → 白屏。

### 功能差距明细

**预览展示**：

当前预览状态由 4 个独立 boolean 控制（`isStartingPreview`、`isStoppingPreview`、`activePreviewRun`、`previewCapability.canPreview`），没有状态机。可能出现矛盾状态，且 `renderAs='web'` 在预览未启动时只显示空占位卡，不自动启动。

**评论能力**：

当前评论入口是组件树中的条件分支副产物，不是显式声明的能力矩阵。导致：
- `workflowPhase='planning'|'implementing'` 时编辑器被替换为占位动画 → 评论入口消失
- `renderAs='slides'` 没有任何评论入口
- `renderAs='web'` 依赖 bridge 注入，非标 HTML 或跨域时完全失效
- 没有 fallback：评论入口消失后用户无法创建任何评论

**i18n**：

`web-selection-comment-trigger.tsx` 中 `'评论'`、`'取消'`、`'提交中…'`、`'提交评论'` 等硬编码中文。`selection-comment-trigger.tsx` 中 `'Comment to AI'`、`'Cancel'` 等硬编码英文。中英混用，切换语言后这些文案不响应。

---

## 执行计划

### 新增文件结构

```text
src/framework/resilience/
├── index.ts                  # 统一导出
├── zone-error-boundary.tsx   # 区域级 ErrorBoundary 组件
├── global-error-handler.ts   # unhandledrejection + window.onerror 监听
├── error-ring.ts             # 本地错误日志环形缓冲区（最近 50 条）
├── safe-data.ts              # safeJsonParse / safeArray / safeGet
├── api-client.ts             # 统一 fetch wrapper（超时/重试/退避/类型安全）
├── poll-controller.ts        # 轮询控制器（指数退避 + 停止/恢复）
├── route-handler.ts          # 服务端 route handler wrapper
└── app-error.ts              # 业务错误类层次（AppError / NotFoundError / ValidationError）

src/app/
├── error.tsx                              # 全局路由错误页
├── not-found.tsx                          # 404 页
├── workspace/[workspaceId]/error.tsx      # 工作区错误页
└── settings/error.tsx                     # 设置页错误页
```

所有新文件归属 `framework/` 层，符合 CONVENTIONS.md 约定：`framework/` 放可复用 runtime，不出现成形业务对象名。

### Phase R1：基础设施落地（2 天）

建立四道防线的骨架，此阶段不迁移存量代码。

| 步骤 | 交付物 | 说明 |
|------|--------|------|
| R1.1 | `framework/resilience/app-error.ts` | 业务错误类层次：`AppError` → `NotFoundError` / `ValidationError` / `ConflictError`。所有已知错误类型都是 `AppError` 子类 |
| R1.2 | `framework/resilience/route-handler.ts` | `defineRoute(handler)` wrapper。handler 只写业务逻辑，wrapper 保证 try/catch + 统一 JSON 错误格式 + 日志 |
| R1.3 | `framework/resilience/safe-data.ts` | `safeJsonParse(raw, fallback, validator?)` / `safeArray(value)` / `safeGet(obj, path, fallback)` |
| R1.4 | `framework/resilience/api-client.ts` | `apiCall<T>(url, options)` 返回 `ApiResult<T>`（ok/error 判别联合）。内置超时（30s）、重试（可配）、退避（指数）|
| R1.5 | `framework/resilience/poll-controller.ts` | `createPollController({ fn, baseInterval, maxInterval })` 返回 `{ start, stop, reset }`。失败自动退避 |
| R1.6 | `framework/resilience/zone-error-boundary.tsx` | 区域级 ErrorBoundary。props：`zone`（日志标识）、`level`（critical/recoverable）、`fallback`。提供重试按钮 |
| R1.7 | `framework/resilience/global-error-handler.ts` | `initGlobalErrorHandlers()`：注册 `unhandledrejection` + `window.onerror`，写入 error-ring |
| R1.8 | `framework/resilience/error-ring.ts` | 环形缓冲区，localStorage 存最近 50 条错误，供诊断导出 |
| R1.9 | `app/error.tsx` + `app/not-found.tsx` + `app/workspace/[workspaceId]/error.tsx` + `app/settings/error.tsx` | 路由级错误页，纯 HTML + 内联样式，不依赖可能出错的组件 |
| R1.10 | ESLint 规则 | 禁裸 `JSON.parse`（指向 `safeJsonParse`）、禁裸 `fetch`（指向 `apiCall`，豁免 `api-client.ts` 自身和流式响应） |

**R1 完成标志**：`npm run lint` 对现有代码报出所有裸 `JSON.parse` 和裸 `fetch` 的 warning（先 warn 不 error，R2 迁移完再改 error）。

### Phase R2：存量迁移（2-3 天）

将现有代码迁移到 R1 基础设施上。

| 步骤 | 范围 | 操作 | 移除 |
|------|------|------|------|
| R2.1 | 50 个 API route | 全部改用 `defineRoute` | 移除各 route 内的手写 try/catch（由 wrapper 统一处理） |
| R2.2 | 18+ 处裸 JSON.parse | 全部改用 `safeJsonParse` | 移除各处的手写 try/catch JSON 解析 |
| R2.3 | 60+ 处裸 fetch | 前端非流式调用改用 `apiCall` | 移除各处的手写 `response.ok` 判断和错误格式解析 |
| R2.4 | `use-workspace-route-controller.ts` | `loadWorkspaceView` / `loadRuns` / `loadThreads` 改用 `apiCall` + 错误状态展示 | 移除 `void load*()` pattern，改为带错误处理的调用 |
| R2.5 | 轮询逻辑 | `PREVIEW_RUN_POLL` / `CONVERSATION_POLL` 改用 `createPollController` | 移除手写的 `setInterval` + `clearInterval` |
| R2.6 | Workspace page | `WorkspaceDeliverablePanel`、`WorkspaceAssistantRail`、sidebar 各包 `ZoneErrorBoundary` | 无移除 |
| R2.7 | Settings page | 每个 Card section 包 `ZoneErrorBoundary` | 无移除 |
| R2.8 | Layout | 在 `layout.tsx` 调用 `initGlobalErrorHandlers()` | 无移除 |
| R2.9 | ESLint 规则 | `JSON.parse` 和裸 `fetch` 从 warn 升级为 error | 如有遗漏迁移，CI 会拦截 |

**R2 完成标志**：`npm run lint` 零 warning 零 error；`npm run verify:iteration` 通过。

### Phase R3：功能缺陷修复（2 天）

基于 R1/R2 基础设施，修复报告的 4 个具体问题。

| 步骤 | 问题 | 方案 | 涉及文件 |
|------|------|------|----------|
| R3.1 | 预览不自动展示 | 引入预览状态机（`unavailable → ready → starting → running → error`）。`ready + canAutoStart` 时自动触发 `startPreview` | `canvas/document-canvas.tsx`、`surfaces/workspace/use-workspace-version-preview-controller.ts` |
| R3.2 | 评论入口消失 | 引入评论能力矩阵 `resolveCommentCapability(renderAs, phase, previewState)` 返回 `document-selection / web-selection / manual`。`manual` 作为通用 fallback，任何状态下都可创建评论 | `canvas/document-canvas.tsx`、新增 `derive/comment-capability.ts` |
| R3.3 | i18n 硬编码 | 收集 `selection-comment-trigger.tsx`、`web-selection-comment-trigger.tsx` 中所有硬编码文案，迁入 `lib/i18n/copy.ts` | 2 个 comment trigger 文件 + `copy.ts` |
| R3.4 | Bridge 注入不可靠 | `injectPreviewBridgeIntoHtml` 增加处理：无 `</body>`/`</head>` 时包裹完整 HTML 骨架；增加 `<meta charset>` 保证编码 | `lib/workspace/preview-bridge.ts` |

**R3 完成标志**：
- `renderAs='web'` 的交付物在有文件内容时自动显示预览
- 在 AI 工作阶段（planning/implementing）仍可创建评论
- `selection-comment-trigger.tsx` 和 `web-selection-comment-trigger.tsx` 中零硬编码文案

### Phase R4：验证闭环 + 合约更新（1 天）

| 步骤 | 内容 |
|------|------|
| R4.1 | 新增 E2E 测试：模拟 API 返回 500 → 验证 ErrorBoundary 降级 UI 出现 + 重试按钮可用 |
| R4.2 | 新增 E2E 测试：模拟 API 返回非 JSON → 验证不白屏 |
| R4.3 | 新增 E2E 测试：web 交付物创建后自动进入预览 |
| R4.4 | 新增 E2E 测试：AI implementing 阶段点击评论按钮 → 验证 manual 评论可以创建 |
| R4.5 | 更新 `CONVENTIONS.md`：新增"健壮性约定"章节，说明 `framework/resilience/` 的使用规范 |
| R4.6 | 更新 `PATTERNS.md`：新增"创建 API route"和"前端 API 调用"的标准 pattern |
| R4.7 | 更新 `CONSTRAINTS.md`：新增"裸 JSON.parse 禁止"、"裸 fetch 禁止"约束 |
| R4.8 | 更新 `docs/chengxing-lessons-learned.md`：记录本次改造的复盘 |

**R4 完成标志**：`npm run verify:iteration` 通过（含新增 E2E）；合约文档更新完毕。

### 执行顺序总览

```text
R1 基础设施（2d）→ R2 存量迁移（2-3d）→ R3 功能修复（2d）→ R4 验证闭环（1d）
总计 7-8 天
```

依赖关系：R2 依赖 R1；R3 依赖 R2（使用 apiCall 和 ZoneErrorBoundary）；R4 依赖 R3。不可并行。

---

## 验收标准

### 运行时行为验收

| # | 场景 | 预期行为 | 验证方式 |
|---|------|----------|----------|
| A1 | 任意一个组件渲染抛出 Error | 只有该区块显示降级 UI + 重试按钮，兄弟区块正常 | E2E：注入故障组件 → 截图对比 |
| A2 | API route 抛出未捕获异常 | 返回 `{ error, detail, kind }` JSON，status 500，不返回 HTML | E2E：mock route 抛出 → 验证 response 格式 |
| A3 | 前端 fetch 返回非 JSON（如 502 HTML） | `apiCall` 返回 `{ ok: false, error: { kind: 'parse' } }`，不抛出 | 单元测试 |
| A4 | 网络断开 | `apiCall` 返回 `{ ok: false, error: { kind: 'network', retryable: true } }`，不抛出 | 单元测试 |
| A5 | 轮询目标连续失败 5 次 | 轮询间隔从 3s 退避到 48s（3 × 2⁴），不雪崩 | 单元测试 |
| A6 | `JSON.parse` 目标是非法 JSON | `safeJsonParse` 返回 fallback 值，不抛出 | 单元测试 |
| A7 | `renderAs='web'` 交付物有文件内容 | 自动启动预览，不需要用户手动操作 | E2E |
| A8 | AI 处于 implementing 阶段 | 评论入口（至少 manual 模式）仍然可用 | E2E |
| A9 | 切换语言到 English | 评论相关 UI 全部显示英文，无中文残留 | E2E |

### 编译期验收

| # | 检查项 | 预期 | 验证方式 |
|---|--------|------|----------|
| B1 | `src/` 中裸 `JSON.parse` | ESLint error，0 处（豁免文件除外） | `npm run lint` |
| B2 | `src/` 中裸 `fetch`（非流式） | ESLint error，0 处（豁免文件除外） | `npm run lint` |
| B3 | `src/app/api/` 中的 route handler | 全部通过 `defineRoute` 导出 | `npm run lint` 或 grep 验证 |
| B4 | `npm run verify:iteration` | 通过，含新增 E2E | CI |

### 合约文档验收

| # | 文档 | 更新内容 |
|---|------|----------|
| C1 | `CONVENTIONS.md` | 新增"健壮性约定"章节 |
| C2 | `PATTERNS.md` | 新增 `defineRoute` 和 `apiCall` 的使用 pattern |
| C3 | `CONSTRAINTS.md` | 新增禁裸 `JSON.parse`、禁裸 `fetch` 约束 |
| C4 | `docs/chengxing-lessons-learned.md` | 记录"运行时安全层"作为 validated 经验 |

### 不在本次范围内

以下事项记录但不在本 brief 执行范围：

- `settings/page.tsx`（1165 行）拆分为子组件 — 重构类任务，非健壮性
- `comment-sidebar.tsx`（2184 行）拆分 — 重构类任务，非健壮性
- 远端错误上报 — 依赖云端基础设施，当前先写本地 error-ring
- `renderAs='slides'` 的精确评论锚点 — 产品特性，非健壮性
