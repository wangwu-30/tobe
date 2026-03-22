# 统一工作空间模型：从 Deliverable 到 Project + Node

> 变更类型：架构方向
> 日期：2026-03-23
> 状态：方向已收敛，待拆解执行计划

---

## 现状

### 当前对象模型

```
Project ──┬── Deliverable 1 (独立 Workspace + Conversation)
          ├── Deliverable 2 (独立 Workspace + Conversation)
          └── Deliverable 3
```

### 问题清单

1. **"交付物"概念对用户无意义**：用户在写书、做调研、搭网站时，脑子里没有"交付物"这个词。系统强迫用户理解内部实现细节。
2. **Deliverable 之间 AI 上下文割裂**：每个 Deliverable 有自己的 Conversation，AI 无法跨 Deliverable 工作（如"把浏览器里看到的内容总结到 PRD 里"）。
3. **无法建模"积累型"内容**：浏览收藏、画词批注、知识碎片不属于任何项目，没有归属感。
4. **无法建模浏览器等新形态**：Browser 是"输入/研究"，不是"交付物"，语义不通。
5. **Sidebar 暴露过多实现细节**：首页侧栏出现"继续当前交付物""继续下一份交付物"等反直觉的按钮。

---

## 目标

### 统一对象模型：只有两个概念

| 概念 | 职责 |
|------|------|
| **Project** | 工作空间容器。系统不区分"知识库"还是"创作项目"，都是 Project。 |
| **Node** | 内容单元。类型由 RenderAdapter 决定（文档/网页/浏览器/画布）。 |

> **设计决策**：Library 不是独立概念，它就是一个普通的长期 Project。"知识库"和"Blog 项目"的区别仅在于用户的使用模式（持续积累 vs 有起有终），底层模型完全一致。概念越少越好。

```
Project "我的收藏库" (长期，持续积累)     Project "AI 趋势 Blog" (有边界)
├── 📌 Tweet: Agent 架构               ├── 📄 Blog 正文
├── 📌 Arxiv: Attention 论文            ├── 🌐 落地页预览
├── 📌 GitHub: pi-agent README          └── (mount: 我的收藏库)
└── ...500 条                               → AI 可读取收藏库素材
```

Chat、Playbook、Version 等不是独立顶层概念，而是 Project / Node 的属性：

| 能力 | 归属 | 理由 |
|------|------|------|
| Chat | Project 级 | AI 需要跨 Node 工作 |
| Version | Node 级 | 每个文档有自己的历史 |
| Comments | Node 级 | 评论锚定在具体内容上 |
| Playbook | Project 级（可继承全局） | 调教 AI 的规则 |

### AI Context 权限模型

AI 的上下文不封闭在单个 Project 内，而是通过 **mount（挂载）** 实现跨项目访问：

```
Project A 的 AI 可见范围：
├── 自身 Nodes（完整内容 or 摘要，取决于焦点）
├── Project-level Playbook
└── 已挂载的其他 Project（只读引用，需显式声明）
    例：mount "我的收藏库" → AI 可检索其中的 Node
```

类比：Unix 的 mount / Git 的 submodule。挂载是单向的、只读的。

### AI 焦点控制 (Focus Set)

一个 Project 可能有 30+ Nodes，不可能全部塞进 context window。焦点分层：

| 层级 | 始终在 context | 内容 |
|------|---------------|------|
| Layer 0 | ✅ | Playbook + Project-level Notes |
| Layer 1 | ✅ | 当前打开的 Node（完整内容） |
| Layer 2 | 摘要 | 其他 Nodes（仅标题 + 前 N 行） |
| Layer 3 | 按需 | 挂载的外部 Project / Library 引用 |

用户在 Sidebar 点击不同 Node 时，Layer 1 自动切换。

### Node 索引：当 Node 数量 > 50 时如何找到东西

树形导航在 Node < 50 时好用，但一个收藏库可能有 500+ Node。需要三层索引机制：

| 层级 | 机制 | 适用场景 |
|------|------|----------|
| **人工导航** | 树形目录 + 拖拽排序 | Node < 50，结构明确（如书的章节） |
| **搜索 + 标签** | 全文检索 + 用户打的 tag | Node 50~500，用户主动找 |
| **语义检索** | Embedding 向量索引，AI 自动召回 | Node 500+，AI 按需拉取相关素材 |

