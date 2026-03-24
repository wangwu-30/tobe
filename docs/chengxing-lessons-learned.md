# 成形经验教训台账

更新时间：2026-03-23
状态：持续维护中
相关文档：[项目状态](./chengxing-project-status.md) · [迭代回归门禁](./testing/iteration-regression-plan.md)

## 文档目的

- 记录已经被项目验证过的产品 / 技术最佳实践和明确踩坑，避免经验只留在 thread、commit 或临时讨论里。
- 后续做产品方案、交互收口、实现取舍和回归验收时，默认先查这份文档。
- 本文档不承载待办；只记录会影响后续设计、实现或验收边界的经验。

## 维护规则

- 每次重要功能迭代、体验收口或 bug 修复后，如果出现新的稳定做法或明确踩坑，必须更新本文档再关闭任务。
- 每条记录至少写清：结论、为什么成立、后续默认做法。
- 尚未落地但评审上已确认值得跟进的方向，统一标记为 `待验证`，避免和已验证事实混写。

## 产品最佳实践

### 1. 一种概念只能有一个主家

- 结论：`状态 / 评审 / 对话 / 上下文` 必须按职责分面，不能在多个 tab 重复解释同一状态。
- 为什么：重复入口会让用户误以为系统存在多套状态机，也会放大“到底去哪里处理问题”的认知负担。
- 默认做法：状态说明只放 `Status`；`Review` 只承载线程；`Chat` 只承载发送相关阻塞；`Context` 只承载知识、记忆和 workflow 库。

### 2. 先收口状态源和术语，再做体验打磨

- 结论：像 `currentStatus` 这样的共享状态必须先成为唯一 UI 状态源，兼容 alias 只能留在服务层。
- 为什么：如果 UI 还在混用旧术语和新术语，任何交互优化都会继续把兼容影子暴露给用户。
- 默认做法：页面 props、hooks、空态、副标题、禁用原因全部只读正式字段；兼容字段不进入 UI 命名。

### 3. 评论系统要区分“当前可执行”和“继承参考”

- 结论：跨版本评论不是简单“都展示出来”，而是必须明确 `direct / inherited` 和 `actionable / stale / superseded`。
- 为什么：用户需要第一时间分清楚“现在该处理什么”和“这里只是背景参考”。
- 默认做法：主列表只放当前可执行线程；过时或被覆盖的线程收进次级区，并带明确原因 badge。

### 4. 生成中状态不能只靠一句字面提示

- 结论：AI 正在生成时，页面必须给出持续、轻量、带节奏的反馈，而不是大块空白加一行文字。
- 为什么：空白画布会被直接感知成“没工作”或“卡住了”；轮询重灌内容则会放大不稳定感。
- 默认做法：生成中用动画态和胶囊反馈；避免每次轮询都重置整块内容。

### 5. 创建流的意图判定必须先于持久化发生

- 结论：当产品入口已经改成“用户只说目标”，意图判定和结构化追问必须在真正创建 workspace / project 之前完成，不能先落一个半成品再回头补问。
- 为什么：一旦先持久化再追问，就会把错误类型、错误项目结构和兼容恢复状态提前写进系统；后续再修正只会把临时状态永久化。
- 默认做法：创建流统一走“目标输入 -> 意图判定 -> 必要时追问 -> 最终创建”；恢复存储保存未决意图和追问答案，而不是强迫前端先给 `deliverableType`。

### 6. 用消息动作表达 AI 介入意图，比独立模式开关更稳

- 结论：评论区里“是否让 AI 介入”应该由消息里的 `@角色` 表达，而不是再暴露 `自动回复 / 手动回复 / 让 AI 回复` 三套控制。
- 为什么：模式开关会迫使用户先理解后台状态，再理解动作；`@角色` 把意图收成一个原子动作，也天然支持后续多 agent 扩展。
- 默认做法：不再在评论面板保留独立 reply mode；线程只展示 `等待中 / 回复中 / 未就绪` 这些围绕角色监听窗口的显式状态。

### 7. 载体判断应该由创建路由或显式派生动作承接，而不是留一个 `Status` 手工切换器

- 结论：当创建流已经支持 AI 意图判定和结构化追问后，`Status` 面板里的人工类型切换器应该退出主表面。
- 为什么：用户真正想做的是“直接生成一个网页”“先出文档再配网页”，而不是手动管理内部 `deliverableType`；如果 `Status` 还留着切换器，就会把刚收掉的技术心智又带回来。
- 默认做法：载体变化只通过两类路径发生：创建时的 AI 路由，或后续显式的转换/派生动作；`Status` 只负责当前阶段、workflow 和下一步动作，不再承担类型管理。

### 8. 用统一的前端壳承载多态意图，而不是各立门户

- 结论：当底层数据（如评论、版本、文件）完全相同时，`document`, `slides`, `web` 必须在 UI 层共享一个标准的 `Result Shell`（头、状态栏、侧边栏）。
- 为什么：如果各自渲染独立外壳，切换意图时用户会面临破坏性的屏闪和布局丢失；统一壳保障了平滑心智。
- 默认做法：将 `source/implementation` 留作次级视图；主视图永远是带有标准化壳的交付物表现态。即使当前内容还不够“像幻灯片/网页”，也应该留在结果壳或空态里，不允许默认降级到 Markdown / 源码视图。

### 9. slide 投影必须看内容结构，而不是继续绑定独立类型

- 结论：像路演稿、PPT 这类表达，必须直接由 `slide_page` block 驱动投影；只要文档内容本身就是纯 `slide_page`，就应该进入 slide 结果面，而不是继续依赖独立 `slides` 类型。
- 为什么：如果 slide 结果面只认 `deliverableType=slides`，那么创建流虽然已经把 PPT 类目标判成文档，中央画布却仍会退回正文流，等于把“内容模型统一”和“结果面统一”又拆成两条路。
- 默认做法：slide 表达优先用 `document + slide_page` 建模，并按内容结构决定结果面投影；旧 `slides` 类型只保留兼容，不再作为新的主路径。

### 10. 统一内容模型后，公共默认语义也必须跟着折叠 legacy 类型

- 结论：当 `slides` 已经降级成 `document` 里的内容投影时，plan blueprint、公共标签、项目级 AI 摘要和默认 prompt 也必须同步把 legacy `slides` 折叠回 `document`。
- 为什么：如果只有画布投影收口，而计划模板、标签和 AI 提示还继续把 `slides` 当第三类主路径，系统会在不同层面给出互相冲突的信号，用户侧和 agent 侧都会继续背过时类型心智。
- 默认做法：新推断、新 blueprint、新标签和共享 prompt 一律优先走 canonical `document | web | code`；旧 `slides` 数据只在兼容层保留，不再进入公共默认分支。

### 11. MVP 阶段不要长期背着旧主语义兼容壳

- 结论：当产品主语义已经明确切换后，MVP 阶段应优先直接删除旧兼容入口，而不是继续维护 `wiki / sessions / documents` 这类历史表面。
- 为什么：兼容壳会让页面、接口、测试和文档继续背两套叙事，既增加维护成本，也让“当前真实边界”越来越难看清。
- 默认做法：旧头字段、旧路由、旧文案、旧开关只要没有当前产品价值，就直接删；内部技术债若暂时保留，必须限制在实现层，不再外露成产品表面。

### 12. onboarding 不应由一次性欢迎弹窗承担

- 结论：更稳的 onboarding 是渐进式、功能首次打开时出现的轻量提示，而不是只靠一个首次进入时的总说明弹窗。
- 为什么：用户真正需要学习动作的时机，是第一次进入 `Status / Review / Chat / Context / Workflow / Version` 这些真实场景时；如果引导只在最开始出现一次，错过后就等于失去教学。
- 默认做法：全局欢迎层只保留极轻的方向提示；具体功能引导改成 contextual first-use guidance，并且只在首次打开对应功能时出现。

### 13. 未启动状态不能伪装成进行中

- 结论：只要用户还需要手动点击“生成第一稿”，中央主表面和状态胶囊就必须保持准备态，不能提前显示加载动画。
- 为什么：一旦未启动状态看起来像“AI 已经在跑”，用户会同时收到两条互相冲突的信号：视觉告诉他正在进行，按钮却告诉他还没开始。
- 默认做法：手动启动前只显示准备态和唯一主动作；真正排队/运行后，才切换到进行中的动画和文案。

### 14. 默认能力应隐式可用，升级能力才显式暴露

- 结论：像联网轻搜这类应该成为 AI 默认工作能力，而不是再让用户先理解一个“是否联网”的模式开关。
- 为什么：用户真正关心的是结果是否需要最新外部信息，不是系统内部处于哪种搜索模式；把基础能力做成显式开关，只会把实现细节抬到产品主表面。
- 默认做法：Chat 默认按需轻搜，并用硬预算约束成本；只有深度研究这类明显更重的升级能力，才通过单独 pill 和计划确认显式暴露。

### 15. 长跑研究结果不应直接淹没主交互面

- 结论：深度研究的主交互面应该只保留计划、阶段进度和短摘要，完整报告进入可复用的资料层。
- 为什么：如果把长报告直接塞进 Chat 或 Comment，主线程会迅速失去可读性；但如果只显示“已完成”，研究过程又会退化成黑箱。
- 默认做法：Chat 和 Comment 只显示摘要、关键结论和打开报告入口；完整报告统一写到支持资料树的 `研究` 目录，并可从当前线程直接打开。

### 16. 首次引导必须服从真实操作面的空间预算

- 结论：放在窄侧栏、只读版本面或局部 workflow 区域的首次引导，必须优先保证真实操作面仍然可见、可滚动、可点击。
- 为什么：如果引导卡片本身把消息动作、版本操作或 workflow 入口挤出可视区，引导就会从“帮助理解”反过来变成新的阻塞层。
- 默认做法：首页这类宽表面可以用常规提示卡；右侧助手栏、Version、Workflow 等受限区域默认用紧凑 banner，并在验收里确认引导出现时主动作仍可操作。

### 17. 在现有项目里派生下一个交付物时，不要把项目级问题再问一遍

- 结论：如果用户已经处在一个明确项目里，继续创建下一个交付物时，UI 应直接沿用当前项目上下文，而不是再次要求项目位置或继续展示“创建项目”。
- 为什么：这类重复提问会把“在项目内自然长出下一个交付物”重新打回“从头再建一个项目”，既破坏连续性，也会制造错误心智模型。
- 默认做法：下一个交付物入口默认继承 `projectId / projectFolderId / active workflow`；表单只问新的交付目标，不重复问已知的项目级信息。

### 18. 正式从历史状态继续，必须把当前 draft head 一起切到那个版本系谱上

- 结论：当用户要从某个里程碑或回退点继续推进时，正式入口应该放在 `Version` 历史，而且动作不能只是新开对话；它还必须把当前 live draft 切到一个新的正式版本 head，并显式暴露当前草稿基线。
- 为什么：如果只开新对话、不移动当前 draft，用户会以为自己已经从历史点重新长出正式分支，但实际仍在沿用旧 head；这会把 `Version`、`Chat` 和真正的版本系谱重新混在一起。
- 默认做法：`Version` 历史提供“从这里继续”；点击后先创建安全回退点，再从选中历史点生成新的正式 head，把 live draft 切过去，并在 History / Chat 同时显示当前基线来源。

### 19. 版本比较必须允许用户显式选择两侧基点

- 结论：`Version` 比较不能把“当前草稿”写死成固定一侧；用户需要能显式选择任意两个可见比较基点。
- 为什么：一旦比较只能做“某个里程碑 vs 当前草稿”，用户就无法直接回答“V1 和 V2 到底差了什么”，版本历史也会继续退化成只服务当前 head 的附属视图。
- 默认做法：比较弹窗始终提供左右两侧独立选择器，允许“里程碑 vs 里程碑”或“里程碑 vs 当前草稿”；从历史卡片触发时，可以用当前草稿基线做预填，但不能锁死用户选择。

### 20. 一旦已经存在正式 parentVersionId，版本历史就必须优先呈现 lineage，而不是只按时间平铺

- 结论：当正式里程碑已经可以从旧里程碑继续长出新的 head 时，`Version` 历史不能继续只按倒序列表展示；它必须让用户直接看懂祖先、子分支和当前 head 的关系。
- 为什么：如果 V1、V2 和“从 V1 继续”只是三张平铺卡片，用户很难判断 V2 是祖先、兄弟分支还是当前 head，最终又会把正式版本树误读成“只是几个保存点”。
- 默认做法：里程碑区按可见 lineage 分层显示；当前 live draft 对应的可见版本继续用“当前草稿基线”标识，其余无子节点的叶子里程碑标成 `Branch Head`，避免 tree/head 关系重新淹没在时间线里。

### 21. 评论继承必须跟正式版本祖先链走，不能按“最近可见版本”时间线泄漏兄弟分支

- 结论：当用户从旧里程碑继续长出新的正式 head 时，`Review` 里能继承过来的评论只能来自这条新 head 的祖先链，而且还必须能在当前表面重定位。
- 为什么：如果把兄弟分支上尚未解决的评论也混进当前分支，用户会误以为那些问题仍然属于自己正在推进的版本线，评论语义又会退回“按时间混着看”的旧状态。
- 默认做法：评论继承先按 `parentVersionId` 向上走祖先链，再做锚点重定位；能重定位的显示为 `继承评论上下文`，兄弟分支和不可重定位的线程继续留在各自历史或更早上下文里。

### 22. 当高层对象已经成为产品名词时，必须给它显式摘要契约

- 结论：一旦产品表面开始把“项目”当作导航主对象，列表接口和 sidebar row 就应该直接消费 `ProjectSummary`，而不是继续复用 leaf workspace 的别名结构。
- 为什么：如果项目列表背后仍是“按 workspace 分组后拼一个假项目”，首页、设置页和工作区左栏就很容易各自解释不同的“项目”，也会继续把单交付物实现细节泄漏到高层导航。
- 默认做法：项目列表统一返回 `projectId + representative workspaceId + deliverableCount + latestDeliverableTitle` 这类稳定摘要字段；交付物仍然作为项目内叶子节点进入下一层导航，而不是反过来充当项目摘要本身。

### 23. 一旦项目结构开始重要，第一扫描线必须同时回答“我在哪个项目里”和“下一步怎么继续”

- 结论：当工作区已经支持项目树和项目内派生下一个交付物时，当前交付物的项目路径和“新建同级交付物”入口应该一起进入顶栏，而不是只藏在侧栏或 `Status` 卡片里。
- 为什么：如果用户必须先展开侧栏或翻到状态面板，才能确认自己正在项目树的哪个位置并继续长出下一个交付物，项目上下文就仍然只是“存在”，还没有成为当前工作区的主对象。
- 默认做法：顶栏副标题直接显示 `项目 / 文件夹` 路径；高频“继续同项目里的下一个交付物”动作放进顶栏，并直接继承当前 `projectId / projectFolderId / deliverableType` 进入 goal composer。

### 24. 一旦一个项目里已经有多个交付物，当前对象切换也应该出现在标题栏，而不是逼用户先回到侧栏

- 结论：当项目内已经存在多个交付物时，标题栏里的当前交付物名称应该直接承担“切换当前交付物”的职责。
- 为什么：如果项目上下文和派生动作都已经进入第一扫描线，但切换当前对象仍只能依赖左侧树，用户在沉浸式写作/评审时还是会被迫做一次额外转场，项目 first-class 的心智依然不完整。
- 默认做法：同项目多交付物场景下，把标题渲染成切换器；菜单项显示交付物名称以及其文件夹路径/交付类型，切换后中心与右侧仍只聚焦新的唯一当前交付物。

### 25. 当版本历史已经显式标出 `Branch Head` 时，切换动作也应该落在这张卡片上

- 结论：如果历史面板已经能看见另一条可见分支的 `Branch Head`，用户就应该直接在这张卡片上把当前 live draft 切过去，而不是被迫再次“从这里继续”制造一条新分支。
- 为什么：只显示 head 标识、却不给 head 切换动作，会让版本树停留在“能看懂但不能操作”的半闭环状态，也会诱导用户为了回到既有 head 不断长出额外分支。
- 默认做法：非当前草稿基线的可见 `Branch Head` 卡片直接提供“切到这条分支”；系统先创建安全回退点，再把当前 draft 和对话基线一起切到目标 head。

### 26. 只要历史已经按树展示版本节点，节点本身就应该直接可浏览

- 结论：当 `Version` 历史已经承担版本树的主要浏览入口时，可见里程碑卡本身就应该能直接打开对应只读版本视图。
- 为什么：如果用户还得先退出历史、再去顶部下拉框选择同一个版本，树只是“解释结构”的图示，不是可用的浏览器；这会把版本树再次打回辅助说明层。
- 默认做法：可见里程碑卡默认可点击进入对应 `versionId` 视图；卡内的继续、比较、恢复、切分支等动作继续保留为显式按钮，并阻止误触发卡片跳转。

