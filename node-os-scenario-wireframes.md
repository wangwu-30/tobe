# 成形 OS：多形态情境坍缩的系统级 UI 线框图与组件映射

为了保证在实现这 6 种截然不同形态时，整个系统不发生「视觉撕裂」或跑偏，我们将所有场景锚定在**统一的黄金三栏骨架**下。这里的示意图采用**严格等分布局结构**，确保无论形态怎么变，骨架和边距永远严丝合缝。

---

## 🧭 全局骨架 (The Golden Layout Structure)

整个屏幕资源被严格划分为三块，这是所有形态必须遵循的父级容器契约：

```text
+-----------------+-------------------------------------------------+-----------------+
| [ Left Rail ]   | [ Center Topbar: Title, Status, Version Drop ]  | [ Right Rail ]  |
| width: 256px    +-------------------------------------------------+ width: 320px    |
| (Context)       |                                                 | (Agent)         |
|                 |                                                 |                 |
| Project nodes,  | [ Center Canvas ]                               | Memory Notes,   |
| Folders,        | flex: 1                                         | Comment Threads,|
| Outline,        | RenderAdapter Injection Area                    | Chat Input      |
| Layers, etc.    |                                                 |                 |
+-----------------+-------------------------------------------------+-----------------+
```
*无论你装载哪个形态，左侧永远是你对结构“精确控制的手”，中央永远是“呈现结果的眼”，右侧永远是“懂上下文的大脑”。*

---

## 场景一：写一本书（长文本与设定体系）
`renderAs: 'document'`

```text
+-----------------+-------------------------------------------------+-----------------+
| THE CHRONICLES  | Chapter 3: Nightfall        ● Draft    v2.1  {} | Note: Elara     |
| - Mechanics     +-------------------------------------------------+ Note: The Shard |
| - Characters    |                                                 |                 |
|                 | The forest held its breath...                   | [Thread: Add...]|
| CHAPTERS        | Elara moved cautiously through the ancient      |                 |
| 1. The Hollow   | grove, the darkness gathering like ink on       | +-------------+ |
| 2. Secrets      | velvet.                                         | | How can I   | |
| 3. Nightfall <  |                                                 | | make this   | |
| 4. The Sentinel | Suddenly, the artifact hummed.                  | | tense?      | |
| 5. Whispers     |                                                 | |             | |
|                 |                                                 | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`DeliverableSidebar`)**：向上收拢呈现 Project 下所有同级交付物（即各章节），方便跨章跳转。
* **中央组件 (`document-canvas`)**：干掉四周的边框，呈现类似沉浸式阅读器的居中排版栏（Center-aligned, Max-width 720px）。
* **右侧组件 (`AssistantRail`)**：核心是上方的 **Note 提取池**，AI 隐式加载跨章节的全局设定。

---

## 场景二：写一个网站（多页构建与意图锚定）
`renderAs: 'web'`

```text
+-----------------+-------------------------------------------------+-----------------+
| WWW PROJECT     | Landing Page                ● Saving...  v1.0  {} | Note: Branding  |
|                 +-------------------------------------------------+ Note: Assets    |
| PAGES           | +---------------------------------------------+ |                 |
| /home      <    | |  REVOLUTIONIZE YOUR WORKFLOW                | | [Thread: Hover]|
| /pricing        | |                                             | | > Alice: Pop  | |
| /about-us       | |               [ Start Trial ] <-----------+ | |               | |
| /contact        | |                                           | | | +-------------+ |
|                 | |                                           |-+-| | Add hover   | |
| COMPONENTS      | |                                             | | | effect to   | |
| - Button        | |                                             | | | this button.| |
| - Navbar        | +---------------------------------------------+ | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`WebRoutingTree`)**：自动解析底层多个 `WorkspaceFile`，将它们归类呈现为页面路由结构或组件树。
* **中央组件 (`web-canvas`)**：一个 100% 充满框架的 iframe。当用户点击高亮按钮时，利用 PostMessage 在界面上撑起一个悬浮的 `ReviewAnchorLayer`，与右侧的 Thread 强行绑定（如图中指向关系）。

