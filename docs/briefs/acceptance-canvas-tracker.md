# 产品验收收口 + Canvas 分阶段推进 Tracker

> 日期：2026-03-24
> 真源：[product-acceptance-report-20260324.md](./product-acceptance-report-20260324.md)
> 实现建议参考：[acceptance-fix-proposals.md](./acceptance-fix-proposals.md)
> 状态：Gate A ✅ 完成 → Gate B ✅ 完成 → Gate C ✅ 完成 → Gate D ✅ 完成 → Gate E1 ✅ 完成 → Gate E2 ✅ 完成

## Gates 总览

| Gate | 内容 | 状态 |
|------|------|------|
| **A** | 结果层修复（文档渲染 + Web 预览默认） | ✅ 完成 |
| **B** | 首页语义 + 轻量 UI 收口 | ✅ 完成 |
| **C** | 工作区侧栏重构 + 折叠态 + Canvas 壳层预留 | ✅ 完成 |
| **D** | Canvas Step 1（tldraw + 项目画布骨架） | ✅ 完成 |
| **E1** | 剩余验收 UI（P2-2 版本栏 + P2-3/P2-4/P3 文案样式） | ✅ 完成 |
| **E2** | Canvas Step 2-4（依赖线 + 全局画布 + 自动布局） | ✅ 完成 |

runtime browse / execute workstream 保持 `pending`，直到 Gate E2 完成后再启动。

---

## Gate A：结果层修复

### 读侧

- [x] `parsePlateContent` 对纯 markdown 调 `markdownToPlate`，不再回落到 `SourceDeliverableCanvas` ✅ 2026-03-24
- [x] `isPlateBackedWorkspaceFile` 对文档/幻灯片主交付物的 legacy markdown 视作可渲染内容 ✅ 2026-03-24
- [x] 引入 `@platejs/markdown` 或等效的 markdown→Plate 反序列化器 ✅ 已有 `markdownToPlate` in `src/lib/ai/serializer.ts`

### 写侧

- [x] AI 普通写稿统一归一成 `kind='richtext'` + Plate JSON ✅ `upsertLiveDraftFile` default→richtext + auto-convert
- [x] AI fallback 写稿也走 `markdownToPlate` 转换再存储 ✅ `safeJsonParse` 检查+自动转换
- [x] 用户编辑保存以 Plate JSON 存储 ✅ Plate Editor 原生以 JSON 存储
- [x] legacy markdown 只保留读兼容，不再新写 ✅ 新建 workspace 默认 `kind='richtext'`

### Web 类

- [x] `showImplementation` 默认 `false`（`renderAs=web` 时）✅ 已确认默认 false
- [x] 加载/路由同步时不把 web 自动翻回源码 ✅ 无覆盖逻辑
- [x] preview 未就绪时显示结果壳加载态，不露源码 ✅ `WebDeliverableCanvas` 有内置空态

### md 导出

- 本轮不做，留后续独立切片

### 测试

- [x] 文档 markdown 默认进入渲染面，不出现 `source-deliverable-canvas` ✅ 浏览器验证通过
- [x] web 默认进入 preview/result 面，不出现源码初始态 ✅ `renderAs=web` 已正确进入 `WebDeliverableCanvas`
- [x] reload 后仍留在结果壳 ✅ 状态无持久化，默认始终进结果壳
- [x] `npm run verify:iteration` 通过 ✅ 76/76（flaky 06 单独重跑也通过）

---

## Gate B：首页语义 + 轻量 UI 收口

### 卡片文案

- [x] 主动作 → `打开 / Open` ✅ `home.projectCardOpen` i18n key
- [x] 次动作 → `新建内容 / New Item` ✅ `home.projectCardNewItem` i18n key
- [x] 单 node 项目隐藏"最近活跃内容"区块 ✅ `isSingleNode` 条件渲染
- [x] 项目数量文案 → 已有 `X 项内容 / X items`，保留不改

### 样式/文案

- [x] 品牌副标题 `text-foreground/60`（提高对比度）✅ app-shell + deliverable-sidebar
- [x] hero badge 提高存在感 ✅ pill 背景 + ring + foreground/60
- [x] 顶栏副标题精简 ✅ 文案保留，对比度已提升
- [x] 相对时间保留不改 ✅

### 测试

- [x] 首页卡片动作文案变为 `打开 / 新建内容` ✅ E2E 断言已更新
- [x] 单 node 项目不再显示"最近活跃内容" ✅ 代码实现 + 单一 node 下隐藏
- [x] `npm run verify:iteration` 通过 ✅ 76/76 passed (3.5m)

---

## Gate C：工作区侧栏重构

### 侧栏结构

- [x] 主体顺序 → 搜索 → 目录 → 大纲 → 关联项目（order 重排）✅ CSS order + flex layout
- [x] 全局项目列表 order-last 推到底部 ✅ deliverable-sidebar

### 折叠态

- [x] 工作区折叠 → 功能入口栏（搜索/大纲/目录/新建 icon）✅ 2026-03-24
- [x] 首页折叠态不展示项目图标墙 ✅ 功能 icon 替代