### 27. 当可见版本已经形成多条叶子分支时，版本历史还需要独立的 branch overview

- 结论：只把版本节点按 lineage 缩进排开还不够；一旦同时存在当前草稿分支和其他可见 branch head，历史顶部还应该再给一层 branch overview。
- 为什么：树缩进能解释父子关系，但用户真正高频要回答的是“当前我在哪条分支上”“另一条可见分支的 head 是哪一个”“我现在要不要直接切过去”。如果这些信息只能靠逐张卡片自己推断，版本树仍然停留在半闭环。
- 默认做法：历史顶部按“每条可见分支一张摘要卡”展示 branch overview，卡上直接显示 head、整条 lineage 和里程碑数量；当前草稿所在分支优先排在最前，并允许直接从这层切换 live draft。

### 28. 当前 live draft 的分支基线不能只藏在 Chat 或 Version 里

- 结论：只要“当前草稿正在沿哪条正式分支推进”会影响用户下一步动作，这条信息就应该进入 `Status` 主推进面，而不该只留在 `Chat` 头部或 `Version` 历史里。
- 为什么：用户经常会在 `Status` 面板里决定继续生成、切交付类型或开下一个交付物；如果这里看不到当前分支基线，就必须先切去别的 tab 确认自己正站在哪条正式版本线上，主叙事会被打断。
- 默认做法：`Status` 里用紧凑卡片显式显示当前 live draft 基于哪个里程碑 / branch head；当用户从旧里程碑继续或切到另一条 branch head 后，这里的标题要和 `Chat`、`Version` 同步更新。

### 29. branch overview 一旦存在，就还要给“单分支聚焦”而不只是摘要

- 结论：当版本历史顶部已经在摘要当前分支和其他 branch head 时，用户还需要一个“只看这条 branch lineage”的聚焦视图，而不是继续在整棵树里自己筛。
- 为什么：摘要卡解决的是“有哪些分支”；但当用户想回答“这条分支到底经过了哪些正式里程碑”时，如果里程碑区仍混着其他分支节点，branch overview 依然只是说明层，不是可操作的 branch workspace 雏形。
- 默认做法：branch overview 卡片提供显式 `查看这条分支` 动作；进入后，里程碑区临时只显示该 branch lineage，并保留清晰的“返回全部分支”出口。

### 30. 系统内置方法也必须走同一条 Workflow 轨道

- 结论：像“需求规格到网页上线”“成形类产品市场分析报告”这样的系统内置方法，也应当作为 workflow 模板进入现有 playbook 体系，而不是额外做一套专用向导或硬编码状态机。
- 为什么：一旦系统模板和用户沉淀方法分成两条轨，Goal Composer、Context、plan 绑定、AI prompt 注入和后续验收都会各长一套逻辑；未来要把 `tools / MCP / skills` 接进生态时，也会失去统一扩展缝。
- 默认做法：系统模板默认出现在 `Goal Composer` 和 `Context > Workflow`，创建/应用时先落到正式 workflow 绑定链路，再让 AI 沿着同一方法层去调用已有工具与扩展能力；如果模板明确依赖开放生态，就用结构化的 `Tools / MCP / Skills` 提示暴露出来，而不是只写在备注段落里。

### 31. 面向开放生态的 Workflow 扩展提示，必须是正式数据契约

- 结论：`Tools / MCP / Skills` 这类开放扩展提示不能只作为内置 workflow 的渲染补丁存在，必须成为每个 workflow playbook 的正式持久化字段。
- 为什么：如果扩展提示只靠 builtin fallback 回填，自定义 workflow 一旦保存、复制、编辑、刷新或应用到当前任务，就会丢掉生态语义；`Context`、`Status` 和 chat prompt 也会重新长出各自的兜底文案。
- 默认做法：把扩展提示和步骤、约束、检查项一样存进 playbook 本体；`Context` 编辑、plan 绑定、状态展示和 prompt 注入统一读取同一份结构化数据，builtin fallback 只作为旧数据兼容，而不是主路径。

### 32. 项目级 AI 上下文必须同时覆盖“知道有什么”和“知道去哪里读”

- 结论：如果希望 AI 在当前交付物里自然引用同项目的其他交付物，项目级上下文不能只给“有哪些兄弟交付物”，还要同时覆盖当前交付物、项目级和用户级 reusable notes，并提供显式的跨交付物读取工具。
- 为什么：项目级摘要解决的是“AI 知道还有哪些兄弟交付物”；deliverable / project / user note 解决的是“AI 知道这个项目整体怎么说、怎么做，以及当前用户的长期偏好”；而一旦任务变成“参考首页风格”“沿用 FAQ 里的表述”，AI 还需要一个无歧义的下一步，先列出同项目交付物，再读取目标文件，否则它只能靠猜测或把整个项目内容默认塞进上下文。
- 默认做法：chat system prompt 与 `get_workspace_context` 默认注入 `deliverable + project + user` scope Note 派生的 `Knowledge / Memory` 分区，以及同项目交付物摘要；当需要跨交付物复用时，统一走 `list_project_nodes -> read_node_content` 这条显式工具链，而不是隐式扩大默认 prompt。

### 33. 交互式 web 预览只要跨源，就必须先做同源 bridge，再谈评论闭环

- 结论：只要 web 结果面实际运行在 `127.0.0.1:<port>` 这类独立 preview origin 上，父页面就不该继续直接读 iframe DOM；评论、聚焦和高亮都必须先通过同源 bridge 和 `postMessage` 收口。
- 为什么：父页面直读 iframe 选区在 cross-origin 预览上天然不稳定，既会让“评论入口不可用”反复闪烁，也无法把 `cssSelector / domContext / boundingRect` 这类运行时锚点稳定回带给 Review 和后续 AI 源码定位链。
- 默认做法：preview iframe 默认加载同源 bridge URL；bridge 负责注入脚本、上报选区/元素 payload、接收 Review 的 focus 请求并在 iframe 内执行重定位和临时高亮，父页面只消费消息，不直接操作 preview DOM。

### 34. web 预览评论不能继续把“当前活动源码文件”当成唯一事实源

- 结论：`web-component` 线程既不能默认绑定到当前活动文件，也不能在 `Review` 里继续按 `currentFileId` 过滤；真实事实源应该是 preview 对应的源文件，或者在无法确定时直接回退到整份 deliverable surface。
- 为什么：网页预览是运行时投影，用户可能在 `App.js`、`main.js` 或其他当前活动文件上下文里评论一个实际由 `index.html` 或组合源码承载的 DOM 节点。如果线程和 Review 仍按当前文件走，评论会“创建成功但列表消失”，跨版本后也会被误判成 stale。
- 默认做法：静态 HTML 预览优先绑定到真实 preview 源文件；dev-server 或多文件场景下允许 `fileId=null`，让继承判定和 Review 加载按整份 deliverable surface 做回退匹配，而不是强行锁死到当前活动文件。

### 35. 多交付物项目的项目语境，只有在“比交付物标题多提供信息”时才应该浮出

- 结论：workspace header 和 sidebar 里的 `当前项目` chrome 不该无条件常驻；只有当项目标题、文件夹路径或兄弟交付物关系真的提供新增信息时，才应该显式显示项目上下文。
- 为什么：如果单交付物项目也总是同时显示“项目 + 交付物”两层标题，用户会把本来清晰的当前对象再次拆成两层心智；但一旦项目里真的存在文件夹或兄弟交付物，不把项目语境抬到第一扫描线，切换和新建就会继续被感知成跳去另一个孤立 workspace。
- 默认做法：当 `projectTitle != deliverableTitle`、存在 `project folders` 或同项目有多个 deliverable 时，再显示 header 的项目上下文行和 sidebar 的当前项目摘要卡；否则让单交付物项目保持安静，只突出唯一当前交付物。

### 36. 侧栏和首页这类高频读路径，应该走专门的薄读接口

- 结论：像首页项目列表、sidebar 项目摘要这种高频读路径，不应继续绑在一个同时承载动态 CRUD 语义的根路由 surface 上；更稳的做法是给它们单独的薄读接口。
- 为什么：这轮里 `/api/projects` 在 Turbopack 冷编译下会拖慢甚至卡住首页项目列表，而把同一份聚合读逻辑移到薄路由 `/api/project-list` 后，首页和 sidebar 的项目列表立刻恢复稳定；这说明高频读路径对 route surface 的冷启动稳定性极其敏感。
- 默认做法：项目列表、导航摘要、context index 这类高频读取优先放到专门的 list/read endpoint；写侧 CRUD 继续保留在各自动态路径里，不把两种职责混在一个高频入口上。

### 37. 一旦 `renderAs` 成为正式 contract，所有“结果形态”叙事都必须切过去

- 结论：只要 `DeliverableData.renderAs` 已经定义为当前结果面的正式派生字段，中心画布、AI debug 工具、项目级上下文摘要和 first-pass prompt 都不该继续拿 canonical `deliverableType` 冒充当前结果形态。
- 为什么：`deliverableType` 只说明 canonical 归类；像 legacy slides 或 `slide_page` 文档这类交付物，真正影响用户和 agent 判断的是当前怎么被投影。如果 view 层已经认 `slides`，但 prompt / debug 还写 `document`，系统会同时暴露两套自相矛盾的“结果形态”。
- 默认做法：用户和 agent 可见的 `Result shape`、`shape: ...`、`Current result shape` 一律读 `renderAs`；只有 blueprint、canonical plan taxonomy 和兼容 mapping 才继续读 `deliverableType`。

### 38. 共享 scope note 的回归断言，优先绑定稳定 note id，而不是裸文本

- 结论：像 `deliverable / project / user` scope Note 这种会在同一 run 内重复出现、编辑器里也会回显的内容，Playwright 回归不该直接对裸文本做 `getByText(...)` 断言。
- 为什么：一旦 user-scope note 跨测试复用，或者保存后编辑器 textarea 还保留同一段内容，strict locator 就会同时命中“卡片正文”和“编辑器输入框”，把真正通过的功能打成假红。
- 默认做法：已有 note 一律优先用 `context-note-{id}` / `context-note-scope-{id}` 这类稳定 selector；新建 note 先通过 API 结果或 list endpoint 找到 note id，再断言卡片本身，而不是直接用文本做全局查找。

### 39. 分支视图一旦进入树状化，里程碑和回退点就必须回到同一条 branch workspace

- 结论：branch focus 不能长期停留在“只过滤里程碑列表”的中间态；一旦系统已经有 branch head、继续续写和恢复点，分支视图就应该同时展示这一条 lineage 的里程碑和 recovery point。
- 为什么：如果 focus 模式只裁掉别的里程碑，却继续把 recovery point 留在全局 pinned / temporary 分区里，用户仍然无法回答“这个回退点属于哪条分支”，树状版本管理就会继续停在半成品状态。
- 默认做法：分支视图默认做成 branch workspace；里程碑、恢复点和分支摘要围绕同一条 lineage 组织，只有回到全局历史视图时才展示跨分支的汇总分区。

### 40. URL 已经切到目标态，不代表 workspace surface 已经收敛

- 结论：像 `conversationId / versionId / fileId` 这类工作区路由切换，Playwright 不能只断言 URL；还必须继续断言目标 surface 自己的正文或标题已经收敛。
- 为什么：在 Next.js 冷编译和多路数据请求并发时，URL 往往会先更新，但中心 surface 的内容要晚一拍才稳定；如果测试只看路由，会把正常中的短暂中间态误报成回归。
- 默认做法：涉及 workspace 路由保持时，统一采用“先等 URL / query param 收敛，再等目标 surface 文本或 heading 收敛”的双阶段断言。

### 41. branch compare 应该先留在当前 lineage，再显式放开跨分支

- 结论：从某条 branch workspace 触发 compare 时，默认比较范围应停留在当前 lineage；跨 branch compare 应该是用户主动打开的第二层能力。
- 为什么：如果 compare 一上来就混入其他分支和当前草稿，branch workspace 的语义会立刻被冲淡，用户也更难判断“我现在到底在比较这条分支内部，还是整个可见版本集合”。
- 默认做法：branch compare 默认预填当前 branch 的 head 与祖先锚点，并显式提供跨 branch toggle；全局 compare 继续保留在 history 顶层入口，不和 branch compare 混成一条主路径。

### 42. 当 branch workspace 已经承担主语义时，就该升格为正式 Version Tree 表面

- 结论：一旦 branch workspace 已经承载分支摘要、lineage compare、只读版本浏览和 global recovery tray，就不要继续把它塞在“历史 dialog”语义里；直接升格为正式 `Version Tree / 版本树` 表面。
- 为什么：如果产品主名称还停留在 history，用户会把已经是一等结构的版本树误解成辅助抽屉，后续每增加一个树语义都会显得像补丁，而不是系统边界已经改变。
- 默认做法：保持同一套版本数据 contract，但把入口、标题、说明和空间预算整体切到 `Version Tree / 版本树`；`history` 只保留为事实时间语义，不再承担产品主表面名称。

## 产品踩坑记录

### 1. 兼容语义进入主表面，会把过渡态永久化

- 现象：`workflowSummary`、`snapshot*` 这类过渡语义一旦继续出现在页面 props、UI helper 或外露 API 里，清理成本会越来越高。
- 教训：兼容可以存在，但必须卡在服务层或迁移层，不能继续外露成产品词汇。

### 2. 同一状态被多个面板重复解释，会让用户怀疑系统有多套真相

- 现象：`Status / Review / Chat / Context` 如果都在讲“当前项目发生了什么”，用户很难判断哪个面板是准的。
- 教训：重复状态说明不是“更贴心”，而是把产品结构重新打散。

### 3. 大纲定位只做默认滚动，会在尾部章节失去上下文

- 现象：点击接近文末的大纲项时，浏览器默认只保证目标进入视口，常常把标题贴在底部。
- 教训：对长文档来说，“看见目标”不够，用户还需要目标上方的上下文空间。

### 4. 把模式切换暴露成独立 UI，通常比能力本身更难理解

- 现象：自动回复 / 手动回复 + “让 AI 回复” 双入口，会让用户先理解模式，再理解动作。
- 教训：如果能力能由消息本身表达意图，就不该再叠一层全局模式开关。

### 5. 强类型交付入口如果不能无损切换，就会反噬成约束

- 现象：把 `document / slides / web` 当成创建即锁死的类型后，后续任何方向调整都会被误解成“重建项目”或“重新开工作区”。
- 教训：如果几种交付物共享同一底层对象模型，就应该优先提供弱类型切换，而不是继续放大类型边界。

## 技术最佳实践

### 1. Rich text 评论应用必须优先走结构化锚点

- 结论：对于 plate/json-backed 文档，评论线程需要记录单段结构化 range，并优先直接修改 plate 树。
- 为什么：富文本文档不是稳定的 Markdown 文本，单靠全文匹配在换行、空白、重复句子场景下很容易失效。
- 默认做法：新线程写入 `start.path / start.offset / end.path / end.offset`；只有旧线程或无结构化 range 时才退回文本兜底。

### 2. 会话上下文和当前可见交付物必须解耦

- 结论：`conversation.baseVersionId` 只承担会话上下文基线，不能偷偷接管用户当前看到的 `fileId / versionId` 表面。
- 为什么：一旦把聊天上下文和可见交付物绑死，切换对话就会出现“对话变了，交付物空了”这类回归。
- 默认做法：切换对话只切 `conversationId`；优先保留当前可见的 `fileId / versionId`，失效时再回退主交付物。

### 3. 高风险动作要前置预检，不要等用户点击后再报错

- 结论：像“应用到原文”这种动作，只有在 direct、非 version view、锚点可定位且无歧义时才应该暴露可执行入口。
- 为什么：点击后才告诉用户“不安全”“定位失败”，会把能力从“可控”变成“碰运气”。
- 默认做法：不支持时提前隐藏或禁用入口，并直接说明阻塞原因。

### 4. 确定性回归要用隔离数据根目录和固定 seed

- 结论：迭代门禁必须跑在隔离 `app-data-root`、隔离数据库和命名场景 seed 上，不能复用真实开发数据。
- 为什么：共享 `dev.db` 会污染样本、放大偶现问题，也会让浏览器回归不可复现。
- 默认做法：功能交付默认用 `npm run verify:iteration` 关闭验收；真实 packaged smoke 留给发布门禁。

### 5. 表现层文件名可以和底层存储路径解耦