---

## 场景三：制作一套报告（块结构与全局排版）
`renderAs: 'slides'`

```text
+-----------------+-------------------------------------------------+-----------------+
| Q3 PITCH DECK   | Slide 4: Market Cap         ● Saved      v5.2  {} | Note: Q1 Rev.   |
|                 +-------------------------------------------------+                 |
| SLIDES          |                                                 | [Thread: Stats] |
| [ 1. Title  ]   |         +-----------------------------+         |                 |
| [ 2. Agenda ]   |         | MARKET OPPORTUNITY          |         | +-------------+ |
| [ 3. Growth ]   |         |                             |         | | Generate a  | |
| [ 4. Market ] < |         |  [ Chart: TAM vs SAM ]      |<--------|-| pie chart   | |
| [ 5. Team   ]   |         |                             |         | | based on Q1 | |
| [ 6. Vision ]   |         +-----------------------------+         | | Note.       | |
|                 |                                                 | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`SlidesThumbnailList`)**：不展示树状文件节点，而是对每一张幻灯片节点进行缩略图列表展示，提供直觉的拖拽排序。
* **中央组件 (`slides-canvas`)**：渲染固定的 16:9 画板（带缩放控制）。右侧 AI 对话可以直接基于全局的 Note 生成特定页面的块状结构。

---

## 场景四：数据与表格（逻辑公式与重算）
`renderAs: 'table'`

```text
+-----------------+-------------------------------------------------+-----------------+
| FINANCIAL 2026  | Q3 Master Sheet             ● Draft      v1.8  {} | Note: Q2 Tax    |
|                 +-------------------------------------------------+ Note: Run rate  |
| SHEETS          |   | A       | B        | C        | D       |   |                 |
| # Q1 Actuals    | 1 | Name    | Rev      | Cost     | Profit  |   | [Thread: Eq]    |
| # Q2 Actuals    | 2 | US      | 500k     | 200k     | 300k    |   |                 |
| # Q3 Master <   | 3 | EU      | 300k     | 100k     | 200k    |   | +-------------+ |
| # Forecast      | 4 | ASIA    | [ 250k ] | 150k     | 100k <----|-| Write formula | |
|                 | 5 | TOTAL   | 1.05M    | 450k     | 600K    |   | | for APAC    | |
| SCHEMA / COL    |                                                 | | projections | |
| - Revenue       |                                                 | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`SheetTabList`)**：由于 Table 通常不会是深层树状，左树会列出所有 Sheets 分页，并在底部额外提供该当前表头字段的大纲（Schema），允许对列属性实施控制。
* **中央组件 (`table-canvas`)**：高性能的 Grid/Spreadsheet 渲染器。圈选 Anchor 的粒度可精准到某个单元格或某个选区（Range）。

---

## 场景五：图片与资产创作（多模态空间）
`renderAs: 'image'`

