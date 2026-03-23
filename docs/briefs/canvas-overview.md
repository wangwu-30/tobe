# Canvas 总览 — 执行计划

> 日期：2026-03-23
> 状态：待执行
> 依赖：Node Facade（已完成）、路由重构（进行中）
> 技术选型：[tldraw](https://github.com/tldraw/tldraw)（React, MIT）

## 核心思路

Canvas 是现有数据的另一种视图模式。同一份 Project/Node 数据，列表看、树看、画布看。

---

## 两层 Canvas + 入口位置

### 1. 项目画布（优先）

**入口**：工作区顶栏视图切换 `编辑 | 总览`，默认编辑。

中央区域从当前 Node 编辑器切换为 tldraw 画布，画布上每个 Node 是一张卡片。

卡片内容：Node 名 · 类型图标（📄/🌐/🎨） · 状态色（草稿灰/编辑中蓝/完成绿） · 前 2 行摘要。
交互：拖拽排列 · 画依赖线 · 双击进入 Node 编辑 · 右键重命名/删除。

### 2. 全局画布

**入口**：首页中央区域视图切换 `列表 | 画布`，默认列表。

画布上每个 Project 是一张卡片，mount 关系自动渲染为连线。

卡片内容：项目名 · Node 数 · 最近活跃时间。
交互：拖拽排列 · 画 mount 连线 · 双击进入项目画布。

---

## 数据接口（Already Done）

Canvas 所需的全部数据接口已在 `src/lib/workspace/node.ts` 中就绪：

| 接口 | Canvas 用途 |
|------|-----------|
| `listProjectNodes()` | 项目画布：获取全部 Node 列表及摘要 |
| `getProjectNodeCatalog()` | 项目画布：获取项目标题 + 全部 Node |
| `listMountedProjects()` | 全局画布：渲染 mount 连线 |
| `readNodeContent()` | 双击 Node 时加载完整内容 |
| `searchProjectNodes()` | 画布内搜索定位 |

---

## 数据模型扩展

在现有模型上加坐标元数据（JSON 字段，避免 schema 迁移）：

```prisma
model Document {
  // 已有字段...
  canvasMetaJson  String?   // { x: number, y: number, width?: number }
}
```

全局画布的 Project 坐标存在一张新的轻量配置表中，或直接存在 Organization 级的 JSON 配置里。

首次打开画布时 x/y 为空 → 自动网格布局（按 treeSortOrder 排列）。用户拖拽后持久化坐标。

---

## 执行步骤

### Canvas Step 1：tldraw 集成 + 项目画布骨架（~2 天）

#### [NEW] `src/components/canvas/project-canvas.tsx`

- 集成 tldraw React 组件
- 自定义 shape：`NodeCard`（渲染 Node 名称 + 类型 + 状态）
- 数据加载：调用 `getProjectNodeCatalog()` → 映射为 tldraw shapes
- 坐标加载/持久化：从 `canvasMetaJson` 读取 → 拖拽后写回

#### [MODIFY] 工作区顶栏

添加 `编辑 | 总览` 视图切换按钮。
- 编辑 → 渲染现有 `buildDeliverablePanel`
- 总览 → 渲染 `ProjectCanvas`

**退出条件**：进入项目 → 切换到总览 → 看到 Node 卡片 → 拖拽可动 + 位置持久化 + `verify:iteration` 通过

### Canvas Step 2：项目画布交互完善（~1.5 天）

- 双击 Node 卡片 → 退出画布，进入该 Node 编辑视图（更新 `?node=` query param）
- 右键菜单：重命名 · 删除 · 新建 Node
- 画依赖线：两个 Node 之间拖线 → 存储为 Node 关系元数据
- 状态色渲染：根据 Node 的 workflow phase 变色

**退出条件**：双击跳转 + 右键菜单可用 + `verify:iteration` 通过

### Canvas Step 3：全局画布（~1.5 天）

#### [NEW] `src/components/canvas/global-canvas.tsx`

- 数据加载：获取所有 Project 列表 + mount 关系
- 自定义 shape：`ProjectCard`
- mount 连线：自动渲染已有 mount 关系为箭头连线
- 双击 Project → 进入该项目的项目画布

#### [MODIFY] 首页中央区域

添加 `列表 | 画布` 视图切换。

**退出条件**：首页画布可视 + mount 连线正确 + 双击跳转 + `verify:iteration` 通过

### Canvas Step 4：AI 自动布局（~1 天）

对于新项目或从未打开过画布的项目，首次进入时：
- Node 数 ≤ 10：自动网格布局
- Node 数 > 10：按 `treeSortOrder` + `updatedAt` 生成分层布局（产出在上，素材在下）
- mount 来源 Node 在外围

可选增强：调用 AI 根据 Node 标题和关系生成更智能的空间分组。

**退出条件**：新项目首次打开画布有合理的默认布局 + `verify:iteration` 通过

---

## 暂不执行

| 项目 | 理由 |
|------|------|
| 画布协作（多人实时） | 需要 WebSocket 基础设施 |
| 画布内嵌入编辑（不离开画布直接编辑 Node） | tldraw 支持但复杂度高，先用双击跳转 |
| 画布导出为图片 | 低优先级 |

---

## 总预估 ~6 天

```
CS1 (2d)     → CS2 (1.5d)    → CS3 (1.5d)    → CS4 (1d)
tldraw集成     项目画布交互     全局画布         AI 自动布局
骨架+卡片      双击+右键+连线   Project卡片      智能排列
```

## 验证方式

每个 Step 完成后：`npm run verify:iteration`