- 结论：plate/json-backed 文件可以继续沿用历史底层路径，但 UI 显示名不应继续暴露误导性的 `.md` 后缀。
- 为什么：对用户来说，“它是不是 Markdown”是产品语义；对系统来说，底层路径是否迁移是数据兼容语义，两者不必强绑。
- 默认做法：存量路径保持兼容，产品表面通过统一 presentation rule 去掉误导性后缀。

### 6. 多 agent 监听更适合“绑定窗口 + 客户端瞬态”，而不是数据库状态机

- 结论：评论多 agent 最稳定的持久化对象是线程级 `agentBindings`，而不是 `replyState` 这种会随流式过程频繁变化的瞬态字段。
- 为什么：`responding / queued` 这类状态一旦持久化，刷新、崩溃或进程切换后就很容易脏；而监听窗口和最后激活时间是稳定可恢复的。
- 默认做法：数据库只存 `agentBindings`、消息 mention 审计和 assistant 的 `agentId / agentLabel`；`等待中 / 回复中 / 未就绪` 全部由 bindings、配置和客户端当前流式状态推导。

### 7. 迭代门禁必须验证当前真实语义，而不是旧兼容壳

- 结论：一旦产品主语义已经切换，例如评论从 `reply mode` 改成 `@角色 + 监听窗口`，E2E 和门禁文档就必须同步切到新语义。
- 为什么：如果门禁仍在验证旧兼容行为，得到的“全绿”只是在证明历史路径没坏，不能证明当前产品事实真的可用。
- 默认做法：每次语义收口后，同步清理 seed、helper、spec 和门禁计划里的旧入口；不再用兼容 localStorage 或隐藏按钮当作当前功能的验收代理。

### 8. 当遇到外部 Provider 的阻塞性故障时

- 结论：如果自动化或人工验收期间，第三方大模型节点由于 Token 耗尽、API Key 过期（如 `request failed: EOF`）出现连通性异常，测试路径应立刻执行业务中断，不得强行使用假数据 Mock 主流程。
- 为什么：验收门禁（或人工矩阵）必须验证应用对 `blocked/error` 的业务容错态（譬如“缺失角色配置”等）。隐瞒此错误会掩盖系统的健壮性缺陷。
- 默认做法：在测试台账中记录外部阻塞，标记测试状态为“因不可抗力中断”，优先记录和跟进未测 Case，修复凭据后再行完整回归。

### 9. 共享镜像目录的重建必须串行化

- 结论：同一工作区的 mirror 重建不能并发执行，否则 `rm + mkdir + write` 这类全量重建流程会在创建、重命名、移动文件时互相踩目录。
- 为什么：在支持资料这类高频对象操作里，两个紧邻请求都可能触发 mirror 重建；如果没有串行队列，就会出现偶发 `ENOENT` 或短暂 500，即使最终用户操作看起来“又成功了”。
- 默认做法：同一工作区的 mirror materialization 统一按工作区维度排队；只有底层目录重建串行化后，门禁里的对象操作场景才算真的稳定。

### 10. 验收 seed 必须复现真实产物落点

- 结论：像研究报告这类由产品自动生成的文件，E2E seed 也必须按真实产品规则落到正确目录，而不是为了省事塞进一个更简单的假位置。
- 为什么：如果 seed 和真实持久化路径不一致，门禁可以“全绿”，但验证的其实不是当前产品事实，后续很容易在树、选中态、入口跳转上漏掉回归。
- 默认做法：seed 里构造的文件树、运行状态和报告归档位置都要和真实运行路径保持一致；一旦产品规则改了，先更新 seed，再谈验收通过。

### 11. 模块展示名必须走 copy 层，不能散落在组件里

- 结论：像“交付类型”这类会影响多个面板和引导的模块展示名，必须统一从 copy/config 层读取，而不是在组件里硬编码。
- 为什么：一旦展示名散落在多个组件里，改名时很容易出现一半更新、一半残留，最后 UI 和文档又分叉。
- 默认做法：模块标题、说明文案、动作文案和切换提示都使用统一 copy key；组件只负责结构，不自己发明名称。

### 12. `branch` 这个词必须留给正式版本树

- 结论：在正式版本树落地前，chat 里的消息续写和会话切换不能继续借用 `branch` 这个词。
- 为什么：一旦把 chat fork 叫成 branch，用户会误以为自己已经在操作交付物版本分支，后续 `checkpoint / version` 的边界会被提前污染。
- 默认做法：chat 只说“另开对话 / 对话切换 / 续写对话”；把 `branch` 留给交付物版本树和正式分叉入口。

### 13. 路由切换后的版本弹层验收，必须先等主表面稳定再重开 overlay

- 结论：凡是“从历史继续 / 切分支”这类会触发 `conversationId` 或 `versionId` 路由切换的版本操作，E2E 里都不能在 URL 刚变化后立刻重开 `Version` 历史弹层。
- 为什么：Next/React 重渲染期间，主按钮虽然已经重新出现，但 click 可能落在正在替换的节点上，最终表现成历史按钮“偶发点了没反应”，造成门禁假红。
- 默认做法：这类用例先等待新的主表面文本或核心结果壳稳定可见，再通过带重试的 helper 重开弹层；不要把“URL 已变化”误当成“页面已经可交互”。

### 14. 版本树 E2E 优先锚定稳定语义 id，不要绑定 overview 卡片内部文案结构

- 结论：像 branch overview 这种既会扩动作按钮、也会调整 lineage 文案的卡片，E2E 不应再靠 `hasText('版本里程碑 V2')` 之类的组合选择器去找核心动作。
- 为什么：卡片内容一旦因为 copy、徽标、聚焦态或布局层级变化而重排，实际功能没坏，门禁也会因为“找不到按钮”产生假红。
- 默认做法：分支切换、分支聚焦、当前分支标记这类关键交互统一直接命中稳定的 `data-testid`，文案断言只保留给用户可见结果层。

### 15. 带 first-use guide 的页面验收，要等 guide 自身稳定，而不是只扫一遍“知道了”

- 结论：对于 `Status / Version / Workflow` 这类会在客户端挂载 first-use guide 的页面，E2E 不能只用通用 `知道了 / Got It` 按钮选择器扫一遍，就假设提示已经清空。
- 为什么：first-use guide 依赖客户端 `localStorage` 检查后才会渲染，实际挂载往往晚于首屏壳和主动作按钮；如果 helper 过早返回，后续点击就会和迟到出现的 guide 或正在替换的节点打架，制造偶发假红。
- 默认做法：引导相关 helper 优先命中 `first-use-guide-*` 这类稳定 test id，等待“连续两次无可见 guide”再继续主交互；不要把“当前没有看到任何 got-it 按钮”误当成页面已经稳定。

### 16. 运行态预览不能只靠单独轮询的 runs 列表恢复

- 结论：只要页面刷新后仍需要继续显示一个正在运行的 preview，`workspace view` 就必须直接携带 `activePreviewRun` 一类的当前事实，不能把 iframe 渲染完全寄托给另一次异步 `runs` 轮询。
- 为什么：如果首屏只知道“预览已启动”，但真正决定 iframe 的 run 信息要等第二个请求回流，用户就会看到“状态已启动、中央画布还是空的”这种短暂自相矛盾；E2E 里一 reload 也会放大这个 race。
- 默认做法：首屏 view 直接带当前 active preview run；客户端在 `preview/start` 成功后也要先把返回 run 写回本地状态，再异步刷新完整 runs 列表。

### 17. 复用工具流式协议时，每个消费端都要显式剥离 control token

- 结论：同一套 tool-enabled stream 协议一旦被复用到 comment reply、chat 之外的 UI，消费端必须显式清理 heartbeat / control token，不能假设只有主聊天面板会收到这些片段。
- 为什么：协议层控制字符本身不是用户可见内容；如果评论侧直接拼接原始 chunk，UI 会把心跳 token 当正文显示，表面看像“AI 回复异常”。
- 默认做法：所有消费流式文本的 hook / 组件统一走 control-token strip，再把净化后的文本写入状态；不要让某个新入口绕开协议清理层。

### 18. 会被页面卸载打断的 preview/start，不能只靠 keepalive

- 结论：只要 `preview/start` 之后用户可能立刻刷新或跳走，前端就不能只依赖 `fetch(..., { keepalive: true })`；还必须补一层短时恢复状态和 reload 侧的 run warmup 观察。
- 为什么：原页面发出的启动请求可能在服务器端成功，但新页面的首个 `runs` 请求来得太早，于是 UI 只能看到“预览已启动”却拿不到真正的 run；如果只靠一次性恢复重试，也会漏掉“原请求其实已经成功，只是新页面没观察到”的竞态。
- 默认做法：`preview/start` 时写入短时 pending marker；新页面 reload 后先做一小段 `runs` warmup polling，优先接住已经成功的 run，只有在仍然没有 active run 时才按 marker 补发恢复启动。

### 19. legacy 类型收口，不能只改画布和 prompt，还要改创建/计划/payload 边界

- 结论：当 `slides` 这类旧类型已经在产品语义上降级成 `document` 的一种内容投影时，create route、plan route、本地恢复态、replan proposal 和 assistant payload 也必须同步归一，不能只在渲染层或 AI 提示里“口头统一”。
- 为什么：如果 API 和 session payload 还允许继续写出旧类型，系统就会进入“入口看起来统一，但底层还在偷偷生成历史语义”的半收口状态，后续计划、恢复和 agent 上下文会继续反复冒出旧分支。
- 默认做法：建立单一 normalization helper，把 legacy 类型在共享契约入口就折回 canonical 语义；legacy 兼容只保留给读取和展示，不再进入新的写入路径。

### 20. 术语收口不能只看当前可见 UI，还要清理 workflow / prompt / dead copy 回流点

- 结论：当产品已经把“类型切换”改成“结果形态”语义后，不能只改眼前页面组件；workflow draft、replan prompt、first-pass prompt、工具描述和未使用的 i18n key 也必须一起清理。
- 为什么：这些隐性文本虽然不总是直接显示在当前页面上，但会继续出现在 workflow 内容、AI 总结、后续搜索和开发维护里，导致旧术语从共享 copy 层或 AI 生成内容里反复回流。
- 默认做法：每次做术语收口，都同时扫一遍 UI copy、workflow/template 文案、AI prompt 和 dead i18n key；只要某个旧词已经退出产品主语义，就不要再让它留在 fallback 文案或共享文案表里。

### 21. web 继承评论去重，不能只靠旧 fingerprint，必须补高信号 identity candidate

- 结论：只要 web 锚点可能因为重构改掉 selector，继承线程和新 direct 线程的去重就不能只看旧 fingerprint；还要同时比较完整 selector、excerpt 和 domContext 这类高信号 identity candidate。
- 为什么：如果只靠 selector 或旧 fingerprint，同一块结果一旦迁移到新 DOM 节点，系统就会把“旧 inherited + 新 direct”同时留在 actionable 区，用户无法判断到底该跟哪条线程继续推进。
- 默认做法：web 继承分类先做当前表面的 stale 判断，再用高信号 identity candidate 判断是否已被新的 direct 线程覆盖；覆盖后统一标成 `superseded`，收进 `Earlier Context`。

### 22. 缩产品分类时，要把“存量存储兼容”和“公共 canonical 语义”拆开处理

- 结论：像 `code` 这类历史类型，如果产品层已经明确只剩两条主路径，就不要继续让它占据共享 canonical helper、label、blueprint 和默认推断；但也不必一次性删掉底层存储字段和 file kind。
- 为什么：直接硬删底层兼容会把风险扩散到历史数据和运行时；但如果继续把历史类型留在公共 canonical 层，新的 plan、label 和 AI 默认语义又会不断把它重新长回产品表面。
- 默认做法：先把公共 canonical helper 收成产品真正承认的那几条主路径，再把 legacy 类型限制到 normalize / read / file-kind 这类内部兼容层；只有在外层语义稳定后，再逐步清理更深的存量分支。

### 23. web 继承线程的 stale 判定，不能把零散 selector token 当成仍可定位的证据

- 结论：对于 `web-component` 线程，只要 selector、excerpt 和 domContext 都已经漂移，就不能因为页面里还残留一个同名 token 或无关 id 片段，继续把旧线程判成 actionable。
- 为什么：selector token 往往会在重构后的新节点、样式类名或无关元素里残留；如果 stale 判定只靠这些碎片命中，旧 inherited 线程就会假阳性存活，用户会把早已失效的评论继续当成当前待处理事项。
- 默认做法：web stale/fallback 只认强信号来源。selector 至少要能匹配完整 selector 或稳定 id 来源；excerpt 要命中完整片段；domContext 要命中完整上下文或至少两个稳定片段。做不到这三类证据时，线程直接转 `stale` 并收进 `Earlier Context`。

### 24. 收口 legacy 类型时，要把 file seed、默认路径、默认 kind 和阶段 fallback 一起归一

- 结论：把历史类型从公共 canonical 语义里收掉还不够，create route、live draft 默认路径、文件 kind 和 plan 阶段 fallback 也必须一起折回当前主语义。
- 为什么：如果只改 label、blueprint 和推断，但 file seed 仍在生成 `index.ts`、runtime 仍默认 `kind=code`、plan 仍走 `implement / verify`，系统就会在更深的 create/runtime 层重新长回被收掉的旧类型。
- 默认做法：做 legacy 类型收口时，统一检查 create seed、live draft upsert、默认文件路径、默认 kind 和阶段 fallback；确保新的写入路径只产生当前产品承认的默认值，历史类型只留在 normalize / read / file-kind 兼容层。

### 25. 结果面标签必须描述当前投影，而不是借用创建时的类型词

- 结论：像 slide 结果面这种由内容投影出来的当前表面，badge 和说明文案应该描述“你现在看到的是什么视图”，而不是沿用创建流里的旧类型名。
- 为什么：一旦结果面继续显示 `Presentation / 演示稿` 这类历史类型词，用户会把当前表面误解成“又回到了旧 deliverable type”，而不是统一内容模型下的一种投影；共享 copy 里的旧 key 也会继续给后续组件提供回流点。
- 默认做法：结果面 badge、空态和说明统一用当前视图语义命名，例如 `Slide View / 幻灯片视图`；不再复用创建流或旧类型切换遗留下来的 key，dead copy 一旦失效就直接删除。

### 26. `fileKind=code` 只是实现线索，不能单独当成网页语义证据

- 结论：在统一交付模型里，primary file 的 `kind=code` 只能说明“这份内容当前以源码文件存放”，不能单独推出它一定是网页交付物。
- 为什么：历史实现说明、技术附录、无 plan 的迁移中间态都可能暂时落成 `code` 文件；如果共享推断只看 file kind，就会把项目级摘要、AI context 和结果壳语义误导到 `web` 主路径上。
- 默认做法：网页推断至少要同时看到 goal、title、文件路径或其它 corpus 里的明确网页信号；`fileKind=code` 只作为辅助线索，不单独决定最终 deliverable 语义。

### 27. 公共 canonical 类型和 stored legacy 类型要拆成两个字段，不能继续共用一个 union

- 结论：一旦产品层已经确定只承认 `document | web` 这类 canonical 语义，就不要再让 legacy `slides / code` 混在同一个公共 `DeliverableType` union 里。
- 为什么：只要公共 union 还带着 legacy 值，workspace view、项目级 AI context、label helper 和其它共享代码就会不断把旧语义重新带回产品表面；但如果直接删掉 legacy 值，又会失去对存量 plan 值和旧结果面的安全兼容。
- 默认做法：公共字段只暴露 canonical 类型，另加显式 stored compatibility 字段承载 legacy 值；normalize / read / projection 层专门消费 legacy 字段，新的写入和公共 view model 一律不再回流旧类型。

### 28. AI prompt/tool 摘要也必须先 canonicalize，再决定怎么命名语义

- 结论：当 stored plan 里还允许 legacy `slides / code` 值存在时，plan generator、workspace tools 和项目级摘要不能直接把原始值按 `Deliverable type` 拼进 prompt。
- 为什么：哪怕 UI 和公共类型契约已经收口，只要 prompt-facing 摘要还直接发出旧值或旧标签，AI 就会继续把历史兼容语义当成当前产品表面事实，后续总结、计划和跨交付物读取都会被旧词污染。
- 默认做法：所有进入 AI prompt 的 deliverable 摘要先 canonicalize 成当前产品承认的 result shape，再用 `result shape / shape` 这类当前命名输出；不要让 stored legacy 值和 `Deliverable type / Type` 旧术语直接进入 prompt。

### 29. 结果形态收口不要只改显式类型词，`implementation` 这类隐性心智也要一起清

- 结论：当产品已经不再把 `code/implementation` 当成独立主结果形态时，首页 hero、通用 AI 指令和 plan blueprint 里仍然把 `implementation` 当主示例的文案也要同步清掉。
- 为什么：这些词虽然不总是直接表现为旧类型选择器，但会持续把用户和 AI 往“做一个实现物/代码产物”的旧心智上带，稀释统一结果形态模型的主语义。
- 默认做法：面向用户和 AI 的通用文案优先使用 `result`、`supporting asset`、`source details`、`interaction details` 这类当前语义；只有在确实讨论底层实现时，才局部使用 `implementation`。

