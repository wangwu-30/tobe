# 验收问题修复方案

> 日期：2026-03-24
> 对应验收报告：[product-acceptance-report-20260324.md](file:///Users/wangwu/.gemini/antigravity/brain/2f6652fc-11a9-4b11-9a17-e9ef588005f3/product-acceptance-report-20260324.md)

> [!IMPORTANT]
> **核心原则**：存储可以直接是 Plate JSON，平台上始终查看渲染结果并在结果上评论；导出支持多格式（前期先 md）。底层格式用户无需感知。

---

## P1-1 文档内容展示原始 Markdown → 始终渲染结果

### 现状

AI 生成的文档内容存储为 `kind=markdown` 的纯文本 Markdown。[isPlateBackedWorkspaceFile](file:///Users/wangwu/claude/chat-to-your-mind/src/lib/workspace/file-presentation.ts#L28-37) 只在两种情况返回 `true`：
1. `kind === 'richtext'`
2. `kind === 'markdown'` 且内容是 Plate JSON 数组

AI 输出的纯 Markdown 文本**不满足条件 2**（不是 JSON），因此 [buildDeliverablePanel](file:///Users/wangwu/claude/chat-to-your-mind/src/canvas/document-canvas/document-canvas.tsx#L278-290) 直接走到 `SourceDeliverableCanvas`（CodeMirror 源码视图）。

### 目标

用户进入文档工作区后，**始终看到渲染后的富文本**，不暴露 `##`、`---`、`**` 等 Markdown 语法。
底层存储**直接改为 Plate JSON**，不再纠结 md 存储。需要 md 时通过导出获得。

### 差距

1. 现有 AI 产出的内容是纯 markdown，需要转为 Plate JSON 后存储
2. 缺少 `markdownToPlate` 转换器（只有反向的 `plateToMarkdown`）
3. 需要一次性迁移：将已有的 markdown 内容转为 Plate JSON

### 执行计划

1. **引入 `markdownToPlate` 转换器**
   - 使用 `@platejs/markdown` 反序列化器
   - 位置：新建 `src/lib/serializer/markdown-to-plate.ts`

2. **修改 AI 输出流水线**
   - AI 返回 markdown 后，在存储前调用 `markdownToPlate` 转为 Plate JSON
   - 存储时 `kind` 设为 `richtext`，`content` 为 Plate JSON 字符串
   - 这样 `isPlateBackedWorkspaceFile` 自然返回 `true`

3. **修改 `isPlateBackedWorkspaceFile`**
   - 对 `kind=markdown` 的 output 类文件，作为兼容层也返回 `true`
   - 在 `parsePlateContent` 中增加分支：遇到纯 markdown 内容时调用 `markdownToPlate` 转换

4. **导出支持**
   - 新建 `src/lib/workspace/export.ts`
   - 导出 md：调用 `plateToMarkdown` 将 Plate JSON → markdown 文本 → 浏览器下载

5. **涉及文件**：
   - `src/lib/workspace/file-presentation.ts` — 兼容层
   - `src/canvas/document-canvas/document-canvas.tsx` — `parsePlateContent` 增加 md→Plate 分支
   - 新增：`src/lib/serializer/markdown-to-plate.ts`
   - 新增：`src/lib/workspace/export.ts`
   - AI conversation runner（修改输出存储逻辑）

### 验收标准

- 进入任何文档类工作区，中央区域显示渲染后的标题、粗体、列表、分隔线（Plate 富文本编辑器）
- 不出现 `##`、`**`、`---`、` ``` ` 等原始语法
- 新内容直接以 Plate JSON 存储
- 历史 markdown 内容通过兼容层自动转换渲染
- 导出 md 按钮可获得 markdown 文件
- 现有 E2E 测试通过

---

## P1-2 Web 项目展示源码 → 默认显示预览结果

### 现状

Web 类型交付物（`renderAs=web`）进入时，如果 `showImplementation=true`，会绕过 `WebDeliverableCanvas` 直接走到 Plate 编辑器或 `SourceDeliverableCanvas`。当前 [use-workspace-shell-controller.ts](file:///Users/wangwu/claude/chat-to-your-mind/src/surfaces/workspace/use-workspace-shell-controller.ts#L41-43) 会根据 `renderAs` 决定是否使用 intent canvas，但 `showImplementation` 可能被错误设为 `true`。

### 目标

Web 项目进入时**默认展示 iframe 预览**，仅在用户主动点击"查看实现"时切换到源码。

### 差距

`showImplementation` 的初始值没有根据 `renderAs=web` 做默认覆盖。

### 执行计划

1. **修改 `showImplementation` 默认值逻辑**
   - 在 [use-workspace-shell-controller.ts](file:///Users/wangwu/claude/chat-to-your-mind/src/surfaces/workspace/use-workspace-shell-controller.ts) 中，当 `renderAs === 'web'` 时，`showImplementation` 默认为 `false`
   - 仅在用户明确切换"查看实现"时变为 `true`

2. **确保 preview 自动启动**
   - 进入 web 工作区时，如果没有活跃的 preview run，自动触发 `onStartPreview`
   - 避免停留在"预览已启动"的空态

3. **涉及文件**：
   - `src/surfaces/workspace/use-workspace-shell-controller.ts`
   - `src/app/workspace/[workspaceId]/page.tsx`（`showImplementation` 状态初始化）

### 验收标准

- 点击 web 类项目卡片进入工作区，直接看到渲染后的网页预览
- 不看到 JSX/React 源码
- 可以通过"查看实现"切换到源码视图

---

## P1-3 工作区侧栏被全局项目列表淹没 → 上下文敏感侧栏

### 现状

[DeliverableSidebar](file:///Users/wangwu/claude/chat-to-your-mind/src/components/workspace/deliverable-sidebar.tsx) 采用垂直堆叠：项目列表 → 搜索 → 目录 → 关联项目 → 大纲 → 支持资料。当项目数 ≥ 8 时，搜索和大纲被推到 fold 以下。

### 目标

进入工作区后，侧栏**首屏**展示当前项目的导航工具（大纲、目录、搜索），全局项目列表收纳。

### 执行计划

1. **将侧栏分为两个区域**：
   - **上区（固定高度）**：当前项目名 + 下拉切换器（popover）
   - **下区（主体，填满剩余空间）**：搜索 → 目录 → 大纲 → 关联项目 → 支持资料

2. **项目列表改为 popover**：
   - 侧栏顶部显示「当前项目名 ▾」
   - 点击后在旁边弹出浮层面板，列出所有项目
   - 选择项目后浮层关闭，侧栏更新为该项目的工具
   - 浮层点击外部或按 Escape 关闭
   - 使用 shadcn/ui 的 `Popover` 组件实现

3. **涉及文件**：
   - `src/components/workspace/deliverable-sidebar.tsx` — 重排 section 顺序 + 项目列表折叠化

### 验收标准

- 进入工作区，首屏可见搜索 + 目录 + 大纲
- 项目列表可通过单击展开，不占首屏空间

---

## P1-4 项目卡片操作语义不清 → 直白文案

### 现状

[ProjectCard](file:///Users/wangwu/claude/chat-to-your-mind/src/components/layout/project-card.tsx) 使用 i18n key：
- `t('sidebar.continueCurrentDeliverable')` → "继续当前内容"
- `t('sidebar.newSiblingDeliverable')` → "继续下一项内容"

两个标签都含"继续"，区别靠"当前"vs"下一项"——但用户不知道"当前"和"下一项"指什么。

### 目标

卡片操作一目了然，无需解释。

### 执行计划

1. **修改 i18n 文案**：
   - "继续当前内容" → **"打开"**（zh）/ **"Open"**（en）
   - "继续下一项内容" → **"新建内容"**（zh）/ **"New item"**（en）

2. **简化卡片结构**：
   - "最近活跃内容" section：单 node 项目隐藏此 section（与 P2-3 合并处理）
   - 主操作：整个卡片可点击打开（已实现）
   - 次操作：底部 "新建内容 +" 保留

3. **涉及文件**：
   - `src/i18n/zh.json` + `src/i18n/en.json` — 更新翻译
   - `src/components/layout/project-card.tsx` — 条件隐藏单 node 的"最近活跃"区块

---

## P2 批量方案（6 项）

### P2-1 折叠侧栏不可读 + P2-5 折叠态大纲不可用

**方案**：折叠态不显示项目列表，改为显示功能图标栏（类似 VS Code Activity Bar）：
- 搜索 icon → 点击弹出搜索 popover
- 大纲 icon → 点击弹出大纲 popover
- 新建 icon → 触发新建项目
- 设置 icon → 跳转设置

**涉及文件**：`src/components/layout/app-shell.tsx`（折叠态渲染分支）

---

### P2-2 版本控制栏过密

**方案**：将控件分层：
- 主层（始终可见）：状态胶囊 + "保存里程碑" 按钮
- 副层（下拉/hover）：比较、版本树、Pin 计数、临时位计数

**涉及文件**：工作区顶栏组件（定位后更新）

---

### P2-3 卡片"最近活跃内容"重复 + P2-4 副标题对比度 + P2-6 设置按钮分隔

**方案**：
- P2-3：`ProjectCard` 中当 `deliverableCount <= 1` 时隐藏 "最近活跃内容" 区块
- P2-4：副标题 `text-xs text-muted-foreground` → `text-xs text-foreground/60`
- P2-6：设置按钮添加 `sticky bottom-0` + `border-t border-border`

**涉及文件**：
- `src/components/layout/project-card.tsx`
- `src/components/layout/app-shell.tsx`（sidebar footer）

---

## P3 批量方案（4 项）

全部为 i18n 文案和样式微调：

| 问题 | 修改 | 文件 |
|------|------|------|
| P3-1 "X 项内容" | → "X 个节点" 或 "X 份内容" | `src/lib/workspace/project-summary.ts` + i18n |
| P3-2 "AI 原生写作" 标签 | 增大字号或加品牌色 | `src/app/page.tsx` hero section |
| P3-3 顶栏副标题过长 | 精简为"目标驱动创作" | i18n key |
| P3-4 统一"昨天"时间 | 保持不变（相对时间合理） | 无需修改 |

---

## 导出能力（新增）

### 现状

当前无导出功能。

### 目标

支持将内容导出为文件，前期先支持 md 格式，后续扩展 doc/pdf。

### 执行计划

1. 工作区顶栏添加"导出"按钮（或收入更多菜单）
2. 点击后调用 `plateToMarkdown` 获取 md 文本
3. 使用 `Blob` + `URL.createObjectURL` + `<a download>` 触发浏览器下载
4. 文件名默认为交付物标题 + `.md`

**涉及文件**：新建 `src/lib/workspace/export.ts` + 工作区顶栏组件

---

## 执行分批建议

| 批次 | 内容 | 预估工时 |
|------|------|----------|
| **Batch 1** | P1-1 md 渲染 + P1-2 web 预览默认 | 半天 |
| **Batch 2** | P1-4 卡片文案 + P2-3 卡片简化 + P2-4/P2-6 样式微调 + P3 文案 | 2 小时 |
| **Batch 3** | P1-3 侧栏重构 + P2-1/P2-5 折叠态重做 | 半天 |
| **Batch 4** | P2-2 版本控制栏简化 | 2 小时 |
| **Batch 5** | 导出能力 | 2 小时 |

> 每批完成后跑 `npm run verify:iteration`。
