# 成形 OS：Agent-Native 空间操作系统 (Master Blueprint)

**文档属性**：系统顶层架构与前端落地蓝图（专家评审版）
**核心命题**：如何将纷繁复杂的内容载体（长文本、网站、表格、代码、图片）收敛进统一的底层骨架，并实现真正的「AI 原生系统协作」。

---

## 〇、 核心设计哲学 (Core Philosophy)

### 1. 从“文档应用”到“节点操作系统 (Node OS)”
成形 OS 放下了一切关于“我是一个何种形态 App”的执念。系统中唯一的底层真相是 **Node（实体）**、**State（版本快照）** 与 **Thread（意图对话）**。所有的文档、表格、甚至整个首页界面，都不是硬编码的，它们全都是存储在底层并且装载了不同 `renderAs` （渲染模式）的 Node。

### 2. 模式即技能包 (Modes as Skills)
当你展开一个 `renderAs: 'web'` 的节点时，你本质上是在为你系统内核挂载了一个「网页开发专属 Skill 套件」：
- 它向中央视界推送了一个专用的 `$CanvasAdapter`（用以渲染 iframe）。
- 它向左栏推送了一个专属的 `$ContextParser`（用以解析页面路由）。
- 它向右拉进了包含改写 HTML 代码能力的专属大模型 `$AgentToolKit`。
至此，千变万化的业务只需通过增加新的 Skill 适配器即可实现扩展，而系统外壳岿然不动。

### 3. 协作即语义合并 (Semantic Rebase)
告别人类面对满屏红绿底层代码冲突的痛苦。在成形中，操作以人的 `Intent`（通过 Thread 指示）产生 `Draft`（分岔草稿）。多协作者/多 Agent 并发产生冲突时，由作为高维视角的 AI 代为审视双方的主干，并输出一份融合后的“完美意图”，执行真正的防冲突（Semantic Rebase）。

---

## 一、 The Golden Layout（沉浸式等分三栏架构）

整个大系统抛弃所有的弹出模态框 (Modal-free Layout)。我们实施了极其严苛的 **“左-中-右”** 容器契约：

```text
+-----------------+-------------------------------------------------+-----------------+
| [ Left Rail ]   | [ Center Topbar: Version Chrome & State ]       | [ Right Rail ]  |
| width: 256px    +-------------------------------------------------+ width: 320px    |
|                 |                                                 |                 |
| 你的“手”。      | [ Center Canvas ]                               | 你的“外脑”。    |
| 根据形态坍缩。  | 你的“眼”。                                      | 唯一跨 Node 透传|
| 提供大纲/图层栈/| 视觉重镇。所有适配器(RenderAdapter)的注入点。   | The Omni-Agent  |
| 库/全局切面     |                                                 | + 随手记空间    |
+-----------------+-------------------------------------------------+-----------------+
```
无论是宏观系统大厅（`/home`），还是微观正在改写某行代码（`/workspace/xyz`），这套布局将人的心智负担降至最低。遇事不决，永远看向右侧的对话框发号施令。

---

## 二、 知识管理与意图流转阻断法则

“记录想法”和“工作界面”在此不再割裂。但为了防止个人外脑（Knowledge Base）被开发产生的废话污染，成形 OS 设立了一套极高明的数据拦截路由：

1. **悬浮捕获 (Global Quick Capture)**：任何模式下按 `Cmd+J` 掉下输入条，记下灵感。AI 在不干扰主视界的情况下瞬间收至底层知识库 (`Note`)。
2. **摄取情境 (Auto-Ingest)**：在使用系统内置的 `browser-canvas` 看外站论文并在边角打下的精彩高亮与批注，**自动入库**成为长效个人知识。
3. **执行情境 (Operational Block)**：在建站、写书的 Canvas 里针对某个元素的打点留言“往左挪 10px”、“这有错别字”，被系统拦截判定为执行态运维废话，**绝禁入库**污染宏观外脑大盘，仅随着文档版本的闭环生灭。
4. **手动升格**：任何评论均可经过用户显式点击 💡，强行提拔送入底库。