### 30. 调试面和验收辅助链路也必须跟产品主契约同步收口

- 结论：像 `get_workspace_context` 这类既服务 AI、又服务 debug/E2E inspection 的详情面，不能因为“不是正式 UI”就继续透传 raw stored `slides / code`。
- 为什么：summary 文案即使已经 canonicalize，只要 debug details 还在直接暴露旧值，测试辅助链路、调试工具和后续实现者就会继续把 legacy union 当成真实公共契约，旧语义会从非 UI 面重新回流。
- 默认做法：inspection/details 返回值也要与正式 view model 对齐，统一输出 canonical `deliverableType`，并把历史兼容值压进显式 `storedDeliverableType`；任何辅助调试接口都不应绕过这条边界。

### 31. 巨石 hook 的第一刀要先抽 request / stream façade，再继续拆对象和 UI 细节

- 结论：像 `use-chat.ts` 这类同时负责 endpoint 拼装、流读取、超时控制和 UI 状态的 hook，拆分第一刀应先抽 request / stream façade，让 hook 先摆脱协议与 transport 细节。
- 为什么：如果一开始就只按目录或函数块硬切，`fetch` 路由、header 解析、abort / timeout 这些低层耦合会原封不动散到多个新文件，巨石只是搬家，不是收边界。
- 默认做法：先把 request builder、stream controller、response reader 收成稳定边界，再继续抽本地消息草稿、状态编排和更高层 runtime。

### 32. 带 header 的流式 AI 响应，应该把 status / header / stream read 一起收进 helper

- 结论：像 chat/continue 这种既依赖 `response.ok`，又要读 workspace change headers 和文本流的响应，不应把这些 transport 细节散在 hook 分支里；它们应该收进同一个 response helper。
- 为什么：如果每个入口都各自手写 ok/error 解析、workspace header 提取和 stream body 消费，后续一旦 header、控制 token 或错误协议变动，就会在多个 hook 里同步扩散，增加回归面。
- 默认做法：hook 只负责 optimistic state、状态文案和业务分支；response helper 统一负责 ok/error 解析、header 解析、control-token strip 和文本流消费。

### 33. 页面级长流程里的 preview/network action，也要尽早抽成 client helper

- 结论：像 preview start / stop 这种挂在超大页面组件里的网络动作，不应继续把 `fetch`、keepalive、JSON 解析和错误文案分支直接写在页面里；它们应该先收成薄 client helper。
- 为什么：页面组件本来就同时承载状态编排、恢复逻辑和 UI；如果 request 细节也留在这里，不但难以继续拆分，还容易漏掉某个分支的网络错误处理。
- 默认做法：页面层只保留 notice、loading state 和 recovery 编排；client helper 统一负责 request 细节与错误解析，顺手补齐之前缺失的 catch 分支。

### 34. 同一路径簇里的版本动作，应该一起沉到同一个 client helper

- 结论：像 `/versions`, `/versions/:id`, `/versions/:id/restore` 这类共享同一路径簇和错误处理方式的动作，不应继续散在页面不同 callback 里；它们更适合一起收进 `version-client` 之类的同域 helper。
- 为什么：如果每个版本动作都在页面里各自维护一套 `fetch + response.ok + json + notice fallback`，后续继续收 `continue / switch / branch` 时就很难看出哪些是同一边界、哪些只是偶然相邻。
- 默认做法：先按路径簇和 payload 形状分组收 request helper，再让页面只保留状态更新、location 跳转和成功文案；不要等整个大页面拆完才去辨认这些 request seam。

### 35. 树状侧栏里的同域 CRUD，要按 surface cluster 一起抽 façade

- 结论：像 support file tree 这类共享同一侧栏 surface、同一错误协议和同一重载方式的 create / rename / move / delete / reorder 动作，不应按单个 callback 零散拆；它们更适合先汇总成同域 client helper。
- 为什么：树状侧栏里的 reorder 往往只是 move 的一种变体；如果页面继续分散维护多组 `fetch + response.json + notice/load`，后续既难复用，也会让“哪几组动作属于同一个 seam”越来越模糊。
- 默认做法：先按同一个 surface cluster 收 request helper，让页面层只保留当前选中项判断、reload 和 notice；同一簇里的 reorder 优先复用 move helper，而不是单开一套 transport 逻辑。

### 36. 同一 project tree surface 里的不同实体，也可以共享一个 façade 边界

- 结论：像 project folder 和 deliverable 这种底层实体不同、但都挂在同一 project tree surface 上的动作，不必人为拆成两套页面级 request 逻辑；只要 transport 契约和 UI 收口方式一致，就应该收进同一个 project-tree helper。
- 为什么：如果页面继续把 folder 和 deliverable 当成两组互不相关的 callback，仅仅因为它们表不同，`fetch / error parse / reload` 会重复出现，后续再清理 project shell 动作时也更难识别真实 surface 边界。
- 默认做法：判断 façade 边界时先看用户看到的是不是同一块 surface、错误协议是否一致、页面回写方式是否一致；满足这三条时，即使底层是不同实体，也优先放进同一个 helper。

### 37. 同一 project surface 里，tree 动作和 shell 动作应拆成相邻但独立的 façade

- 结论：project folder / deliverable tree 动作和 project rename / delete 这类 shell 动作虽然都属于同一个 project surface，但不该硬塞进同一个 helper；更稳的边界是“相邻两层 façade”，分别覆盖 tree 和 shell。
- 为什么：tree 动作的页面收口通常是 reload / reorder / relocation，而 shell 动作的页面收口更偏向标题回写、根路由跳转和项目级 notice；如果为了“都叫 project”强行并到一起，helper 会重新长成杂糅的 transport 抽屉。
- 默认做法：先按同一 surface 再按 UI 收口方式分层；当一组动作共享 project 语义但页面回写方式不同，就拆成相邻 façade，各自保持单一 transport 职责。

### 38. 同一创建 surface 的 transport 和 recovery 契约，应由共享 helper 收口

- 结论：像首页新建项目和 workspace 内“新建同级交付物”这种共用同一 `POST /api/workspaces`、同一 idempotency header 和同一 recovery storage 的创建入口，不应在两个页面里各自手写 request / response / retry 分支；它们应该共享同一个 create helper。
- 为什么：这类创建流真正复杂的不是按钮位置，而是 transport 契约和异常分流。若页面各自维护 `fetch + response parse + recovery payload`，后续一旦接口、header 或 retry 语义调整，就会在多个入口上重复扩散并增加回归面。
- 默认做法：把 create body 组装、response 校验和 recovery builder 收进 `create-request` 之类的共享 helper；页面层只负责成功后的 reset / route push，以及网络失败时是否进入 recovery 态。

### 39. 同一 workspace surface 的读侧 request，也应按 polling cluster 一起抽 helper

- 结论：像 `loadWorkspaceView / loadRuns / loadThreads` 这种都服务同一个 workspace surface、并被首次加载和轮询复用的读侧 request，不应继续散在页面里各自拼 query 和 `fetch`；它们更适合一起落到同一个 read helper。
- 为什么：这类读动作的复杂度不在页面状态，而在 transport 契约和参数拼装。若页面层同时拥有 polling 节奏、editor reset 和 query 细节，后续很难判断“页面逻辑”和“读取协议”各自的边界，也会让下一刀 seam 变得模糊。
- 默认做法：把 query 拼装、endpoint 路径和响应解析收进同域 read helper；页面层只保留结果回写、轮询编排和必要的 UI reset，不再直接持有 read-side transport。

### 40. autosave seam 要把 debounce 留在页面，把持久化 request 收进 helper

- 结论：像文本文件 autosave 这种同时带 optimistic content 回写、debounce 定时器和 saving indicator 的动作，不该把这三层一起搬进 helper；更稳的边界是页面保留时序状态，helper 只负责 `PATCH /files/:id` 的持久化 request。
- 为什么：autosave 的复杂点在“何时发请求”和“发请求前页面怎样先更新”，不在 transport 本身。如果 helper 同时吞掉 debounce 和 optimistic state，就会重新把页面状态机藏进 transport 层，后续更难继续把 route 页收成纯适配壳。
- 默认做法：页面层负责本地内容回写、timeout 清理和 saving flag；文件 helper 只负责发送内容补丁，不在这一层叠加额外 UI 时序。

### 41. route shell 下沉时，先透传现成 panel node，再逐步下沉各自 surface

- 结论：像 workspace route 这种既有 sidebar render prop、notice banner、split layout 和 dialog 的大壳，不必一开始就把所有 panel 逻辑一起搬走；更稳的做法是先提一个 `workspace-screen` 之类的壳组件，让页面把现成的 panel node / actions / dialog 透传进去。
- 为什么：如果在第一刀就同时重写壳和 panel wiring，route 页、surface 页和业务组件的边界会一起变化，回归面过大，也很难判断问题来自 layout 提取还是业务 props 漏传。
- 默认做法：第一刀只抽 `AppShell + notice + guide + split-view + dialog slot` 这类纯壳结构；等壳稳定后，再按 panel cluster 把 status/review/chat/context 逐个下沉成独立 surface。

### 42. panel cluster 下沉时，先用薄 surface wrapper 固定 slot 契约

- 结论：像 assistant rail 这种已经有稳定 slot 契约的组合区，status/review/chat/context 不必一上来重写内部组件；先给每个 slot 包一层薄 surface wrapper，更容易把 route 页里的 JSX 组合移走而不改变行为。
- 为什么：这些 panel 的真正风险往往不是内部 UI，而是 route 页如何把 `showHeader / embedded / onOpenChange` 这类局部约束反复散落地传入。先用 wrapper 固定这些约束，可以让后续继续下沉 panel 逻辑时保持单一入口。
- 默认做法：对于已有成熟业务组件的 panel，先建立 `surface -> existing component` 的薄包装层，硬编码共同的 slot 约束，再让 route 页只透传数据和事件。

### 43. 大页面里的重型 view 函数，优先连同 helper 一起平移到 canvas 模块

- 结论：像 `buildDeliverablePanel` 这种内部又带 preview、slides、richtext、source fallback 和 plate/outline helper 的重型 view 函数，不适合只抽最外层壳；更稳的是把它和紧邻的 helper 一起搬进 `canvas/*` 模块。
- 为什么：如果只搬主函数，不搬 `parsePlateContent / normalizeDeliverableText / buildOutlineItems` 这类紧邻 helper，page 会残留一串“看似纯工具、实则服务同一 view cluster”的实现，后续边界仍然模糊。
- 默认做法：判断 page 里的大函数是否值得下沉时，不只看 JSX 体积，还看它是否自带一组只服务该 surface 的 helper；满足这点时，按 cluster 整块平移，而不是拆成碎片 helper。

### 44. service 巨石开始按对象拆时，先抽纯 schema helper，再保留 service 的过渡导出

- 结论：像 `service.ts` 这类历史总入口在开始按对象拆分时，不必一上来就移动带数据库副作用的 commands；更稳的第一刀通常是把纯 schema / payload / path / default helper 先抽到 `objects/{name}/schema.ts`，同时让旧 service 继续 re-export。
- 为什么：纯 helper 没有事务、权限和调用顺序负担，适合作为对象边界的第一层稳定出口。若一开始就强拆 commands/query 混合簇，service 与新对象模块之间更容易出现循环依赖和半迁移状态。
- 默认做法：先识别“只做 map、parse、infer、normalize、path 组装”的对象纯函数簇，把它们落进 object schema 模块；旧入口暂时只做 import/re-export，等 schema seam 稳定后再继续拆 commands 和 queries。

### 45. schema seam 稳定后，第二刀优先拆同对象的 DB helper cluster

- 结论：当 `objects/{name}/schema.ts` 已经接住纯 helper 后，下一刀最稳的通常不是跨对象跳跃，而是继续把同一对象里最靠近它的 DB helper cluster 抽到 `commands.ts` 或 `queries.ts`，例如 bootstrap / path repair / read mapping 这类局部实现。
- 为什么：同对象连续拆分可以复用刚建立好的 import 边界和命名约定，减少“新模块刚落地就被搁置”的半迁移状态；而且 service 巨石会更快从“自己实现一切”退回到“只做代理出口”。
- 默认做法：object seam 第一刀落 `schema.ts` 后，第二刀优先找这个对象里不依赖其他大 service helper 的 DB cluster，继续抽到相邻 `commands.ts` 或 `queries.ts`，而不是立刻跳去另一个毫不相邻的对象簇。

### 46. command seam 需要 service 注入边界约束时，优先传依赖，不要把旧 service 整体搬过去

- 结论：当 object command 已经准备独立，但仍依赖 workspace service 持有的锁校验、权限或外层事务边界时，更稳的做法是由 service 通过依赖注入把这些约束传进去，而不是把整段 service helper 原样复制进 object module。
- 为什么：直接把 `ensureWorkspaceEditable` 之类的边界逻辑搬进 object module，容易让对象层重新吸入 workspace 级职责，甚至引入循环依赖；而只注入最小依赖，既能继续抽离 command seam，又能让 service 暂时保留 façade 和编排责任。
- 默认做法：object command module 只声明自己真正需要的 guard / side-effect 依赖，由旧 service 作为过渡出口来组装这些依赖并维持旧调用面；等相邻边界也稳定后，再决定是否继续下沉 guard 本身。

### 47. command 主流程下沉时，先让 object command 返回底层记录，再由 façade 保持现有 map 出口

- 结论：当 service 导出的对外返回已经稳定在 `mapWorkspaceVersion` 这类映射上，而 command 主流程需要先下沉到 object module 时，更稳的做法是让 object command 返回底层记录，旧 service façade 继续负责映射。
- 为什么：如果在 object command 里直接复用旧 service 的 map 函数，很容易引入循环依赖；如果为了避免循环把 map 层一起搬走，又会让切片从 command seam 膨胀成 schema/view seam。先保留 façade mapping，可以在不改对外契约的前提下完成主流程迁移。
- 默认做法：object command 只负责事务、side effect 编排和原始 record 返回；旧 service export 作为兼容壳调用 object command 后再做 map，等相邻 schema/query seam 稳定后，再评估是否继续迁移映射出口。

### 48. object command seam 长大时，要按命令族拆文件，不要把所有迁移动作继续堆进一个 `commands.ts`

- 结论：当同一 object 的 command cluster 已经接近文件大小约束时，新 seam 仍应留在同一个 object 边界里，但要按命令族拆成相邻文件，而不是继续把所有流程硬塞进单个 `commands.ts`。
- 为什么：如果每次迁移都只往一个 `commands.ts` 追加，虽然 service 巨石在缩小，但 object module 自己会重新长成新的巨石，也会持续违反仓库的文件大小契约并放大后续 merge 冲突。
- 默认做法：保留 `objects/{name}` 的公开出口不变，把彼此相邻但职责不同的 command 族拆成邻近文件，例如把 version command 和 draft rewrite command 分开；service façade 继续只注入边界依赖，不回退到跨层复制实现。

### 49. route 页里成片的 surface prop 组装，要尽早提成 surface adapter

- 结论：当某个 page 已经主要在做“给现成 surface / component 拼 callback、guard 和导航 glue”时，这块组装代码应尽早提成独立 surface adapter，而不是继续留在 route 页里横向展开。
- 为什么：这类代码表面上不像“业务逻辑”，但会快速把 route 页撑成几千行，也让每次读页面都得同时扫一遍 version-view guard、router 跳转和 action wiring，后续继续拆 dialog 或 header action 时也更容易互相缠绕。
- 默认做法：保留现有底层 surface / component 不动，新增薄 adapter 负责 version-view 禁用、导航回调和 prop 形状适配；route 页只保留状态源与少量高层编排，不再直接展开整块 prop wiring。

### 50. route chrome 的 dialog / 标题切换 surface，可以把清理语义收进 adapter，只给页面留一个 reset 回调

- 结论：像 title switcher、goal dialog 这种 route chrome 级 surface，在抽离时不需要把状态清理逻辑继续留在 page 的 JSX 内联回调里；更稳的是把 open-change 包装放进 adapter，再让页面只提供一个 reset callback。
- 为什么：如果 JSX 留在 route 页里，`clear recovery / reset seed values / 清空 context / 复位 request id` 这类清理步骤会继续散落在内联函数里，页面虽然变短一点，但真正容易出错的关闭语义仍然难读也难复用。
- 默认做法：surface adapter 自己持有 `onOpenChange` 包装，内部判断 recovery / disable 状态；route 页只传当前 open 状态、提交回调和一个集中 reset 函数，不再直接展开整块 dialog close 语义。