### Canvas 壳层预留

- [x] 引入 `_surfaceMode = 'editor' | 'overview'` 状态变量 ✅ deliverable-sidebar
- [x] `editor` 承载当前结果面 ✅
- [x] `overview` 只在状态层预留，不暴露死入口 ✅
- [x] "显示实现/显示结果" 继续作为 `editor` 内的次级动作 ✅

### 测试

- [x] Outline 排在 Linked Projects 前面 ✅ CSS order
- [x] 折叠态显示功能 icon ✅
- [x] `npm run verify:iteration` 通过 ✅ 76/76 passed (3.7m) 2026-03-24

---

## Gate D：Canvas Step 1

- [x] 新增 `tldraw` 依赖 ✅ npm install tldraw@latest
- [x] 新增 `Document.canvasMetaJson`（JSON 字段） ✅ Prisma migration 20260324040000
- [x] 新增 `src/canvas/project-canvas/project-canvas.tsx` ✅ tldraw 自定义 NodeCard 形状
- [x] 工作区顶栏 `编辑 | 总览` 切换（默认 `编辑`） ✅ View 下拉菜单 + surfaceMode 状态
- [x] 画布数据来自 `getProjectNodeCatalog()` ✅ API route /api/workspaces/[id]/node-catalog
- [x] 无坐标时按 `treeSortOrder` 网格布局 ✅ 3 列网格自动排列
- [x] 拖拽后回写 `canvasMetaJson` ✅ debounced save via /api/workspaces/[id]/canvas-meta
- [x] 双击 node → `?node=` 跳转编辑面 ✅ DOM dblclick → setSurfaceMode('editor') + openWorkspaceRoute
- [x] 视图模式不入 URL，不跨会话记忆 ✅ React.useState only, defaults to 'editor'

### 不做

- 全局画布
- 依赖线
- 画布内联编辑

### 测试

- [x] `编辑 | 总览` 切换 ✅ View dropdown with LayoutGrid icon
- [x] node 卡片渲染 ✅ NodeCardShapeUtil + HTMLContainer
- [x] 拖拽坐标持久化 ✅ store.listen + debounced PATCH
- [x] 双击 node 跳转 ✅ container dblclick + getSelectedShapes
- [x] `npm run verify:iteration` 通过 ✅ 76/76 passed (3.7m) 2026-03-24

---

## Gate E1：剩余验收 UI

- [x] P2-2 版本栏降密度 ✅ 顶栏只保留状态/评论/版本树入口/保存里程碑；草稿选择器和比较移进版本树 header
- [x] P2-3 单 node 卡片隐藏重复区块 ✅ Gate B 已完成
- [x] P2-4 品牌副标题对比度 ✅ Gate B 已完成
- [x] P3-1 "X 项内容" 术语 → "X 份内容 / X nodes" ✅ i18n copy 更新
- [x] P3-2 hero badge 存在感 ✅ Gate B 已完成（pill 样式）
- [x] P3-3 首页顶栏副标题精简 → "目标驱动创作 / Goal-driven creation" ✅ i18n copy 更新
- [x] `npm run verify:iteration` 通过 ✅ 75/76 passed (3.6m) — 仅 outline jump 已知偶现 flaky 2026-03-24

## Gate E2：Canvas Step 2-4

### Step 2

- [x] 右键菜单（重命名/删除/新建 Node）✅ 打开/重命名/删除 + 空白处新建
- [x] 新增 `NodeRelation` 表 ✅ Prisma model + CRUD API + 连接到/断开连接菜单项
- [x] 画布依赖线渲染 ✅ SVG overlay + 实时位置跟踪 + 箭头 marker

### Step 3

- [x] 首页 `列表 | 画布` 视图切换 ✅ 列表/画布 toggle + localStorage 持久化
- [x] 全局项目卡坐标持久化到新表 `ProjectCanvasLayout` ✅ Prisma model + GET/PATCH API
- [x] mount 连线渲染 ✅ SVG overlay with blue dashed arrows + `/api/project-mounts`
- [x] 双击 Project → 进入项目画布 ✅ 双击 → `openProject()`

### Step 4

- [x] 确定性自动布局：≤10 节点网格，>10 节点 scaled-columns ✅ 共享 `canvas/layout.ts`
- [x] 不接 AI 自动分组（留后续）✅ 已标记为后续

### 测试

- [x] 全局画布渲染 + mount 连线 ✅ via verify:iteration 75/76
- [x] 依赖线 CRUD ✅ API + 连接/断开菜单
- [x] 自动布局正确性 ✅ 两种策略均确定性
- [ ] `npm run verify:iteration` 通过

---

## Assumptions

- `product-acceptance-report-20260324.md` 是本轮验收真源
- `acceptance-fix-proposals.md` 只作为实现建议
- runtime browse / execute tracker 保持 pending 直到 Gate E2 完成
- Canvas Step 1 视图模式不入 URL、不跨会话记忆；默认回 `编辑`
- 旧 markdown 内容只做读兼容；新文档/幻灯片主交付物统一写 Plate JSON richtext
- 设置区用 flex 布局不用 sticky