---

## 三、 全态情境坍缩线框图谱 (Scenario Wireframes 0-10)

以下 11 种形态跨越极大的差异度，却被完美套在这个永不走形的同一操作视窗中，构成了整个操作系统的骨与肉。

### 场景〇：系统原点（HomePage 本身就是技能节点）
`renderAs: 'dashboard'`

```text
+-----------------+-------------------------------------------------+-----------------+
| GLOBAL SPACES   | My OS Desktop                 ● Online       {} | Global Agent    |
|                 +-------------------------------------------------+                 |
| SMART QUEUES    |       [ 🔍 Search across your OS... ]           | [Thread: Org]   |
| - Pinned Nodes  |                                                 |                 |
| - Needs Review <|   +-------------------+   +-------------------+ | +-------------+ |
| - AI Working    |   | 📖 The Chronicles |   | 🌐 Promo Website  | | | Create a    | |
|                 |   | [ Draft | v2.1 ]  |   | [ Saved | v1.0 ]  | | | new kanban  | |
|                 |   +-------------------+   +-------------------+ | | board inside| |
|                 |                                                 | | this project| |
|                 |   +-------------------+   +-------------------+ | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：没有写死的首页入口。首页只是系统为你加载在 Root 节点之下的“卡片看板视图”。这也意味着用户哪怕想把全知工作台换成一个全屏报表，依然不用破坏框架。

---

### 场景一：沉浸式创作（写书/长文章）
`renderAs: 'document'`

```text
+-----------------+-------------------------------------------------+-----------------+
| THE CHRONICLES  | Chapter 3: Nightfall        ● Draft    v2.1  {} | Note: Elara     |
|                 +-------------------------------------------------+ Note: The Shard |
| CHAPTERS        |                                                 |                 |
| 1. The Hollow   | The forest held its breath...                   | [Thread: Plot]  |
| 2. Secrets      | Elara moved cautiously through the ancient      |                 |
| 3. Nightfall <  | grove, the darkness gathering like ink.         | +-------------+ |
| 4. The Sentinel |                                                 | | Make this   | |
| 5. Whispers     | Suddenly, the artifact hummed.                  | | tense?      | |
|                 |                                                 | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：中央渲染富文本且完全去边框；左侧切换为交付物章节树。

---

### 场景二：多件协同产物（写一个前台网站）
`renderAs: 'web'`

```text
+-----------------+-------------------------------------------------+-----------------+
| WWW PROJECT     | Landing Page                ● Saving...  v1.0  {} | Note: Branding  |
|                 +-------------------------------------------------+                 |
| PAGES           | +---------------------------------------------+ | [Thread: Hover]|
| /home      <    | |  REVOLUTIONIZE YOUR WORKFLOW                | | > Alice: Pop  | |
| /pricing        | |                                             | |               | |
|                 | |               [ Start Trial ] <-----------+ | | +-------------+ |
| COMPONENTS      | |                                           |-+-| | Add glow    | |
| - Button        | |                                             | | | effect to   | |
|                 | +---------------------------------------------+ | | this button.| |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：隐藏碎片化的源码环境。中央撑满 iframe 渲染的成形网页。此时所有指向画面的锚点操作（`ReviewAnchor`）实质是 AI 直接操作底层的 `.tsx` 并发驱动的热重载。

---

### 场景三：块级报告构建（Keynote/PPT）
`renderAs: 'slides'`

```text
+-----------------+-------------------------------------------------+-----------------+
| Q3 PITCH DECK   | Slide 4: Market Cap         ● Saved      v5.2  {} | Note: Q1 Rev.   |
|                 +-------------------------------------------------+                 |
| SLIDES          |                                                 | [Thread: Stats] |
| [ 1. Title  ]   |         +-----------------------------+         |                 |
| [ 2. Agenda ]   |         | MARKET OPPORTUNITY          |         | +-------------+ |
| [ 3. Growth ] < |         |                             |         | | Generate a  | |
| [ 4. Market ]   |         |  [ Chart: TAM vs SAM ]      |<--------|-| pie chart。 | |
|                 |         +-----------------------------+         | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：左手变身 Slides 缩略列表，拖拽排序；左侧 AI 由于挂载了 `SlidesKit` 技能包，知道怎么操作全局比例构图。