### 51. 带 recovery / seed / idempotency 的创建流，surface adapter 落稳后要继续抽成 controller hook

- 结论：如果 route 页上的创建弹窗已经变成“多个入口打开同一个 dialog”，下一步不要让 recovery rehydrate、request id、seed values 和成功跳转继续散落在 page；这类状态机应该再下沉成 controller hook。
- 为什么：单纯把 JSX 提成 surface adapter 还不够，`load recovery / clear transient state / persist retry payload / push 到新 workspace` 这些控制流一旦仍留在 page，新增入口时很容易漏掉某个 reset 或 request id 规则，route 页也会继续被一整簇“开 dialog 之前先怎么收尾”的逻辑占满。
- 默认做法：先保留现有 dialog surface，不改提交语义；新增 route-local controller hook 统一持有 recovery、seed、submit 和 router push，只给 page 暴露 `open...` action 与渲染好的 dialog 节点。

### 52. route 页巨石进入后半程时，优先按 controller seam 连续抽 hook

- 结论：当 surface adapter 已经落稳，但 route 页仍堆着长串 effect / callback 时，下一轮切片应连续按 controller seam 抽 hook，而不是重新回到零散 JSX 搬运。
- 为什么：sidebar action、version/preview、read/poll/url sync、shell state、outline navigation 这些 imperative cluster 才是 route 页真正的复杂度来源；它们一旦各自归位，页面会很快退回“derive + compose”的稳定形态。
- 默认做法：按“外部 action controller -> version/preview controller -> read/poll/url sync controller -> shell state controller -> 剩余 imperative helper”的顺序拆，每刀只保一个 surface contract 不变。

### 53. page refactor 的止损点要看控制流是否退场，而不是继续追逐更低行数

- 结论：当 route 页不再直接持有成片 effect / callback / DOM helper，只剩状态推导和 surface 组装时，这一轮 page controller seam 可以视为基本收口。
- 为什么：继续为了追求更低行数而硬拆零散 derive/helper，容易把切片从“清理控制流”扩大成新的 view-model 设计题；这时更合理的是先更新 tracker，再判断下一刀是剩余 derive helper 还是切回别的巨石 seam。
- 默认做法：用“是否还存在一簇值得单独抽走的控制流”作为继续标准；如果没有，先在 tracker 里切换到下一条明确 seam，而不是无条件把页面拆到最细。

### 54. route 页止损后，service 巨石优先回收纯 view mapper seam

- 结论：当 `page.tsx` 已经退回到“derive + compose”为主，而版本主流程又被 Phase 3 stop-loss 卡住时，最稳的下一刀通常不是继续挖 page 零散 helper，而是回到 `service.ts` 抽一簇纯 view mapper 与相邻 normalize helper。
- 为什么：`mapConversation / mapConversationMessage / mapChatAttachment / mapAssistantRun` 这类 cluster 不涉及事务、锁和恢复编排，迁移风险明显低于继续碰 `restore / continue / switch branch`；同时它们还能给后续 workspace/wiki/comment mapper seam 建立新的 object 边界。
- 默认做法：按对象语义把 mapper + normalize helper 一起落到 `objects/{name}/view.ts` 之类的相邻模块，旧 `service.ts` 继续 import + re-export 保持出口稳定；先吃掉这类纯映射 seam，再决定是否继续推进下一簇 mapper 或 query/command seam。

### 55. 跨 phase 迁移要先落 additive model seam，再替换旧语义来源

- 结论：当上一 phase 因 stop gate 收口，而下一 phase 要引入新持久对象或新状态边界时，第一刀应先把 schema、object module 和最小读写骨架落地，但不要同时改现有运行时语义来源。
- 为什么：如果把“新模型出生”和“旧字段退场”绑在同一刀里，回归一旦失败，很难判断问题来自 migration、query wiring 还是业务语义切换；相反，先把 additive seam 跑绿，后续每一刀都能更清楚地归因。
- 默认做法：先新增 table / object skeleton / 基础 type 与 migration，保持旧字段继续供 runtime 使用；等 bootstrap 门禁通过后，再单独做读侧 hydration、最后做写侧和语义切换。

### 56. object view seam 分拆时，façade export 和目标模块出口必须同轮闭环

- 结论：当 `service.ts` 把 mapper / view builder 下沉到 `objects/*/view.ts` 时，旧 façade 的 import + re-export 和新模块的全部相邻出口必须在同一轮闭环。
- 为什么：如果 tracker 先宣布切片完成，但目标模块漏了 `mapKnowledgeItem / mapMemory / mapWorkspaceWithRelations` 这类相邻出口，static gate 会立刻把“半落地 seam”打出来，canonical frontier 也会看起来比真实代码更靠前。
- 默认做法：每次 view seam 抽离后，立刻用 `service.ts` 的 import 列表和 re-export 列表反查目标模块；只有模块出口、façade 兼容层和 verify 结果同时对齐，tracker 才算真正前推一刀。

### 57. enum 到 label 迁移的写侧切片，必须同轮补齐所有同类 writer

- 结论：当 read-side 已开始优先消费 label，而下一刀把 label 写回 manual state 创建流时，不能只修主入口；`continue / branch` 这类旁路 writer 也要在同一轮一起补齐。
- 为什么：如果某个 manual state writer 继续只写旧 enum 而不写新 label，fallback 虽然能让回归暂时通过，但 canonical frontier 会重新出现“同类 state 一部分带 label、一部分只有 versionType”的隐形分叉，后续 query、backfill 和 head 生命周期都会越来越难收口。
- 默认做法：每次把新 label 接回写侧前，先对目标对象做一次 `version.create` / 同类 mutation grep，列出所有同类 writer，并在同一切片里一起补 label create/archive 逻辑，再跑完整 `npm run verify:iteration`。

### 58. 当旧 enum 只剩内部生命周期语义时，应尽快把所有运行时读取切回 additive label contract

- 结论：一旦 `versionType` 之类的旧枚举字段只剩 recovery/pinned 这种内部生命周期语义，下一刀不该把它继续保成“最后一个真相源”；更稳的是扩展 additive label contract，让应用层统一回到 label derive，只把旧字段降成写透兼容。
- 为什么：如果应用层继续读旧 enum，只会把新模型的 stop gate 永久卡在“还差最后几个 recovery 分支”；而一旦读侧、query、API 出口和 AI 摘要都统一改读 labels，剩下的旧字段就只是一层兼容存储，不再决定运行时语义。
- 默认做法：先补 recovery/pinned label backfill，再把 service、query、route、AI 摘要等所有读路径一起切到 label derive；旧 enum 可以暂时继续写入，但不再被应用层读取。

### 59. 存储型 JSON 生命周期一旦被多个 route 共享，就要先收成 object seam

- 结论：像 `agentBindingsJson` 这种“仍需兼容写入、但语义已经跨多个 route 共享”的存储型 JSON，不应该继续让每个 API 自己做 `parse / refresh / stringify / resolve target`；更稳的是先下沉到 object seam，再决定后续是否彻底删掉这层存储。
- 为什么：一旦 `threads`、`comment-reply`、`research-plan`、`research-start` 都各自内联同一套 JSON 生命周期，后续不管是改 listening window、补 stop 事件，还是切到 derive-only 真相源，都会被迫做多点同步，极易留下“某条路还在读旧 JSON 语义”的暗缝。
- 默认做法：先新增纯 helper 或 object module，把 stored JSON 的 parse / refresh / stop / target resolve 语义集中收口；等调用面只剩一处后，再做真正的真相源切换和存储下线。

### 60. server-only runtime seam 不要经由 client-facing barrel 暴露

- 结论：只要新抽的 runtime/helper 依赖 `node:fs`、OAuth key store 或其他 server-only 模块，就不能顺手从一个同时被 client hook 复用的 barrel（例如 `framework/agent/index.ts`）里一起 re-export。
- 为什么：barrel 一旦被 client graph 引用，Turbopack 会把 server-only helper 一路追到浏览器 chunk，最终变成 `node:fs` / `node:fs/promises` 不可打包的编译错误；这种问题不会在单看 helper 文件时暴露，而会在集成验证里突然炸出整条 import trace。
- 默认做法：server-only seam 直接从显式路径 import，并在模块顶部加 `server-only`；共享 barrel 只暴露明确允许进入 client graph 的类型和 helper。

### 61. 统一外部 AI 入口时，先落共享 handler 和新入口，再把旧 route 降成 forwarder

- 结论：当多个 AI route 已经在内部 runtime、assistant-run lifecycle 和 prompt/context assembly 上逐步收口后，外部入口统一不应该直接删旧 route；更稳的是先新增一个共享 server handler + 新入口，再把旧 route 改成 forwarder。
- 为什么：如果直接一刀把 `/api/ai/chat`、`/api/ai/research-plan` 之类的旧入口删掉，客户端 transport、测试矩阵和历史调用面会同时移动，回归一旦出问题很难判断是 handler 逻辑、路由 wiring 还是 transport 切换导致；先落共享 handler 和新入口，可以让“行为收口”和“旧入口退场”分两步观察。
- 默认做法：先把已有 route 逻辑移进一个共享 server handler，新增统一入口（例如 `/api/agent/run`）消费它，再让旧 route 只保留极薄的 forwarder；等新入口经完整回归验证后，再决定是否继续删除旧入口。

### 62. 非聊天 AI surface 并入口前，先冻结 `mode + target + input` envelope

- 结论：当 `comment-reply`、`suggest-edit`、`extract-memory` 这类非聊天 AI surface 要并到同一个 `/api/agent/run` 入口时，不能直接把旧 body 字段拼成一个松散 union；应先冻结 `mode + target + input (+ model)` 这层 envelope，再让 legacy route 在 adapter 层做一次归一。
- 为什么：这些 surface 的共同点只在“都要跑 AI”，不在 payload 形状本身。如果不先把 target identifiers 和 input 内容分层，后续共享 handler 很快就会重新长出 `threadId/documentId/wikiContent/...` 这种随模式漂移的平铺字段，文档、adapter 和 handler 也会一起失焦。
- 默认做法：先在 repo docs 写清每个 mode 的 `target` 和 `input` 契约；共享入口只消费这层标准 envelope，旧 `/api/ai/*` 路由若还存在，只负责把历史平铺字段转换成标准形状，不再维护第二套语义。

### 63. 用消息事件回放交互状态时，必须按“最后事件胜出”处理可逆动作

- 结论：像 comment agent 的 `stop -> 重新 @ 激活` 这种可逆状态，不能把历史 stop 事件当永久 tombstone；derive 必须按时间顺序回放，并让同一对象的最后一次事件决定当前状态。
- 为什么：如果只维护“曾经 stop 过”的集合，后续重新 mention 虽然已经表达了新的用户意图，read side 仍会把该角色过滤掉，表现成 UI 与最新消息历史相互矛盾。
- 默认做法：凡是用 message-level control event 表达状态切换，都要么维护“每个对象的最后事件”映射，要么用可重放 reducer 明确支持 stop / reactivate 循环；同时补一条覆盖“先 stop，再重新激活”的回归场景。

### 64. 折叠并行认知模型前，先逐项盘点用户可见字段和 AI 语义

- 结论：像 `KnowledgeItem + Memory -> Note` 这种看起来概念相近的模型收口，不能只看命名相似就直接合表；要先逐项盘点 `title / category / active / source` 这些用户可见字段和 prompt 语义，再决定 canonical contract。
- 为什么：如果新 contract 先天装不下旧语义，后续迁移就会变成隐性降级，例如 `Context` UI 丢标题、AI prompt 丢 category、来源追踪变模糊。
- 默认做法：先写一页差距 brief，把现有字段、UI 表达和 AI 消费方式列清；只有当新 contract 能无损承接时，才进入 schema / migration 代码。

### 65. 统一认知存储时，先收口 canonical object，再按 `kind` 派生旧表面

- 结论：当 `Knowledge / Memory` 这类平行概念要合并成单一对象时，先统一底层 `Note` contract，再让 UI 和 prompt 继续按 `kind` 派生旧分区，通常比同时重写数据层和用户语言更稳。
- 为什么：如果把存储合并和表面改名绑在同一刀里，回归一旦出问题，很难判断是 schema / migration 还是用户语义退化；保留旧分区作为 derive，可以先消灭双表和双 route，同时避免 `title / category / active` 这些表达能力退化。
- 默认做法：先让 model / object / route / AI context 全部统一读写 canonical object，再用 `kind === 'knowledge'` 等规则派生旧 `Knowledge / Memory` 视图；是否改成单一 `Note` 表面留给后续独立产品切片决定。

### 66. 新 scope 一旦进入 canonical contract，就要尽快接进默认 consumer

- 结论：像 `Note.scope='user'` 这种已经进入 canonical contract 的维度，不应长期只停在 schema 和类型层；至少要尽快接进一条默认 prompt / tool consumer，避免 contract 变成“文档有、运行时没有”的空位。
- 为什么：如果新 scope 只存在于 contract，后续团队会误以为它已经生效，测试和文档也会开始围绕一个并不存在的运行时事实编写；等到真正接线时，反而更难判断哪些地方在偷偷依赖旧的两层上下文。
- 默认做法：当对象 contract 新增 scope 维度后，优先把所有默认 AI consumer 统一挂到同一个 `buildScoped...Targets` helper 上，再用一条回归测试证明新 scope 真的进入了 prompt 和工具摘要。

### 67. 默认 AI 已扩 scope 的认知对象，最近邻 inspect UI 也要同步对齐

- 结论：当 canonical `Note` 这类认知对象已经在默认 AI 读侧扩到 `deliverable + project + user` scope 后，离用户最近的 inspect surface 也应尽快展示同一组 scope，而不是继续只露出其中一层。
- 为什么：如果 prompt 已经在用多层上下文，`Context` 面板却还只显示 deliverable 级数据，用户会失去“AI 此刻到底看到了什么”的可观察性；随后排查 prompt 行为、知识来源和 scope 边界时，就只能重新读代码或抓 debug 输出。
- 默认做法：AI 默认 consumer 一旦扩 scope，就把最近邻的人工 inspect UI 一起接到相同 scope 矩阵上，并用显式 scope badge 或来源标签标清每条认知项来自哪一层；若写侧暂时不跟进，也要明确当前默认写入的 scope。

### 68. 多 scope 认知对象一旦开放手工写入，scope 归属必须在 UI 和 route 两侧同时显式

- 结论：当 `Context` 面板开始允许用户手工创建或编辑 `deliverable + project + user` scope Note 时，不能只靠隐藏的 `scopeId` 规则或默认猜测决定落点；scope 选择、当前归属提示和 route fallback 都要一起做成显式契约。
- 为什么：如果用户只能改标题和内容，却看不到这条知识最终会落到哪一层，`project / user` 这类长效认知就会重新变成黑箱；而 `scope='user'` 又天然不该要求客户端硬编码 actor user id，否则 UI 很快会把实现细节重新泄漏出来。
- 默认做法：composer 默认预选最近邻 scope（通常是当前交付物），同时显示明确的 scope 文案和可切换入口；服务端为 `scope='user'` 提供 actor fallback，客户端只传语义 scope；编辑已有 note 时允许显式迁移 scope，并用完整 iteration 回归同时覆盖 UI 交互和 `/api/notes` 写侧契约。

### 69. 旧 enum 退场时，写侧 API 也要同轮改名成新语义

- 结论：当 legacy enum 已经不再是真相源时，不能只停止写库；command / service / route 的输入 contract 也要同轮改成新语义参数，例如把 `versionType` 改成显式 `recovery`。
- 为什么：如果底层字段不再写，但上层调用链还在继续传 `versionType='checkpoint'` 这类旧心智，façade、tool、staged-change、restore 和 AI writer 仍会围绕过时模型组织，最后形成“存储已收口、调用链却还没收口”的半迁移状态。
- 默认做法：删 legacy 写入的同一刀里，同时 `rg` 所有 writer 和调用方，把输入改成面向新模型的布尔或结构化语义，再用 `rg "versionType"` 和 `npm run verify:iteration` 关门。

### 70. service 巨石剪 façade 时，要同轮把调用方切到 object seam

- 结论：把 CRUD 实现从 `service.ts` 挪到 `objects/*` 还不够；同一轮必须把 route、AI runner、comment 和 tool 调用方的 import 一起切到新 seam。
- 为什么：如果 service 继续保留薄转发，调用方仍会把它当成默认主入口，后续搜索、职责边界和下一刀拆分都不会真正变清晰，结果只是“代码搬家了，但真相源没变”。
- 默认做法：按对象簇成组迁移，例如一次收掉 `conversation + assistant run + workspace lock`；落新模块后立刻改掉所有邻近调用方、删旧 export，再用 `npm run verify:iteration` 关门。