```text
+-----------------+-------------------------------------------------+-----------------+
| WINTER CAMPAIGN | Hero_Banner_v2.png          ● Saved      v3.0  {} | Note: Brand Col |
|                 +-------------------------------------------------+ Note: Font Fam  |
| LAYERS (Comp)   |                                                 |                 |
| (O) Text_Main   |           +-------------------------+           | [Thread: Text]  |
| (O) Logo        |           |  *WINTER IS HERE*       |           |                 |
| (O) Subject   < |           |      [ 🦌 ]             |<----------|-+-------------+ |
| (-) Bg_Blur     |           |                         |           | | Turn the    | |
| (-) Noise_Fil   |           +-------------------------+           | | deer into a | |
|                 |                                                 | | polar bear  | |
| ASSETS          |                                                 | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`LayerGraphTree`)**：如果是一张 AI 生成的可控图（如拥有 SVG 节点或局部选区的分层素材），左侧会收敛为图层树和历史资产集。
* **中央组件 (`image-canvas`)**：展现带透明底网格的可缩放画板。用户的 Anchor 能够绑定空间坐标 `(x, y, w, h)` 或特定图层进行局部重绘指令。

---

## 场景六：世界构造器（自造新创作模型 Workspace）
`renderAs: 'extension'`

```text
+-----------------+-------------------------------------------------+-----------------+
| SYSTEM CORE     | My_Kanban_Renderer          ● Approved   v1.0  {} | Note: React API |
|                 +-------------------------------------------------+                 |
| DEFINITIONS     | // 1. Sidebar.tsx                               | [Thread: Typo]  |
| {.} Sidebar.tsx | export function Sidebar({ node }) {             |                 |
| {.} Canvas.tsx <|   return <BoardColumns col={node.data} />;      | +-------------+ |
|                 | }                                               | | I need a    | |
| AGENT TOOLS     |                                                 | | new tool    | |
| [T] moveCard    | // 2. Canvas.tsx                                | | to drag     | |
| [T] addTag      | import { DndProvider } from 'dnd';              | | cards       | |
| [T] setColColor | export function BoardCanvas() {...}             | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+

---

## 场景七：游离态捕捉（内置浏览器提取器）
`renderAs: 'web-archive'`

```text
+-----------------+-------------------------------------------------+-----------------+
| EXTERNAL WEB    | Paul Graham: How To Do Great Work   ● Saved  {} | Note: Hackers   |
|                 +-------------------------------------------------+ Note: Startups  |
| PAGE METADATA   |      [ 🌐 Translate View ▼ ]                    |                 |
| - URL: paulgra..|                                                 | [Thread: Quote] |
| - Captured: 2h  | If you want to do great work, you have to       |                 |
|  ago            | have a certain kind of curiosity.               | +-------------+ |
|                 |                                                 | | Extract     | |
| MOUNTS          | The hardest part of doing great <---------+     | | this into   | |
| (🔗 Linked to   | work is figuring out what to work on.     |     |-| my Book     | |
|  My Book Proj)  |                                           |     | | Project.    | |
|                 |                                           +-----| |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`ArchiveSidebar`)**：不再是你的内部路由体系，而是展示抓取元数据（URL、时间快照）、原文/译文切换大纲，以及最为核心的：**它的去向挂载点（Mounts）**。
* **中央组件 (`browser-canvas` / `archive-canvas`)**：固化的只读 DOM 快照。允许进行深度翻译渲染覆盖和高亮打点（ReviewAnchor）。

---

## 场景八：硬核源码流（通用代码与脚本）
`renderAs: 'code'`

```text
+-----------------+-------------------------------------------------+-----------------+
| BACKEND API     | src/routes/users.js         ● Draft      v1.2  {} | Note: DB Schema |
|                 +-------------------------------------------------+ Note: Auth Flow |
| EXPLORER        |  1 | import { db } from '../db';                |                 |
| [+] src         |  2 | import { verifyToken } from '../auth';     | [Thread: Opt]   |
|   - index.js    |  3 |                                            |                 |
|   [-] routes    |  4 | export async function getUser(req, res) {  | +-------------+ |
|     - users.js <|  5 |   const user = await db.query(           <-|-| Add error   | |
|   [-] models    |  6 |     'SELECT * FROM users WHERE id = ?'     | | handling    | |
| - package.json  |  7 |   );                                       | | block here. | |
|                 |  8 | }                                          | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`FileExplorerTree`)**：标准的 IDE 级文件浏览器，支持多层级文件夹、新建与删除物理级 `WorkspaceFile`。
* **中央组件 (`code-canvas`)**：挂载 Monaco Editor 或类似底层的代码编辑器。代码行号天然成为 `ReviewAnchor (surfaceType: 'code-range')` 的锚定物。