---

### 场景四：重算逻辑与表引擎（表格/财务）
`renderAs: 'table'`

```text
+-----------------+-------------------------------------------------+-----------------+
| FINANCIAL 2026  | Q3 Master Sheet             ● Draft      v1.8  {} | Note: Run rate  |
|                 +-------------------------------------------------+                 |
| SHEETS          |   | A       | B        | C        | D       |   | [Thread: Eq]    |
| # Q2 Actuals    | 1 | Name    | Rev      | Cost     | Profit  |   |                 |
| # Q3 Master <   | 2 | US      | 500k     | 200k     | 300k    |   | +-------------+ |
|                 | 3 | EU      | 300k     | 100k     | 200k    |   | | Write       | |
| SCHEMA / COL    | 4 | ASIA    | [ 250k ] | 150k     | 100k <----|-| | formula for | |
| - Revenue       | 5 | TOTAL   | 1.05M    | 450k     | 600K    |   | | APAC proj.  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：左侧除了列出多分页，底布还展露数据结构的 Schema（库表设计）。

---

### 场景五：多模态资产编排（图片绘制/编辑）
`renderAs: 'image'`

```text
+-----------------+-------------------------------------------------+-----------------+
| WINTER CAMPAIGN | Hero_Banner_v2.png          ● Saved      v3.0  {} | Note: Col Pal   |
|                 +-------------------------------------------------+                 |
| LAYERS (Comp)   |                                                 | [Thread: Text]  |
| (O) Text_Main   |           +-------------------------+           |                 |
| (O) Logo        |           |  *WINTER IS HERE*       |           | +-------------+ |
| (O) Subject   < |           |      [ 🦌 ]             |<----------|-| Turn the    | |
| (-) Bg_Blur     |           |                         |           | | deer into a | |
|                 |           +-------------------------+           | | polar bear  | |
|                 |                                                 | |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：画板、图层组与 AI 重绘意图。Anchor 可以挂靠极度物理像素化的边界（`X,Y,W,H`）。

---

### 场景六：操作系统内的狗粮局（构建外挂扩展）
`renderAs: 'extension'`

```text
+-----------------+-------------------------------------------------+-----------------+
| SYSTEM CORE     | My_Kanban_Renderer          ● Approved   v1.0  {} | Note: React API |
|                 +-------------------------------------------------+                 |
| DEFINITIONS     | // 1. Sidebar.tsx                               | [Thread: Spec]  |
| {.} Sidebar.tsx | export function Sidebar({ node }) {             |                 |
| {.} Canvas.tsx <|   return <BoardColumns col={node.data} />;      | +-------------+ |
|                 | }                                               | | I need a    | |
| AGENT TOOLS     |                                                 | | new tool    | |
| [T] moveCard    | // 2. Canvas.tsx                                | | to drag     | |
| [T] addTag      | import { DndProvider } from 'dnd';              | | cards       | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：如果你需要一种本 Blueprint 未写出的系统形态（比如 3D 渲染图模型），不用退出，系统本身就提供编写“画布 + 大模型工具定义”的 `Extension Node`。这就是无限拓展能力的尽头。

---

### 场景七：信息捕鼠器（内部浏览器与随手网页快照化）
`renderAs: 'web-archive'`

```text
+-----------------+-------------------------------------------------+-----------------+
| EXTERNAL WEB    | HackerNews: Launching OS    ● Saved        {}   | Note: Startups  |
|                 +-------------------------------------------------+                 |
| PAGE METADATA   |      [ 🌐 Translate View ▼ ]                    | [Thread: Quote] |
| - Captured: 2h  | If you want to build great web apps,            |                 |
|                 | you must consider the ecosystem.                | +-------------+ |
|                 |                                                 | | Extract     | |
| MOUNTS          | The hardest part of doing great <---------+     | | this into   | |
| (🔗 Linked to   | work is figuring out what to work on.     |     |-| my Book     | |
|  My Book Proj)  |                                           |     | | Project.    | |
|                 |                                           +-----| |        [↑]  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：在外部网页的深井中打捞。一经捕获及留言发问，立刻连源带皮冻结落地（Snapshot）成为你系统内的永久节点资产！