### 71. `getWorkspaceView` 巨石开拆时，先搬走 conversation cluster 往往最稳

- 结论：当 `getWorkspaceView` 同时混着 conversation、version、project 和 status 组装时，第一刀优先抽走 `current/latest conversation`、`conversationTree` 和 `assistant runs` 这簇，通常比先碰 active file 或 deliverable/status 更稳。
- 为什么：conversation cluster 天然已经有 `objects/conversation/view.ts` 和 query seam，可以连同 preview 文本、pending change 计数和 assistant run 选择一起收口；这样既能明显缩短 `service.ts`，又不会同时改动 version/current-file 选择规则。
- 默认做法：先在 `objects/conversation/queries.ts` 新增一个返回 `currentConversation / latestConversation / conversationTree / conversationRuns / activeAssistantRun` 的聚合 query，把 `getWorkspaceView` 退回协调者；等这一刀跑绿后，再继续拆 version/current-file 与 project/status builder。

### 72. 拆聚合型 view 巨石时，第二刀优先抽纯 derive seam，第三刀再抽 surface builder

- 结论：像 `getWorkspaceView` 这种同时夹着查询、选择规则和 UI surface 组装的函数，通常最稳的顺序是：先拆 conversation 聚合查询，再拆 `version/current-file` 这类纯 derive seam，最后再拆 `deliverable/status/project` surface builder。
- 为什么：`version/current-file` 选择只依赖已取回的 `versions / workspaceFiles / activeFileId / requestedFileId`，属于无副作用的纯派生逻辑，最适合作为中间刀；等纯 derive seam 抽干净后，再把 `deliverable / currentStatus / currentProject` 这类面向 UI 的 surface builder 一起下沉，能避免在同一刀里同时改查询边界和状态派生。
- 默认做法：遇到类似隐形巨石时，先按“聚合查询 -> 纯 derive -> UI surface builder”三段顺序切；每一刀结束都跑完整 iteration 门禁，防止后两刀把前一刀的职责边界又揉回 service。

### 73. 多交付物项目的项目树里，当前交付物不能只靠高亮色传达

- 结论：当项目树同时承担“切换兄弟交付物”和“从当前交付物继续创建下一份”的任务时，不能只靠当前行背景高亮来表达焦点；至少要补上显式 `当前` 标识和可见的继续创建动作。
- 为什么：只用高亮时，用户仍然会把左栏理解成一棵中性的 deliverable tree，很难一眼看懂“现在我在哪个交付物上”和“下一份交付物应该从哪里切出去”；尤其同项目里节点一多，继续创建入口若还藏在 hover 菜单里，项目语境会再次退回实现细节。
- 默认做法：在当前交付物行同时给出显式 badge 和稳定可见的“在这里继续新建交付物”入口，再用完整 iteration 回归覆盖当前标识和项目树内创建流，确保同项目创建不会重新退回 header 外的隐式动作。

### 74. 同一个“下一份交付物”动作跨 surface 出现时，必须统一产品语义而不是沿用结构词

- 结论：当“从当前交付物继续下一份”同时出现在标题栏、完成态卡片和项目树时，用户可见文案必须共享同一套产品语义；不能一个地方叫 `next`，另一个地方叫 `sibling`，第三个地方再叫“在这里新建”。
- 为什么：这些入口实际上都在触发同一件事，只是落点上下文不同；如果表面上混用结构词和动作词，用户会误以为它们是不同能力，甚至把“同级”理解成文件系统结构，而不是当前项目里的自然派生下一步。
- 默认做法：先确定一个主动作名作为 canonical 叙事，比如“继续下一份交付物”；其他 surface 只允许做上下文压缩，如项目树里改成“从这里继续下一份”，但不能重新引入 `sibling` 这类实现词。回归里同时断言新主文案存在，旧结构词退出用户表面。

### 75. 运行时安全治理必须同轮引入编译期门禁，否则旧写法会立刻回流

- 结论：当项目开始统一 `ErrorBoundary / safeJsonParse / api client / route wrapper` 这类运行时安全层时，必须在同一轮把 `JSON.parse`、裸 `fetch`、裸 route handler 的 ESLint 门禁一起落下。
- 为什么：如果只改一批调用方而没有编译期约束，后续任何新功能都很容易继续写回局部 `try/catch + JSON.parse`、分散 `fetch` 或直接 `export async function GET()`；这样“安全层”会退化成一次性的清理，而不是稳定边界。
- 默认做法：先提供共享能力，再把 feature 调用链迁移过去，最后用 lint 明确封门；允许的裸 `fetch` 和裸解析例外要写进 repo 合约，而不是留在口头约定里。

### 76. 首屏即发起的读请求，E2E 必须先挂响应等待器再触发导航

- 结论：像首页这种一进入就会立刻请求 `/api/project-list` 的页面，Playwright 不能先 `page.goto()` 再 `waitForResponse()`。
- 为什么：在文件级或全量回归下，首个请求经常会在监听器注册前就返回，功能本身是好的，测试却会因为等不到已发生的响应而假红。
- 默认做法：对这类场景统一写成 `Promise.all([page.waitForResponse(...), page.goto(...)])`；凡是“导航后立即自发请求”的入口都按同一模式验收。

### 77. 跨 workspace 的继续流验收，必须等 `workspaceId + conversationId` 一起稳定

- 结论：像“继续下一份交付物”这种会同时新建 workspace 和 conversation 的动作，E2E 不能只轮询 pathname 变了或 id 不等于旧值。
- 为什么：路由切换早期会出现中间态；如果过早读取 URL，就会把真实成功的项目继承流程误判成“project 关联丢失”。
- 默认做法：为这类用例提供统一 helper，等待 `/workspace/:workspaceId?conversationId=:conversationId` 两个事实同时稳定后，再断言项目继承和后续 UI。

### 78. 浏览器驱动搜索应落在现有 `SearchProvider` seam，而不是再开第二条研究控制栈

- 结论：当 browser operator 成为运行时搜索能力的第一位消费者时，最稳的做法是把它实现成 `SearchProvider.mode='browser'` 的 provider，而不是在 chat / research 层另起一套路由、设置项和返回格式。
- 为什么：如果浏览器搜索绕开现有搜索 provider contract，provider 选择、endpoint 配置、结果标准化和后续 blackbox 复用都会再次分叉；同一个 repo 很快就会同时背 `API 搜索` 和 `browser 搜索` 两条平行入口。
- 默认做法：浏览器搜索统一进入现有 `SearchProvider.search()` / `/api/search/query` seam；provider catalog 明确区分 `api | browser` mode，只有 API provider 需要 key，browser provider 只要求 endpoint 与 adapter。

### 79. 浏览器提取的第一条门禁，先用确定性本地搜索面，再兼容通用结果 DOM

- 结论：browser operator 的第一条回归不要直接绑真实外部搜索站点；应先用本地稳定搜索面关住闭环，同时让 adapter 兼容通用 result-card DOM 结构。
- 为什么：真实搜索站点会漂移、限流，也会把门禁质量绑到外部页面；如果第一条回归就依赖它，browser operator 能力还没成熟，测试就会先变成噪音源。
- 默认做法：先提供带稳定 data attribute 的本地 `/debug/...` 搜索面做确定性验收，再让 adapter 额外支持常见 `.result / .result__a / .result__snippet / .result__url` 这类通用结构。

### 80. 新建 web 交付物的默认 scaffold 不能依赖外部 CDN 才能看到首屏

- 结论：只要 `web` 交付物一创建就会自动进入结果壳和 preview，默认 scaffold 就必须在离线或受限网络里也能直接渲染出首屏内容。
- 为什么：如果默认 scaffold 依赖外部 CDN 包（例如浏览器端临时拉 React/htm），结果壳会显示“预览已启动”，用户看到的却是空白 iframe；一旦再点“实现”视图，就只会暴露出原始 JSX/依赖导入，直接打断黑盒创作心智。
- 默认做法：新建 web 交付物默认使用本地可直接运行的静态 HTML/CSS scaffold；任何需要联网依赖或额外构建链的实现，都只能作为后续显式升级，而不是创建后的第一屏事实。

### 81. 工作区侧栏不能继承首页的折叠记忆，把项目树和支持资料一起藏掉

- 结论：首页/全局项目列表的 sidebar 折叠状态，不能直接复用到工作区侧栏；工作区需要独立记忆，至少保证项目树和支持资料入口默认可见。
- 为什么：首页折叠态主要服务全局导航；如果它直接泄漏到工作区，用户进入交付物后看到的只会是全局项目图标，以为系统根本没有“项目树 + 支持资料”这一层工作区结构。
- 默认做法：全局侧栏和工作区侧栏分开持久化折叠状态；工作区默认优先展开，让支持资料、新建资料入口和项目树成为进入工作区后的第一层可达事实。

### 82. 文档划线评论入口要优先相信浏览器原生选区，而不是只等编辑器内部 selection 时序

- 结论：富文本文档里“拖选正文 -> 弹出评论按钮”这一步，必须优先基于浏览器原生 DOM selection 计算浮层，而不能完全绑定某个编辑器内部的瞬时 selection state。
- 为什么：用户肉眼已经看到选区，但编辑器内部 selection hook 可能还没稳定回流；如果评论入口只认内部时序，就会出现“选区存在、按钮不出现”的假死体验，黑盒验收会直接判定评论闭环不可用。
- 默认做法：浮动评论触发优先读取原生 `window.getSelection()` 和 DOM range rect，再把结构化锚点回填到编辑器语义层；门禁必须覆盖“拖选正文后出现浮动评论按钮并成功创建 anchored thread”。

### 83. 预览桥接页必须显式固定 base URL，不要指望 iframe 根路径自动帮你解析相对资源

- 结论：通过 preview bridge 代理 HTML 时，只要页面里还会引用 `./styles.css`、`./main.js` 这类相对资源，就必须在桥接后的 HTML 里显式注入稳定 `base href`。
- 为什么：很多框架/路由会把 `/preview/bridge/<runId>/` 规范化成不带尾斜杠的文档 URL；这时相对资源会错误地回退到 `/preview/bridge/styles.css` 之类的错误路径，页面看起来“勉强有内容”，样式和脚本却继续 404。
- 默认做法：preview bridge 在注入跨窗口脚本时，同时注入指向当前 run 根目录的 `base href`；相关门禁至少要覆盖一个带相对 `styles.css` 的静态页面，确认 iframe 内资源不会掉 runId。

### 84. 预览启动后的立即 reload，恢复窗口不能长时间停在占位态

- 结论：`Start Preview` 触发后如果用户或 E2E 立即 reload，结果面必须尽快回到 preview recovery，而不是继续在“启动中”占位里等一个秒级延迟。
- 为什么：preview start 请求本来就带 `keepalive`，但首轮页面重载时，`runs` 拉取和 workspace hydration 可能比预期更慢；如果恢复控制器还额外等待 1 秒以上才补启动，bridge iframe 会迟迟挂不上，黑盒看来就是预览没起来。
- 默认做法：pending preview recovery 在 workspace ready 后立即轮询 `runs`，并只保留极短的补启动 grace window；门禁至少覆盖一次“点击启动预览后立刻 reload”的路径。

### 85. 切换 branch head 后，版本树里的“当前分支”标记不能只等服务端回刷

- 结论：只要用户在版本树里执行了 `Switch to Branch`，分支总览和里程碑列表里的 `Current Branch` / `当前分支` 标记就必须立即切到目标 branch head。
- 为什么：路由切换、conversation 切换和 versions 重新拉取之间天然会有短暂空窗；如果 UI 只看服务端下一拍返回的 `currentDraftBaseVersionId`，用户会看到切换动作已经生效，但版本树还是挂着旧分支标签，门禁也会间歇性假红。
- 默认做法：这类“当前作用分支/当前工作上下文”标记要有本地 optimistic state，先把动作结果反映到结构导航，再等权威数据追平。

### 86. 汇报“报告是否修完”时，必须先拆开门禁 closure 和逐条 closure

- 结论：当用户拿着一份测试报告追问“是不是都修完了”时，回复必须先拆成两层：`门禁 / 主链路是否恢复`，以及 `报告里的每一条批注是否都做了独立修复`。
- 为什么：这两件事经常相关，但绝不是同一件事；如果把“主链路恢复并且门禁通过”直接说成“整份报告都修完了”，用户会合理地理解成每一条批注都已经逐条 closure，沟通会立即失真。
- 默认做法：先给边界结论，再给条目对照；默认使用 `已明确修复并验证 / 被其他修复连带覆盖 / 尚未处理` 三种状态，不再用模糊的“都好了”代替真实 closure 范围。

### 87. 新建交付物如果会自动起草，手动入口必须在排队窗口里立即让位给进度反馈

- 结论：创建完成后如果系统会自动触发第一稿，就不能让“生成第一稿”按钮在落地页短暂闪现或继续可点；首屏应该直接进入“已排队 / 正在生成”的状态。
- 为什么：用户刚完成创建就已经把“开始生成”这个意图提交过了；如果落地后又看到同名手动按钮，会误以为前一步没有生效，产生二次点击、重复请求和流程理解混乱。
- 默认做法：把自动起稿视作创建流的最后一步，落地页通过 query/state 立刻进入 queued 态，并同步隐藏手动 CTA，直到首次结果或失败反馈出现。

### 88. 极模糊的创建目标，必须先卡在意图澄清层，不要直接兜底生成模板

- 结论：像“帮我弄个东西”“做个网页看看”这类低信息密度目标，不该直接落到通用 scaffold；系统应该先追问交付物类型、受众和预期结果。
- 为什么：这类输入缺的是任务约束，不是语言润色；如果直接生成，看起来像“能干活”，实质上是在用默认模板掩盖理解缺口，后续返工成本更高。
- 默认做法：创建流先做轻量 goal specificity 判断；一旦命中极模糊表达，就在提交前内联弹出 clarify 卡片，最少补齐“做什么 / 给谁 / 达成什么”三类信息。

### 89. 多交付物导航里，标题、类型和切换入口要在同一视线层同时成立

- 结论：当项目下同时有 document / web / slides 等多个交付物时，不能只靠截断标题区分；当前交付物类型、可切换入口和列表项类型标记必须一起可见。
- 为什么：用户真正需要的是“我现在在哪个交付物”和“我能立刻切到哪个交付物”；如果只给一串相似截断标题，就算 technically 可切换，认知上也等于不可用。
- 默认做法：标题栏把当前交付物类型 badge 和快速切换触发器放在第一扫描线，项目树和切换菜单里的每个交付物都带稳定类型图标/标签，而不是只显示被截断的标题。

### 90. 对象模型切换后的用户文案，要先做一刀纯表面收口，不要和内部命名重构绑死

- 结论：当产品心智从 `deliverable` 切到 `project + node / content` 时，应该先把用户可见 copy 全部收口，再单独处理内部 key、类型名和兼容层的历史命名。
- 为什么：用户感知到的是首页、工作区、上下文面板和按钮上的词；如果把表面文案修正和 schema / API / 变量重命名绑在一刀里，本来可以快速清零的心智噪音会被大范围内部改名拖成高风险重构。
- 默认做法：先限定在 `src/lib/i18n/copy.ts` 和可见断言上完成术语替换，明确“不动内部契约”；等 UI 语言和全量门禁稳定后，再把内部历史命名清理作为独立切片处理。

### 91. 首页一旦已有项目，中央区就该切成项目卡片墙，不要继续让空态 Hero 占主画面

- 结论：Home 里只要已经存在项目，中央区域就应该优先展示项目卡片、最近活跃内容和继续动作；空态 Hero 只留给第一次进入系统或还没有项目的时候。
- 为什么：已有项目用户的首要任务是“回到哪个项目、接着做什么”；如果中央区还在重复空态宣言，真正的项目入口就会被迫退到侧栏，首页会失去 project-scoped workspace 的主导航意义。
- 默认做法：Hero 收成单行说明，项目卡片成为主画面；每张卡片至少同时给出项目名、最近活跃内容、相对时间和继续动作，并统一走 canonical route。

## 技术踩坑记录

### 1. 富文本文档上做全文替换，可靠性远低于看起来

- 现象：重复句子、空白差异、plate JSON 序列化差异都会让“应用到原文”出现误命中或完全找不到。
- 教训：只要底层不是稳定 plain text，就不能把全文文本替换当成主路径。

### 2. 把当前 URL 的 `versionId` 偷当聊天上下文，会破坏对话切换语义

- 现象：chat runtime 如果偷偷读当前 URL 里的 `versionId`，新旧对话会共享错误上下文，甚至把当前表面清空。
- 教训：会话上下文必须从 conversation 自己的数据拿，不能临时借用页面表面状态。