---

## 场景九：多 Agent 与多人的并行协作 (Semantic Rebase)
由于底层严格的 `Draft` 与 `Version` 机制，当多人或多 Agent 并发修改时，系统提供类似 Git 但毫无代码冲突感的语义合并体验。

```text
+-----------------+-------------------------------------------------+-----------------+
| TEAM PLAN       | Q4 Roadmap           [👩] [👨] ● Draft   v3.0  {} | Note: Budget    |
|                 +-------------------------------------------------+                 |
| ACTIVE BRANCHES |                                                 | [Thread: Bob]   |
| [ ] Master v3.0 |   1. Execute marketing plan...                  |                 |
|                 |   2. Hire 5 engineers...                        | +-------------+ |
| [•] Alice (You) |   3. Expand to EU market. <---- [👨 Bob]        | | ⚠️ Alice,    | |
|     Translating |                                                 | | Bob just    | |
|                 |                                                 | | merged v3.1.| |
| [ ] Bob (Merged)|  [ ✨ AI: Rebasing your old intent 'add a       | | I am rebasi-| |
|                 |     table' onto Bob's new 'EU market' text...]  | | ng your     | |
|                 |                                                 | | changes...  | |
|                 |                                                 | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **左侧组件 (`BranchExplorer`)**：在协作极度密集的项目里，左栏甚至可以切为展示当前 Node 活跃的隐式分支（各个成员独立与大模型的 Conversation Session 树状态）。
* **中央组件 (`document-canvas` / CRDT)**：顶部呈现多协作者头像。当发生底层发散（Bob 领先一步落版生效），Canvas 会以块级动画（`[ ✨ AI: ... ]`）展示大模型如何将你被打断的工作意图，强行缝合到 Bob 刚刚提交的新主干上。
* **右侧组件 (`Agent Rebase Assistant`)**：这是杀手级应用。传统的 Merge 冲突需要自己去阅读满屏的差异代码去消除乱码；而在成形中，**合并冲突是由 Agent 介导的调停（Semantic Rebase）**。右侧 AI 告知你主干有变，并自动基于纯语义理解给出一份智能缝合的提案，彻底屏蔽底层冲突。

---

## 结尾思考：关于「复杂发布」与「组合生命力」

当这 8 种形态同处一个系统中时，“写完书怎么发布？”这个问题，迎来了最降维打击的解法。

传统的系统：找个 Export 按钮导出 PDF，或者寻找第三方博客平台。
但在成形 OS 里，**解决“发布”的办法，是创造另一个形态的 Node。**

1. **组合式建站发布（Do-It-Yourself）**：
   假如你想把写完的《三体》做成一个酷一点的宣传网站自己发。你不需要导出重写。你直接在这个 Project 下新建一个 Deliverable (`renderAs: 'web'`)。
   由于在同一个 Node 系统下，你只要在右侧 Chat 里对 AI 说：“**读我旁边大纲里写完的《三体第一卷》，提取里面所有的核心语录和封面元素，给我生成一个赛博朋克风格的宣传官网。**”
   立刻，底层的代码沙盒生成落地，你拥有了一个包含购书链接、倒计时动画和全书大纲摘要的立体官网。**产出物滋养了新的产出物。**

2. **跨平台发布脚本（Automated Protocol）**：
   如果你想发去知乎/Substack 怎么办？这就切到了场景八（Code）。你可以写一个（或让 AI 生成一个） `renderAs: 'code'` 的自动化 Node，里面写好了调用外部系统 API 的脚本逻辑。你打个 Tag，让这个脚本把你的新章节一键推送到全网即可。

不同形态（文本、网页、代码）在一个同构框架里“互通有无”，这就是操作系统（OS）的本质：**程序（Node）之间可以通过管道相互组合，爆发出无限可能。**