---

### 场景八：硬核源码流落版（通用 IDE 控制台）
`renderAs: 'code'`

```text
+-----------------+-------------------------------------------------+-----------------+
| BACKEND API     | src/routes/users.js         ● Draft      v1.2  {} | Note: Auth Flow |
|                 +-------------------------------------------------+                 |
| EXPLORER        |  1 | import { db } from '../db';                | [Thread: Opt]   |
| [+] src         |  2 | import { verifyToken } from '../auth';     |                 |
|   [-] routes    |  3 |                                            | +-------------+ |
|     - users.js <|  4 | export async function getUser(req, res) {  | | Add error   | |
| - package.json  |  5 |   const user = await db.query(           <-|-| handling    | |
|                 |  6 |     'SELECT * FROM users WHERE id = ?'     | | block here. | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：程序员硬核视界。同时，这种 Node 可用于挂载各类**复杂组合发布脚本**（比如打通多个产出物推送第三方接口自动化业务！）。

---

### 场景九：多人与多模型协作缝合（Agent Rebase）
`Branching / Semantic Override`

```text
+-----------------+-------------------------------------------------+-----------------+
| TEAM PLAN       | Q4 Roadmap           [👩] [👨] ● Draft   v3.0  {} | Note: Budget    |
|                 +-------------------------------------------------+                 |
| ACTIVE BRANCHES |                                                 | [Thread: Bob]   |
| [ ] Master v3.0 |   1. Execute marketing plan...                  |                 |
|                 |   2. Hire 5 engineers...                        | +-------------+ |
| [•] Alice (You) |   3. Expand to EU market. <---- [👨 Bob]        | | ⚠️ Alice,    | |
|                 |                                                 | | Bob just    | |
| [ ] Bob (Merged)|  [ ✨ AI: Rebasing your old intent 'add a       | | merged v3.1.| |
|                 |     table' onto Bob's new 'EU market' text...]  | | Reconciling | |
|                 |                                                 | | intents...  | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：抛弃极度反人类的源文件冲突对比符。把发生碰撞时负责分析语义甚至智能写回主干的脏活，全权外包给仲裁态的高维 Agent。

---

### 场景十：知识星图（个人大内脑）
`renderAs: 'knowledge-graph'`