### 3. 轮询时重灌整块内容，会制造闪屏和“内容被吞掉”的错觉

- 现象：生成中如果每次轮询都整体替换编辑器内容，用户会看到闪烁和跳动。
- 教训：轮询更新必须尽量保持引用稳定，内容没变就不要重灌。

### 4. 没有隔离 app-data-root 的自动回归，本质上不可信

- 现象：脚本直接写仓库根目录 `dev.db` 时，测试数据和真实开发数据会互相污染。
- 教训：只要是要反复运行的自动门禁，就必须默认隔离数据根目录和失败产物目录。

### 5. 评论 mention 交互不要在 Textarea 里追求“伪富文本”

- 现象：如果试图在普通 Textarea 里模拟 contentEditable 式 token、内联高亮和复杂光标锚定，工程复杂度会迅速失控。
- 教训：评论 mention 的最小闭环是“监听 `@`、弹出角色列表、插入纯文本 handle、提交时正则解析”；先把语义跑通，再谈更重的编辑体验。

### 6. 异步分支型创建流的 E2E，必须等待稳定分支表面再继续

- 结论：当创建流提交后可能直接创建，也可能进入结构化追问卡片，E2E 不能再假设主提交按钮会一直留在原位。
- 为什么：异步意图判定会让页面在“提交按钮 / clarify 卡片 / 创建完成跳转”之间切换；如果测试只盯着旧按钮或即时 click，门禁会出现大量假红。
- 默认做法：这类用例优先等待 `goal-intent-clarify` 或最终结果壳等稳定 test id，再执行后续选择和断言；不要把“提交动作已触发”误当成“页面已经进入最终交互态”。

### 7. ReadableStream 的 heartbeat、cancel 和 close 必须共用幂等 teardown

- 结论：只要流式响应里同时存在 heartbeat、增量文本和用户取消，就必须把 `enqueue / close / error / abort` 收口到同一套幂等 teardown 里。
- 为什么：浏览器取消、agent abort 和 controller close 会在不同 tick 发生；如果每条路径都自己判断一遍 `isClosed`，仍然会留下“controller 已关闭但 heartbeat 还在 enqueue”的竞态，最终把 dev server 日志打爆。
- 默认做法：维护单一 settled 标记和统一 cleanup 函数，所有 heartbeat、delta enqueue、error、cancel 都只走 `settleStream()`；回归里至少盯一次是否还出现 `Controller is already closed` 这类 teardown 竞态。

### 8. 大范围对象模型迁移，先抽中性 facade，再切路由和会话语义

- 结论：从 `deliverable/document` 迁到 `project + node` 这类对象模型重构时，第一刀不要直接改路由、会话和 prompt；先抽一个中性 façade，把现有读取链路全部收口过去。
- 为什么：如果项目级 context、tool 读取和对象查询还散落在旧术语实现里，后续再加 `projectId / focusNodeId` 会被多点耦合拖慢，还会让历史命名继续回流到新公共契约。
- 默认做法：先建类似 `src/lib/workspace/node.ts` 的新边界，让旧 tool 只保留临时 alias 角色并标明删除时点；后续 schema、route、runtime 和 UI 都只继续挂新 façade。

### 9. 会话身份重构时，先双写新字段，再切读路径，不要一刀清空 legacy

- 结论：从 `wikiId / documentId` 迁到 `projectId / focusNodeId` 这类会话身份重构，第一刀应该先把新字段双写到 schema、create path 和 view/type 映射里，再切查询和路由。
- 为什么：如果 UI、branching、conversation recovery 和旧 API 还在读 legacy 字段时就直接把它们置空，回归面会一次性炸到工作区、预览和对话恢复整条链路，定位成本远高于收益。
- 默认做法：先完成 migration、dual-write、类型透出和全量门禁；确认新字段在所有入口都稳定落账后，再把 read path 切到新字段权威，并显式保留只读兼容窗口。

### 10. 项目级会话读路径翻转时，不能只把 where 从 wikiId 改成 projectId

- 结论：把 conversation tree / current conversation 切到 project scope 时，查询条件必须同时覆盖 `projectId` 新会话和“`projectId` 为空但 `wikiId` 属于同项目”的 legacy 会话。
- 为什么：历史会话不会自动带上 `projectId`；如果只把查询从 `wikiId = currentNode` 粗暴替换成 `projectId = currentProject`，旧项目会话会瞬间从树里消失，看起来像数据丢失，实际只是读路径没兼容。
- 默认做法：先解析当前 scope 对应的整组 project node ids，再用 `projectId = currentProject OR (projectId IS NULL AND wikiId IN nodeIds)` 收口读取；等 legacy backfill 或兼容窗口结束后，再删除第二支。

### 11. 稳定 path identity 和 query-driven focus 一旦拆开，所有入口和测试都必须共用同一套路由语义

- 结论：当工作区路由从 `/workspace/{nodeId}` 切到 `/workspace/{projectId}?node={nodeId}` 后，path 只代表 Project identity，当前 Node focus 只能从 query 读取；任何入口继续手拼旧路径，都会把旧心智偷偷带回来。
- 为什么：页面层虽然可以做 canonicalization 兜底，但用户会看到 URL 闪跳，E2E 也会继续把 pathname 当成当前内容 id，导致“切换成功但断言失败”的假红。
- 默认做法：前端入口统一走 `buildWorkspaceRoute(...)`，E2E helper 同时返回 `projectId` 和 `workspaceId/nodeId`，不要再把 pathname 直接当 active content identity。

### 12. draggable 的树节点里只要放二级操作按钮，就必须显式退出拖拽语义

- 结论：项目树这类可拖拽容器里，如果同一行还有“继续下一份”“更多操作”之类的二级按钮，按钮本身必须显式 `draggable={false}`，并拦住 `pointerdown / dragstart`。
- 为什么：父级 row 的 drag 语义会吞掉子按钮 click，用户看到的是按钮可见但弹窗不出来；E2E 里则会表现成“点击成功但页面没有任何后续状态变化”的假死。
- 默认做法：所有嵌在 draggable row 里的次级按钮默认关闭 drag，并在组件层做事件隔离，不把这件事留给测试层 `force click` 或重试兜底。

### 13. runtime prompt 迁移到新对象模型时，tool registry 和 prompt 术语必须同一刀收口

- 结论：当系统从 `deliverable` 迁到 `project + node` 这类新对象模型时，不能只改 tool 实现或只改 prompt 文案；tool registry、system prompt、debug context 和回归断言必须在同一切片一起切过去。
- 为什么：如果 prompt 还在提旧工具名，agent 会继续强化过时心智；如果只换了 prompt、tool registry 还暴露旧名字，运行时又会出现“文案说一套、工具叫另一套”的自相矛盾。
- 默认做法：对象模型迁移时，把运行时 prompt 文案、tool 注册名、workspace context 输出和测试断言视为同一个 contract surface；旧名字只允许作为带删除时点的临时 alias 存在。

### 14. 项目级聊天只要允许切换当前内容，就必须把 focusNodeId 记在每条消息上

- 结论：项目级 conversation 里，`Session.projectId` 只能表达容器归属；真正决定一条消息针对哪个内容单元的，必须是消息级别的 `focusNodeId`。
- 为什么：用户在同一个项目里切换 node 后继续聊天是常态；如果只依赖 session 或当前路由恢复焦点，历史消息一旦回放、分支或跨 node 引用，就无法判断当时到底针对哪个 node 发出的指令。
- 默认做法：所有新的 chat message 创建路径默认写入当前 `focusNodeId`；legacy `documentId/workspaceId` 只保留兼容镜像，不再作为权威焦点来源。

### 15. 项目级 AI 默认上下文必须把“当前 node 深注入”和“sibling 摘要”拆成两层预算

- 结论：Project 级 chat 不能把整个项目的 node 列表和正文一起塞进默认 prompt；默认上下文必须只深注入当前 focus node，再给少量 sibling 摘要，其余内容按需读取。
- 为什么：一旦 sibling 数量增长，直接把全量 node 标题或正文塞进 prompt 会迅速失控；但如果只保留标题，agent 又不知道当前 node 正文与最近 sibling 的差异，跨 node 复用会退化成瞎猜。
- 默认做法：默认 prompt 固定成“当前 node 正文 + top-k 最近 sibling 摘要 + omitted count 提示”；需要复用其他 node 正文时，统一转到显式读取工具，不再隐式扩大默认上下文窗口。

### 16. 跨项目 mount 的默认上下文只能给标题索引，正文必须继续走同一套 node 读取工具

- 结论：Project 间 mount 打通后，默认 prompt 里只应暴露 mounted project 的 node 标题索引；一旦需要正文，必须继续走同一个 `read_node_content` 边界，而不是为 mount 长出第二套“跨项目读取”工具。
- 为什么：如果 Layer 3 默认把 mounted project 正文也塞进来，context budget 会立刻被外部项目拖爆；如果再额外做一套 mount 专用读取工具，runtime prompt、tool registry 和权限语义又会重新分叉。
- 默认做法：Layer 3 只保留 `projectId + node title/nodeId` 级别索引，mounted project 正文统一要求显式传 `projectId + nodeId` 调 `read_node_content`；UI 和 agent prompt 只围绕这一条读取路径扩展。

### 17. 跨项目能力第一次落 UI 时，入口必须挂在当前项目语境里，并继续走 canonical route

- 结论：像 mount 这种跨项目能力，第一版可用 UI 不应只停在 backend route，也不该躲到 AI/debug 面板里；它必须挂在当前项目的主工作区表面，并且跨项目打开仍然要带完整 `projectId + nodeId`。
- 为什么：如果用户只能通过 API 或隐式 runtime 才知道 mount 存在，能力等于不可用；如果跨项目点击还复用“同项目切 node”的路由 helper，就会把目标 node 错推到当前 project path 下，表面上跳转成功，实际 identity 已经错了。
- 默认做法：第一版 UI 至少包含“当前项目已挂载列表 + 显式新增入口 + 直接打开目标项目”三个动作；所有跨项目跳转统一回到 `buildWorkspaceRoute({ projectId, nodeId })`，不要复用只适合同项目 focus 切换的 shortcut。

### 18. 当前项目内的 Node 搜索，应该是局部 workspace 能力，不要做成全局命令面板

- 结论：Project 级 workspace 里的 Node 搜索，入口应挂在当前项目的 sidebar / workspace shell 里，并默认只搜索当前项目；不要第一版就做成跨项目的全局 command palette。
- 为什么：全局 palette 会把“一个 Project = 一个 workspace”的边界重新打散，用户会把它理解成 IDE 式命令跳转，而不是当前项目里的内容定位；同时也会模糊 canonical route 的 `projectId + nodeId` 语义。
- 默认做法：搜索入口放在当前项目目录附近，结果点击统一走 `buildWorkspaceRoute({ projectId, nodeId })`；默认只搜当前 project，需要外部内容时再显式进入关联项目或 mounted project 读取链路。

### 19. 带状态的 overlay 回归里，Playwright 应该等稳定表面再点动作，并用用户可见标记收敛

- 结论：像版本树这种会在打开时同步刷新摘要卡、分支动作和当前状态徽标的 overlay，Playwright 不该直接“打开后立刻点按钮”；必须先等 overlay 自己稳定，再触发动作，并用用户可见结果收敛。
- 为什么：branch overview / compare / switch 这类卡片在全量套件里经常会经历二次渲染；如果测试在第一帧就抓按钮或继续盯内部临时标记，最终会出现“单跑绿、全跑红”的抖动，噪音会盖住真正的产品回归。
- 默认做法：对这类状态化 overlay，先用 `expect(...).toPass()` 等核心卡片和最小数量稳定出现，再用 `force click` 触发动作，最后优先断言 `Current Branch`、对话切换、compare dialog 这类用户可见结果，不要把 `version-draft-base-*` 之类内部中间标记当主验收。

### 20. 编辑器内联选区型 UI，不能假设 DOM selection 和 editor selection 会同帧同步

- 结论：像文档划线评论这种依赖文本选区的 inline trigger，不能只在第一次 `selectionchange` 或下一帧里读一次 editor selection；必须容忍 DOM selection 和编辑器内部 selection 错一拍。
- 为什么：浏览器原生 selection 往往先落地，富文本编辑器的 `editor.selection` 会在后一个 tick 才同步；如果 UI 只信单次读取，就会出现用户已经选中文本，但评论入口完全不出现的假死。
- 默认做法：选区型 affordance 先读 DOM selection，再安排一次短延迟重读作为兜底；清理逻辑里同步撤销前一个 `requestAnimationFrame` 和 timeout，避免旧选区回写覆盖新状态。

### 21. 滚动容器里的操作按钮，只“可见”还不够，触发前要把可点击区域滚进视口中心

- 结论：像版本树 branch overview 这种在滚动容器里的卡片操作，E2E 不能把 locator `visible` 当成“已经可点击”；按钮可能 still render 出来了，但实际仍在滚动口外。
- 为什么：Playwright 会对超出 actionable viewport 的元素直接报 `Element is outside of the viewport`；这类问题通常不是产品逻辑错，而是测试和真实用户一样，需要先把卡片滚到稳定可操作位置。
- 默认做法：对滚动容器里的次级动作，先对 row/card 做 `scrollIntoView({ block: 'center' })`，再对目标按钮补一次 `scrollIntoViewIfNeeded()` 后点击，不要只盯按钮本身的 `visible` 状态。

### 22. 会话身份切到 project 级后，消息焦点写入和 active file 生命周期也必须一起脱离 `wikiId`

- 结论：只把 `Session.projectId` / `ChatMessage.focusNodeId` 加进 schema 还不够；只要项目级会话已经共享到多个 Node，`activeFileId` 的维护逻辑也必须同步脱离 `wikiId` 粗匹配。
- 为什么：如果 message create path 已经写 `focusNodeId`，但文件新增、删除或 draft 替换还继续按 `wikiId` 更新 session，就会出现“焦点语义是 project 级，active file 生命周期还是 node 级”的双轨状态，删文件或换文件时尤其容易误伤 shared conversation。
- 默认做法：项目级会话迁移时，把 `focusNodeId` 权威写入、`activeFileId` 更新 seam 和 raw-field 回归断言视为同一刀 contract；一旦 session identity 提升到 project，文件生命周期更新就不再允许只按 `wikiId` 选会话。

### 23. Project-scoped conversation 下删除单个 Node，必须按 node-bound artifact 删，而不是按 session 粗删

- 结论：当一个 project-scoped conversation 已经被多个 Node 共享时，删除其中一个 Node 不能继续沿用“删 workspace = 删它的 session”这套旧逻辑。
- 为什么：共享会话下，`sessionId` 已经代表整个项目会话容器；如果删单个 Node 时仍按 `sessionId` 级联删消息、runs 或附件，会把同项目其他 Node 还在使用的 conversation 一起抹掉。真正应该跟着 Node 删的是 `documentId=workspaceId` 的 node-bound artifacts，以及极少数 legacy workspace-scoped session。
- 默认做法：workspace delete 先判断项目里是否还有其他 Node；若有，则保留 `projectId` 绑定的 shared conversation，只删 node-scoped session 和 `documentId` 命中的 artifact，并让 conversation workspace recovery 回退到同项目仍存在的 Node。

### 24. 首次使用黑盒场景的目标句必须显式给出结果形态，不能用抽象占位文案

- 结论：像 A1 这种要验证“首页直接进 workspace”的 blackbox 场景，目标句必须直接说清输出形态，例如“写一份报告 / 页面 / brief”；不要用“黑盒项目 123”这类抽象占位词。
- 为什么：成形会先判断最合适的结果形态。若场景目标本身是模糊占位文案，系统会正确进入 intent/clarify 分支，黑盒 runner 看到的就不是“创建直达 workspace”，而是“等待结果形态判断”，最后把错误场景当成产品回归。
- 默认做法：首次使用类 blackbox scenario 一律使用带明确产出词的真实目标句，并让场景命名与目标语义一一对应；若要测 clarify flow，就单开 A3 之类的歧义场景，不与直达创建场景混用。

### 25. 首次使用黑盒矩阵必须按场景重置 app-data，不能整次命令只清一次

- 结论：A1-A3 这类都要求“从空白状态首次进入”的黑盒场景，runner 不能只在命令开始前清一次数据库；必须在每个场景前单独重置隔离 app-data。
- 为什么：如果 A1 先创建了项目，后面的 A2/A3 就不再是首次使用路径，首页空态、目标输入和追问分支都会被历史数据污染，最后把场景自身失真误判成产品回归。
- 默认做法：黑盒 runner 统一保留共享 artifact 根目录，但在每个场景前重置 `.tmp/blackbox-acceptance/app-data/` 和对应 db；首次使用矩阵一律不共享状态。