实现优先级：
1. **先做搜索**（全文匹配，成本低，立即有用）
2. **再做标签**（Node 元数据加 tags 字段，Sidebar 支持按 tag 过滤）
3. **最后做语义检索**（需要 embedding pipeline，是 AI context 的加速器）

对于 AI 的 Focus Set，语义检索的作用是：当用户说"写一篇关于 Agent 架构的 Blog"，AI 能从 500 条收藏中自动召回最相关的 5~10 条，而不需要用户手动挑选。

---

## 差距

### 从当前架构到目标架构的 Gap

| 维度 | 当前 | 目标 | Gap |
|------|------|------|-----|
| 内容建模 | Project → Deliverable (2级) | Project → Node Tree (N级) | 需重构数据模型，Deliverable → Node |
| AI 上下文 | 绑定单个 Deliverable | 绑定 Project，可挂载外部 | Conversation 提升到 Project 级 |
| 知识库 | 不存在 | Library（全局） | 全新模块 |
| 浏览器 | 不存在 | Browser 类型 Node | 全新 RenderAdapter |
| Sidebar | 暴露实现细节 | 纯净节点树 | UI 重构（已开始） |
| 发布 | 不存在 | Node 可 export/deploy | 全新流程 |

---

## 执行计划（建议分期）

### Phase 0：Sidebar 减法（已完成一半）
- [x] 去掉首页双按钮，整行可点
- [x] "交付物" → "内容" 文案替换
- [ ] 首页中央区域改为项目卡片列表（有项目时隐藏 Hero）
- [ ] `npm run verify:iteration` 通过

### Phase 1：Deliverable → Node 重命名 + 树结构
- 数据层：Deliverable 表增加 `parent_id`, `sort_order` 字段，支持嵌套
- UI 层：Sidebar 渲染为可折叠树（DnD 排序）
- AI 层：Conversation 从 Workspace 级提升到 Project 级
- 不改底层存储，只加字段

### Phase 2：Node 索引 + 跨项目挂载
- Node 元数据加 tags 字段
- Sidebar 内搜索（按标题/标签过滤）
- Project 间 mount 声明机制
- AI context builder 支持挂载的外部 Project

### Phase 3：Browser Node
- 内置浏览器画布（基于 iframe / Playwright / webview）
- 画词批注 + 收藏到 Library
- AI 可读取当前浏览页面内容

### Phase 4：AI 语义检索
- Embedding 向量索引 pipeline
- AI 自动召回挂载 Project 中的相关 Node

---

## 验收标准

### 架构级
1. 用户在任何 UI 上不再看到"交付物"/"Deliverable"字样
2. 一个 Project 下的所有 Node 共享同一个 AI Chat context
3. Project 间可通过 mount 实现跨项目引用
4. Node 数量 > 50 时，Sidebar 提供搜索 + 标签过滤
5. 新增的 Node 类型（Browser）与 Document 在 Sidebar 中无差别呈现

### 场景级
1. **写书**：Project = 书，Node = 各章节，拖拽排序 = 目录，AI 跨章节理解全书
2. **Blog 工作流**：浏览 X/GitHub → 收藏到 Library → 新建 Blog Project → 拉入 Library 素材 → AI 起草 → Review → 发布
3. **浏览器研究**：在 Browser Node 中打开网页 → 画词批注 → 一键存入 Library → 在另一个 Project 中引用

---

## 用户场景验证：个人博客维护

```
日常（Phase A：积累）                   偶发（Phase B：创作）
┌──────────────────────────┐          ┌───────────────────────────┐
│ 浏览 X / GitHub / Arxiv   │          │ 产生 Blog 灵感              │
│ → 画词批注                 │          │ → 新建 Blog Project         │
│ → 收藏到 Library           │  ──触发──▶│ → 从 Library 拉入相关素材    │
│ → Library 自动打标签       │          │ → AI 读取素材 + Playbook    │
│                           │          │ → 起草 Blog 正文            │
│ 持续、无边界               │          │ → 用户 Review + 评论修改     │
└──────────────────────────┘          │ → 发布到博客平台              │
                                      └───────────────────────────┘
```

- Library 跨所有 Blog Project 共享 ✅
- AI 在 Blog Project 中可读 Library 引用 ✅
- 发布通过 Web Node 的 export 实现 ✅