```text
+-----------------+-------------------------------------------------+-----------------+
| MY BRAIN (KB)   | Personal Knowledge Base      ● Saved  {}        | Global Agent    |
|                 +-------------------------------------------------+                 |
| VIEWS           |           [ Villains ] ---------+               | [Thread: Exp]   |
| - Graph View <  |                |                |               |                 |
|                 |                v                v               | +-------------+ |
| NOTE SCOPE      |   +-----------------+  +-----------------+      | | Group these | |
| [x] Project     |   | Obsidian Legend |  | Zorg's Dilemma  |      | | 5 notes into| |
| [x] User (All)  |   +-----------------+  +-----------------+      | | a plot doc. | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：平时无孔不入的微光碎片（Global Capture 按键收集的 Note、网页高画出的知识点），最终都作为粒子流进了名为 `My Brain` 的这个星云节点，等待在此与其余零星产出串联、发生化学反应，生成真正的宏观创作。

---

### 场景十一：跨界资产挂载与品牌资源库 (Asset Mounting)
`NodeRelation (type: mount)` 与 `renderAs: 'image'`

```text
+-----------------+-------------------------------------------------+-----------------+
| SPRING CAMPAIGN | Promo_Banner_Spring.png     ● Draft      v1.0  {} | Note: Brand Kit |
|                 +-------------------------------------------------+                 |
| LAYERS          |                                                 | [Thread: Add]   |
| (O) Text        |           +-------------------------+           |                 |
| (O) Snowman   < |           |      [ ⛄ ]             |           | +-------------+ |
| (-) Bg          |           |      spring sale        |           | | Fetch the   | |
|                 |           +-------------------------+           | | snowman     | |
| MOUNTED ASSETS  |                                                 | | from winter | |
| [🔗 Winter Cmp] |                                                 | | campaign.   | |
|  - ⛄ Snowman   |                                                 | |        [↑]  | |
|  - 🦌 Deer      |                                                 | |             | |
+-----------------+-------------------------------------------------+-----------------+
```
* **解析**：素材不再是随处乱放的全局散装文件。如果在“春季大促”（Project B）中想用“冬季大促”（Project A）里的独立雪人元素区，或是由全公司维护的专属 `Brand Kit` 节点资产。用户只需要在右侧下达指令，系统底层会在当前画布与目标资产之间打下 `NodeRelation (type: mount)` 合约。
* **验收边界**：一旦挂载成功，左侧 Contextual Sidebar 自动增加 `[🔗 Mounted Assets]` 区块展现该引用的子树；中央可以直接渲染其图层；右侧的大模型立刻获得这一批跨项目资产的 Context 认知（能调用雪人的坐标与图层数据去进行二创）。

---

---

## 四、系统的两条大一统高阶定律 (Advanced OS Laws)

在真正落脚系统底座时，这两个架构隐喻构成了成形 OS 的哲学封顶之作：

### 1. 路由即上浮 (The Upward Routing Metaphor)
既然连系统大厅本身也只是一个挂载了 `dashboard` 技能的 Node，我们该怎么“回到首页”？
在成形 OS 里，用户在交互上没有“关闭软件”这一说，他们进行的只会是**系统文件树的向上攀升（Ascend）**。
- **逐级上浮**：由于外壳永远稳定，左上角的面包屑（`<Breadcrumb>`）长存。点击上一级，本质就是在执行 `router.push(parentNodeId)`。你从一篇文章，上浮回了挂载项目看板技能（`renderAs: dashboard`）的项目层，再点一下 Logo，你就浮出了水面，回到了挂载着宏观卡片组的 `Root Node`（个人大厅）。
- **空间一键穿梭**：在任何节点的深度，敲击 `Cmd + K` 呼出指令台（Command Palette），你都可以一键折跃回根目录节点。

### 2. 形态动态跃迁 (Dynamic Transmutation / Morphing)
Node 的生命并不是和其 Skill（`renderAs`）一出生就终生锁死，这是一个**极其动态的透镜系统（Lens）**。
- 由于系统的底层永远只是纯净的 `WorkspaceFile` 二进制或 JSON 结构状态，所以视图和数据是深层解耦的。
- 当你在撰写一篇 5000 字的长文文档（`renderAs: 'document'`）时，你可以直接在顶部控件区域，将透镜切换为 `Slides`。
- 接下来的毫秒内，原始数据毫发无损。但中央立马被 `<SlidesCanvas>` 适配器接管，自动识别 H1/H2 将文档剪碎重排为 20 张幻灯片画板。同时，右侧 AI 管家手里的 ToolKit 被无声无息地切成了针对 PPT 的排版套件。
- **这是所有传统应用无法企及的自由：数据是原始的碳原子，取决于你戴上哪副 `renderAs` 的透镜（插入哪一张技能卡带），它就能变质出钻石抑或石墨的各种物理形态。**

---

## 五、终局思考（End Note）
当我们摒弃了所有花哨的应用层架构包装后，这颗 Agent-Native 的大树就只剩下了：
它是「你输入意图」，系统「以特定形态给你展出沙盘结果」，由于有「NodeRelation（组织互连）」，所有的产出物都可以成为另一个产出物的滋养和发车原材。
这是一部没有任何历史包袱，专属于超级个体与通用协同智能互喂算力的终南极简机器。