### 26. 黑盒 evaluator 应该盯稳定产品信号，不要把瞬时加载文案当主验收

- 结论：像 web 首次创建这类黑盒场景，evaluator 不该把“AI 正在启动第一版 live draft”之类瞬时文案当核心断言；应改看稳定结果面，如 route、canvas、preview bridge iframe。
- 为什么：加载提示文本最容易因为 copy 调整、异步时序或重试窗口变化而抖动，但用户真正关心的是“有没有进入 workspace”“预览有没有起来”。盯错信号会让黑盒场景红在文案抖动，而不是红在产品结果面。
- 默认做法：场景验收优先使用 URL、稳定 `data-testid`、核心 iframe/canvas 和持久状态胶囊这类 durable signal；临时 loading copy 只作为辅助日志，不做主门禁。

### 27. `toPass + force click` 包裹 dialog 触发器时，容易把自己打开的弹窗点关

- 结论：对会打开 Radix dialog / overlay 的按钮，Playwright 不要用 `expect(...).toPass()` 反复 `force click` 作为等待手段；这会制造假阴性。
- 为什么：第一次点击已经把 dialog 打开后，重试里的第二次 `force click` 会继续打到被覆盖的底层按钮，既可能触发 outside interaction，也可能把本来已开的弹窗状态打乱。最后失败看起来像“弹窗没起来”，实际是测试自己把它点关了。
- 默认做法：这类交互先等触发按钮可见，再单次点击，然后用 dialog 的可见文本或表单字段显式等待；不要把“重试点击”当 overlay 稳定化手段。

### 28. 黑盒 seed 的项目根目录必须从当前 `DAO_APP_DATA_ROOT` 推导

- 结论：blackbox seed 不能复用 iteration helper 里的固定 projects 根目录；项目根目录必须从本次运行的 `DAO_APP_DATA_ROOT` 动态推导。
- 为什么：如果 blackbox seed 还把 `Document.projectRootPath` 写到 `.tmp/iteration-regression/projects`，场景虽然跑在 `.tmp/blackbox-acceptance/`，真实工作区文件却会落到另一套根目录，后续草稿读取、mirror、project tree 和 artifact 判断都会被跨根目录污染。
- 默认做法：blackbox runner / seed 一律从 active `DAO_APP_DATA_ROOT` 派生 `projects/` 根目录；验收 consumer 禁止直接复用 iteration root helper。

### 29. `DAO_E2E` 草稿 fallback 要覆盖至少一个 workspace polling 窗口

- 结论：E2E/blackbox 模式下，assistant fallback 在把草稿写入数据库后不能立刻结束；至少要多保留一个 workspace polling 窗口。
- 为什么：workspace surface 不是逐 token 订阅数据库，而是按节奏轮询 runs / workspace state。若 fallback 写完就立刻结束，前端可能完全错过这次更新，最后表现成“AI 明明成功了，但草稿没变”，把时序问题误判成产品回归。
- 默认做法：`DAO_E2E` fallback 在开始前保留短启动延迟，写完草稿后再额外等待一个 polling window，再结束 run；黑盒验收优先保证状态可观测，而不是追求最短 mock 时长。

### 30. 程序化 editor load/reset 不能回灌 autosave

- 结论：编辑器收到服务端内容、切换文件或 reset 初始值时，不能把这类 programmatic load 当成用户输入继续喂给 autosave。
- 为什么：如果 mount/reset 也触发 autosave，请求会把刚从服务端拿到的新草稿再按旧内容 PATCH 回去，形成“服务端已更新，客户端又回滚”的竞态；黑盒里会表现成 AI 改稿成功后正文又跳回旧版本。
- 默认做法：editor wrapper 持有最近一次程序化加载的序列化内容，只在用户真实编辑后、且内容与最近 loaded snapshot 不同时才触发 autosave。

### 31. `scope=all` 的客户端集合不能被当前路由的子集 props 回写覆盖

- 结论：像版本树这类需要展示整个 workspace/project 可见集合的客户端状态，一旦已经通过 `scope=all` 拉全量数据，就不能再被当前 route view 下的 `versions/files` 子集 props 直接整包覆盖。
- 为什么：route 级 props 往往只代表“当前 node / 当前会话 / 当前 branch 看得到的那一段”；如果把它们回写成权威集合，其他 branch head、sibling node 或 mounted item 会在 UI 上凭空消失，造成“总览视图丢分支/丢节点”的假回归。
- 默认做法：全量集合 state 只做按 id merge 或显式 refresh；像 continue/switch-branch 这类会改变局部视图窗口的动作，结束后主动补一次 `scope=all` reload，而不是依赖 route props 反向覆盖本地缓存。

### 32. project canonical route 切换期间，不要暴露会开启本地 overlay 的工作区动作

- 结论：当页面还在把 `/workspace/{nodeId}` 校正到 `/workspace/{projectId}?node={nodeId}` 这种 canonical route 时，像“继续下一份内容”这类会打开本地 dialog/sheet 的动作不能先暴露给用户。
- 为什么：segment 级 `router.replace` 会导致页面 remount；如果用户恰好在校正窗口里点击了 create/comment 之类的本地 overlay 动作，overlay 会在旧页面上短暂打开后立刻被 remount 冲掉，表现成“按钮偶发无响应 / dialog 自己消失”。
- 默认做法：需要本地 UI state 承接的动作只在 route canonical 稳定后显示；同时相关 callback 的依赖项要包含最新的 `conversationId` 等 runtime identity，避免 remount 后继续使用旧闭包。

### 33. 只验证交互语义的 E2E 场景，不要把结果绑到真实 AI 凭证上

- 结论：像评论线程的“绑定角色、继续监听、停止监听”这类场景，如果验收目标是交互语义而不是模型输出，就不应该在回归里真的调用 `/api/agent/run`。
- 为什么：这类用例一旦依赖真实 provider，就会把本机 OAuth / API key 状态引进门禁，结果从“产品行为回归”退化成“环境是否刚好有凭证”的偶现失败。
- 默认做法：在测试里直接 stub `/api/agent/run` 返回稳定文本流，只保留需要验证的 UI 语义；只有明确在验 AI 内容或后端 side-effect 时，才走真实 agent path。

### 34. `toPass` 里的点击如果会触发写操作，必须避免重试时重复提交

- 结论：像版本续写、切 branch 这类会创建新 conversation / 改写 runtime identity 的按钮，不能直接放在 `expect(...).toPass()` 里每轮都点击。
- 为什么：全量门禁下请求稍慢时，第一次点击可能已经成功发出 mutation，但 URL/页面状态还没收敛；`toPass` 下一轮再点一次，就会制造第二次 continue/switch，把原本的等待问题放大成偶现失败。
- 默认做法：带副作用的 Playwright helper 采用“单次触发 + 等待状态收敛”模式；如果需要 retry，只重试观测条件，不重复提交 mutation。

### 35. canonical route 切换窗口里，所有 workspace header 本地动作都要一起 gate

- 结论：`/workspace/{id}` 正在校正到 canonical `?node=` 路由时，不能只 gate“继续下一份内容”这类按钮；header 里的 `评审评论`、`版本树`、`保存里程碑` 等本地动作也必须一起等 route 稳定。
- 为什么：这些动作要么会打开本地 overlay，要么会启动依赖当前 runtime identity 的本地 mutation。若在 `router.replace` remount 窗口里先点击，sheet/dialog 会自己消失，或把测试/用户交互打成偶现无响应。
- 默认做法：workspace page 统一暴露一个 `routeIsCanonical` gate，所有 header-level local actions 都复用这一个条件，而不是按按钮零散兜底。

### 36. project route 已切换但 view 数据未收敛时，不能继续复用旧 node 的派生状态

- 结论：统一工作空间下，只要 URL 已经切到新的 `workspaceId/nodeId`，页面里的 `currentFile`、`currentConversation`、`deliverable files` 等 route-sensitive 派生值就必须先按当前路由做一次匹配 gating；不能直接继续消费上一次 `workspaceView`。
- 为什么：route 先变、view 后到是正常时序。如果新路由还没拿到自己的 view，就继续用旧 node 的 file/conversation 派生值，autosave、header create、review/comment 之类动作会把旧上下文写到新 node 上，表现成“切到新内容后还带着上一份文件/对话状态”。
- 默认做法：先构造 `routeWorkspaceView = workspaceView?.workspace?.id === workspaceId ? workspaceView : null` 这类 route-matched view，再由它统一推导 `currentFile/currentConversation/supportFiles/stagedChangeSets` 等所有依赖当前 node 的运行时状态。

## 最新验证状态

- **运行时健壮性验收闭环**：`framework/resilience/`、route error page、全局异常监听、`safeJsonParse` / `api client` / `defineRoute` 与相关产品回归，已在 2026-03-22 通过完整 `npm run verify:iteration` 验证，结果为 `69 passed`。
- **统一工作空间 Step 0.1**：`src/lib/workspace/node.ts` seam、项目级 AI context 和同项目正文读取已在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `69 passed (3.3m)`。
- **统一工作空间 Step 0.2A**：conversation schema/migration 与 create path 已开始双写 `projectId / focusNodeId`，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `69 passed (3.8m)`。
- **统一工作空间 Step 0.2B**：conversation 查询与 workspace recovery 已切到 `projectId` 主路径并兼容 legacy `wikiId` 会话，已在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `69 passed (3.0m)`。
- **统一工作空间 Step 3.1**：workspace page、route controller 和测试 helper 已统一到 `/workspace/{projectId}?node={nodeId}`，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `69 passed (3.3m)`。
- **统一工作空间 Step 3.2**：侧栏 query-route fallback、`目录 / 大纲` 命名和 project tree sibling create 交互已收口，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `70 passed (4.1m)`。
- **统一工作空间 Step 4.1**：同项目新建 Node 已复用 project-scoped conversation，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `70 passed (3.2m)`。
- **统一工作空间 Step 4.3-4.5**：`list_project_nodes / read_node_content`、runtime prompt 术语与 `focusNodeId` 消息落账已端到端收口，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `71 passed (3.2m)`。
- **统一工作空间 Step 4.2**：当前 node 正文深注入、top-5 sibling 摘要与 omitted sibling 门禁已落地，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `72 passed (3.2m)`。
- **统一工作空间 Step 5.1**：`ProjectMount` 数据模型、mounted project title 注入和带 `projectId` 的跨项目 `read_node_content` 已在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `73 passed (3.2m)`。
- **统一工作空间 Step 5.2**：工作区侧栏 `关联项目 / Linked Projects` section、显式新增入口和跨项目 canonical route 打开能力已在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `74 passed (3.3m)`。
- **统一工作空间 Step 6**：Sidebar `项目内定位 / Find in Project`、`/api/search/nodes`、Node Facade 搜索能力与旧 deliverable tool alias 删除已在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `75 passed (3.4m)`。
- **统一工作空间 Step 1**：首页、工作区、上下文面板和辅助入口的用户可见 deliverable 文案已收口为 `content / item / 当前内容 / 项目内容` 等统一工作空间语言，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `75 passed (3.6m)`。
- **统一工作空间 Step 2**：首页中央区域已切到项目卡片墙，card click 与“继续下一项内容”都统一走 canonical route，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `75 passed (3.4m)`。
- **统一工作空间门禁稳定性补丁**：版本树 branch overview compare 点击前的可操作滚动定位，以及文档划线评论 inline trigger 的延迟选区重读都已收口，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `75 passed (3.4m)`。
- **统一工作空间 Step 0 legacy create/write cleanup**：项目级消息已切到 `focusNodeId` 权威写入，`activeFileId` 生命周期更新也已脱离 `wikiId` 粗匹配，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `75 passed (3.4m)`。
- **统一工作空间 Step 0 workspace delete seam cleanup**：删除 sibling Node 时已不再误删 project-scoped shared conversation，conversation workspace recovery 也会回退到同项目仍存在的 Node，并在 2026-03-23 通过完整 `npm run verify:iteration` 验证，结果为 `76 passed (3.4m)`。
- **Browser Operator B3.1**：`tests/blackbox/chengxing/`、`playwright.ai-inspector.config.ts` 与 `npm run test:ai-inspector` 已在 2026-03-23 跑通首条 A1 首次使用黑盒场景，聚合 `report.json` / `report.md` 输出平均分 `4.6`；随后完整 `npm run verify:iteration` 结果见最新记录。
- **Browser Operator B3.2**：`tests/blackbox/chengxing/` 已扩到 A1-A3，`npm run test:ai-inspector` 当前会逐场景重置隔离 app-data，聚合平均分 `4.6`；随后完整 `npm run verify:iteration` 已在 2026-03-23 通过，结果为 `76 passed (3.9m)`。
- **Browser Operator B3.3**：`tests/blackbox/chengxing/` 已扩到 A1-A3 与 B2-B4；blackbox seed 统一从当前 `DAO_APP_DATA_ROOT` 推导项目根目录，`DAO_E2E` fallback 与 editor autosave 竞态也已收口；随后完整 `npm run verify:iteration` 已在 2026-03-23 通过，结果为 `76 passed (3.9m)`。
- **Gate A 结果层修复**：读侧 `parsePlateContent` 对纯 markdown 自动调 `markdownToPlate`，写侧 `upsertLiveDraftFile` 默认 `kind='richtext'` + 自动 markdown→Plate JSON 转换，新建 workspace 文件种子也从 `kind='markdown'` 切到 `kind='richtext'`；已在 2026-03-24 通过完整 `npm run verify:iteration` 验证，结果为 `76 passed (3.4m)`。
- **Gate B 首页语义 + 轻量 UI 收口**：首页卡片主动作改为 `打开/Open`、次动作改为 `新建内容/New Item`，单 node 项目隐藏"最近活跃内容"区块，品牌副标题对比度提升到 `text-foreground/60`，hero badge 改为 pill 样式提升存在感；已在 2026-03-24 通过完整 `npm run verify:iteration` 验证，结果为 `76 passed (3.5m)`。
- **Gate D Canvas Step 1**：集成 tldraw 项目画布骨架，含自定义 NodeCard 形状、debounced 坐标持久化（`Document.canvasMetaJson`）、View 下拉菜单的 `总览/编辑` 切换（`surfaceMode` 状态）、双击 node 跳转编辑面、node-catalog API；已在 2026-03-24 通过完整 `npm run verify:iteration` 验证，结果为 `76 passed (3.7m)`。
- **Gate E1 剩余验收 UI**：版本栏降密度（草稿选择器和比较移进版本树 header，顶栏只保留状态/评论/版本树/保存里程碑），"X 项内容"改为"X 份内容"，首页副标题精简为"目标驱动创作"；已在 2026-03-24 通过完整 `npm run verify:iteration` 验证，结果为 `75/76 passed (3.6m)`，唯一失败为已知偶现的大纲滚动定位 flaky。
- **Gate E2 Canvas Advanced Features**：右键菜单（打开/重命名/连接到…/断开连接/删除 + 空白处新建），`NodeRelation` Prisma model + CRUD API（`/api/workspaces/[projectId]/node-relations`），SVG 依赖线 overlay（dashed arrows + 实时拖拽位置同步），首页列表|画布视图切换（`localStorage` 持久化），`ProjectCanvasLayout` Prisma model + GET/PATCH API，`HomeCanvas` tldraw 全局画布（mount 连线渲染），共享确定性自动布局 `canvas/layout.ts`（≤10 网格 / >10 scaled-columns）；已在 2026-03-24 通过完整 `npm run verify:iteration` 验证，结果为 `75/76 passed (3.4m)`。
- **Regression closure 2026-03-25**：branch overview 的 `scope=all` 版本集合覆盖问题、project canonical route 切换期间的 sibling-create dialog race，以及大纲跳转用例的布局阈值已收口；已在 2026-03-25 通过完整 `npm run verify:iteration` 验证，结果为 `76 passed (4.3m)`。
- **Regression closure 2026-03-25（push gate）**：workspace header 同项目切换已保留 `conversationId`，project route 切换期间的 route-matched view gating 已防止旧 node file/conversation 泄漏到新 node，web preview review tab 与 branch focus clear 两条 Playwright flake 已收口；已在 2026-03-25 通过完整 `npm run verify:iteration` 验证，结果为 `76 passed (3.5m)`。
- **Pitfall：React Hooks 不能定义在条件返回之后**：`ProjectCanvas` 组件中 7 个 `useCallback`/`useEffect`/`useMemo` hooks 定义在 `if (!ready) return <Loading />` 条件返回之后，首次 `ready=false` 时只执行 14 个 hooks，`ready=true` 后执行 21 个，触发 `Rendered more hooks than during the previous render` 崩溃。修复：将所有 hooks 移到条件返回之前。教训：大组件中加 early return 时务必 grep 所有下方的 hook 调用。
