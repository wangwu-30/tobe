# 成形项目状态

更新时间：2026-03-21
状态：终版收口完成，进入严格迭代验收维护
对应规划：[产品落地计划](./chengxing-rollout-plan.md)
经验台账：[经验教训台账](./chengxing-lessons-learned.md)
长期差距评估：[v-next 差距评估](./chengxing-v-next-gap-assessment.md)

## 现状

- 工作区 UI 对外只再使用 `currentStatus / Version / Review / Chat / Context / Workflow` 这套主语义。`workflowSummary` 不再进入页面 props、hook 命名或 UI helper，服务层仅保留内部 alias。
- 首页、设置页和工作区左栏里的“项目”已收成显式 `ProjectSummary` 摘要对象：项目列表现在直接返回 `projectId + representative workspaceId + deliverableCount + latestDeliverableTitle`，不再继续把 `/api/workspaces` 的分组结果假装成项目导航。
- 工作区顶栏现在会把“当前交付物位于哪个项目 / 文件夹”直接放进第一扫描线，并提供显式“新建同级交付物”动作；该入口会直接在当前 `projectId / projectFolderId` 下打开 Goal Composer，不再先绕回全局 starter 或要求用户先选技术类型。若同一项目下已有多个交付物，标题本身也会变成切换器，允许直接切到同项目的另一份当前交付物。
- 创建流已经切到意图驱动：首页和工作区都直接进入 `GoalComposerDialog`，不再暴露 `document / slides / web / code` 选择器；明确网页类目标会直接路由到 web，歧义目标会在创建流内展示结构化追问卡片，而“两者都要”会在同项目下自动创建文档主件和 sibling web。
- AI 的当前交付物对话已开始携带项目级摘要上下文：chat system prompt 与 `get_workspace_context` 都会注入同项目交付物的标题 / 类型 / 状态摘要；chat prompt 还会把 `deliverable + project + user` scope 的 `Note` 一起打进同一条上下文链路，并在 prompt / tool summary 里继续按 `Knowledge / Memory` 双分区输出。当用户提到“参考首页”“跟 FAQ 对齐”这类跨交付物需求时，agent 可以先 `list_project_deliverables`，再 `read_project_deliverable_file` 显式读取同项目兄弟交付物内容，而不必把整个项目内容默认灌进 prompt。
- 评论闭环已固定到 `version + draftRevision` 基点。`CommentThreadData` 现已暴露 `scope / inheritanceState / sourceVersionId / anchorFingerprint`；主列表只显示 `direct(open/applied)` 与 `inherited(actionable)`，`stale / superseded` 收到“更早上下文”。
- 右侧助手栏已收成 `状态 / 评审 / 对话 / 上下文` 四个职责明确的 tab。`状态` 是当前状态、当前 workflow 与下一步动作的唯一主入口；`评审` 只承载线程；`对话` 只承载发送相关阻塞；`上下文` 只承载 `Note` 派生的知识/记忆与 workflow 库，并会显式标出当前 note 来自 `交付物 / 项目 / 用户` 哪一层。
- 认知层持久化已统一收口到 `Note`：`KnowledgeItem / Memory` 旧表和 `/api/{knowledge,memories}` 已删除，`/api/notes` 与 `src/objects/note/*` 成为唯一 canonical seam；当前 `Context` 面板继续按 `note.kind` 派生 `Knowledge / Memory` 两个用户分区，且读写两侧都已经和 AI 一样覆盖 `deliverable + project + user` scope。用户现在可以在面板里显式把知识保存到 `交付物 / 项目 / 用户` 任一层，并在编辑已有知识时迁移 scope；默认新建仍落到当前交付物，而不是再维护两套存储。
- 支持资料树已与项目树复用同一对象操作和 `WorkspaceFile.sortOrder`，支持创建、重命名、删除、移动、拖拽与顺序调整，中心表面、URL 与左栏选中态保持同步。
- `Workflow Playbook V1` 已定稿为 `draft / active / archived` 三态。只有 `active` 进入默认复用、workspace plan 绑定和 chat prompt 注入链路；`archived -> restore` 固定回到 `draft`；draft warning 已升级为激活前 gate。
- 系统级内置 workflow 已并入同一套 playbook 轨道，而不是另做单独向导：当前至少内置了“需求规格到网页上线”和“成形类产品市场分析报告”两套模板；它们会直接出现在 Goal Composer 与 Context 里，创建/应用时会落入现有 workflow 绑定链路，并把后续 `tools / MCP / skills` 扩展继续收在同一个方法层入口上。workflow 现在会把开放扩展提示作为正式字段持久化到 playbook 本身，自定义 workflow 在保存、复制、刷新、激活和 plan/chat 注入后都能继续带出同一组 `Tools / MCP / Skills` 提示，避免把未来生态能力埋在纯文本备注里或只对内置模板生效。
- 产品层 `snapshot` 语义已退出主表面：`/api/workspaces/[workspaceId]/snapshots` 已删除，工作区、评论、对话、预览、chat、runs 主路径不再接受 `snapshotId / baseSnapshotId / previewSnapshotId` 等外露参数。
- 已完成一轮 packaged QA 缺陷修补：无 workflow 创建提示已改成说明态，生成中空白画布已替换成动画态并去掉轮询闪屏，大纲跳转改为靠近顶部定位，创建入口已从显式类型选择收口为 Goal Composer 内的意图判定与追问，交付类型切换到 `slides / web` 时主表面已固定留在对应的结果壳而不再默认掉回 Markdown / 源码视图，评论跟进已切到 `@角色 + 监听窗口` 语义，评论“应用到原文”已支持基于锚点候选和归一化文本的安全匹配。
- `slides` 结果面已不再依赖 markdown 字符串切卡片：`slide_page` 现已成为结构化 block；不仅 legacy `slides` 交付物会按 `slide_page` 渲染，`deliverableType=document` 且内容全为 `slide_page` 的交付物也会自动进入 slide 结果面。旧的 heading 式内容继续兼容，但底层已转向 block 语义，避免再从扁平文本里反推页结构。
- slide 结果面的表面文案也已继续收口：结果面 badge 现在明确显示 `Slide View / 幻灯片视图` 这类当前表面语义，而不再借用旧的 `Presentation / 演示稿` 创建类型词；共享 copy 里不再保留已失效的 `slides / implementation / deliverableTypeChanged` 残留 key。
- `slides` 的公共默认语义也开始回收到 `document`：共享 plan blueprint、公共类型标签、项目级 AI 摘要和 first-pass / plan 生成提示现在都会先把 legacy `slides` 折叠成 `document`；新出现的 deck / presentation / PPT 意图默认按文档内容处理，而不是再长出新的独立 `slides` 主路径。slide 结果面的空态 / 预览文案也已去掉“按新类型重整结果”这种过期提示。
- `slides` 在共享契约层也继续收口：创建恢复态、workspace create / plan route、replan proposal 和 assistant run payload 现在都会把 legacy `slides` 归一成 `document`；新创建路径不再生成独立 `slides` file seed，避免 API / session payload 继续偷偷长出旧类型。
- 统一结果形态语义也继续往共享层收口：workflow draft、replan prompt、first-pass prompt 和工具描述已不再使用 `deliverable type` 旧话术；未再被调用的 deliverable-type / regenerate / codeDeliverable 旧 copy key 也已删除，避免旧类型术语从 workflow 内容、AI prompt 或共享文案层重新回流。
- `code` 的公共 canonical 语义也已收回兼容层：共享 deliverable label、create intent 映射、plan blueprint 和默认类型推断现在只认 `document | web`；legacy `code` 只继续留在底层文件 kind 和存量读取兼容里，不再作为新的公共主路径长出来。
- legacy `code` 的 create / runtime 默认值也已继续折回文档语义：旧 `code` 创建请求现在默认生成 `main + markdown` 主文件，live draft upsert 不会再长出新的 `index.ts`，阶段 fallback 也回到文档式 `draft / review`；`code` 只继续留在底层 file kind、读取兼容和实现细节里。
- `code` 的残余类型推断也已继续收口：共享 deliverable 推断不再因为 primary file 的 `kind=code` 就把交付物直接误标成网页；只有 goal、title、文件路径或内容线索本身出现明确网页信号时，才会继续落到 `web`。这条边界已经补进项目级 AI context 回归，避免无 plan 的历史实现说明类交付物在同项目摘要里被误归类。
- 公共 `DeliverableType` 契约也已正式收成 canonical `document | web`：workspace view、项目级 AI context 和共享 helper 对外不再继续暴露 `slides / code`；legacy 类型改为显式 `storedDeliverableType` 兼容字段，仅用于存量 plan 值读取、旧结果面投影和历史数据兼容，避免旧 union 从类型别名层重新回流到产品表面。
- AI 的计划生成、workspace tool summary 和项目级摘要文案也已跟进当前产品语言：plan generator、`get_workspace_context`、`read_project_deliverable_file` 与 project deliverable 列表不再继续写 `Deliverable type / Type`，统一改成 `result shape / shape` 语义，并在注入 prompt 前先 canonicalize stored legacy deliverable 值。
- AI 的 debug / inspection 详情面也已跟进同一套契约：`get_workspace_context` 的 `details.workspacePlan` 不再直接泄漏 raw stored `slides / code`，而是显式返回 canonical `deliverableType` 与 `storedDeliverableType`，避免调试面和 E2E 辅助链路重新长回旧 union 心智。
- 首页引导、通用 AI 指令和 web plan blueprint 里的 `implementation` 残留心智也已继续清理：首页 hero 不再把 implementation 当成和报告/页面并列的主结果示例，通用提示改成 `supporting asset / source details`，web review 阶段描述改成围绕当前结果面的 `interaction details`。
- web 预览评论已经跨过 cross-origin 阻塞点：中央结果面现在默认通过同源 preview bridge 加载预览，iframe 内会把文本选区 / 元素点击序列化成 `excerpt + cssSelector + domContext + boundingRect` 回传父页面；`Review` 里选中 `web-component` 线程后，页面会把锚点重新发回 iframe 做重定位和临时高亮，至少已打通“预览选区评论 -> Review 聚焦回放”的第一条闭环。
- web 评论继承的第一刀也已补齐：静态 HTML 预览创建线程时会优先绑定到真实 preview 源文件，而不是错误继承当前活动源码文件；`Review` 在 web 交付物里也不再按 `currentFileId` 过滤线程，因此同一份网页改版后只要稳定 selector 还在，继承线程就能继续保持 actionable 并回放到预览上。
- web 评论继承的第二刀也已收口：如果元素迁移后用户已经在新位置留下 direct 评论，旧 inherited 线程现在会基于 selector / excerpt / domContext 的高信号 identity candidate 被判成 `superseded`，自动移入 earlier context，不再和当前可执行线程并列。
- web 评论继承的第三刀也已收口：旧 inherited 线程只有在 selector / excerpt / domContext 仍存在强源证据时才继续保持 actionable；如果三者都漂移，即使页面里还残留无关 selector token，线程也会稳定转成 `stale` 并收进 earlier context，避免假阳性存活。
- `web-component` 线程里的 `@assistant` 已切到 tool-enabled revision run：它不再只返回轻量文字评论，而是会基于 review anchor 和源码文件树直接修改 live draft，并在需要时刷新预览。为避免刷新后出现“状态显示预览已启动，但中央 iframe 尚未回流”的空窗，workspace view 现在会显式携带 `activePreviewRun`，前端在 `preview/start` 成功后先把 run 写回本地状态；若用户立刻刷新，还会通过短时 pending marker 和 reload-side `runs` warmup polling 恢复 bridge iframe，而不是停在空态。
- 已建立严格迭代回归门禁：`npm run verify:iteration` 现在是每次功能迭代 / bug 修复后的统一验收入口，使用隔离 app-data-root 跑静态检查和本地 Web Playwright 完整交互；`pre-push` 会自动兜底执行同一条命令。
- 已建立持续维护的经验教训台账：产品和技术两侧的最佳实践、踩坑记录与待验证方向，统一沉淀在 `docs/chengxing-lessons-learned.md`，后续重要迭代发现新经验时必须同步更新。
- 评论区已改成 `@角色` 驱动的单一触发语义：首批内置 `@assistant`，支持本地自定义 comment agents、一次提及多个角色、3 分钟监听窗口、等待倒计时与逐角色停止等待；旧的 `自动回复 / 手动回复 / 让 AI 回复` 控制面已退出主表面。
- `Status` 面板已不再暴露人工交付类型切换器；当前阶段、workflow 与下一步动作继续留在 `Status`，而载体变化改由创建流意图路由或后续显式派生动作承接，避免把内部 `deliverableType` 心智重新暴露给用户。
- “生成第一稿” 已收成显式启动语义：未启动时中央主表面保持准备态并承担唯一主动作，真正启动后才进入进行中动画；标题栏里的第二个交付类型菜单已移除，避免与右侧 `Status` 重复。
- 当前交付物完成且存在 active workflow 时，`Status` 面板会给出“沿用这套方法继续开工”卡片；新交付物直接在当前项目内创建并复用该 workflow，不再错误地重新要求选择项目位置或继续显示“创建项目”。
- 首次引导已改成渐进式 contextual guidance：首页 welcome modal 已降级为不阻断的轻量起步提示，`Status / Review / Chat / Context / Workflow / Version` 都会在第一次进入真实表面时给出一次性说明，而不是要求用户记住首页总说明。
- Chat 表面的会话续写语义已经和正式版本分支拆开：消息级入口统一降级为“从这里另开对话”，会话树和选择器也不再继续把 chat fork 冒充成正式 branch。
- `Version` 历史现在提供正式的“从这里继续”入口：用户从任一里程碑或回退点继续时，会先生成安全回退点，再把当前 live draft 切到新的正式版本 head；历史面会显式标出“当前草稿基线”，Chat 头部也会显示当前对话基于哪个里程碑/回退点。
- `Version` 比较不再只锁死“选中里程碑 vs 当前草稿”：比较弹窗现在允许任意可见里程碑对任意可见里程碑或当前草稿做双边比较，历史卡片会按当前草稿基线预填最可能的另一侧，方便直接查看版本演进。
- `Version` 历史的里程碑区不再只是倒序平铺：它会按可见 lineage 分层显示，当前草稿所在分支继续用“当前草稿基线”标出，其余叶子分支会显式标成 `Branch Head`；历史顶部还会单独给出 branch overview，把当前草稿分支和其他可见 branch head 摘要成独立卡片。历史卡片本身可以直接切进对应只读版本视图，而当用户已经站在另一条分支上时，也可以直接从里程碑卡片或 branch overview 把 live draft 切回目标 branch head；需要单独检查某条分支时，还可以把历史临时收成该 branch lineage 的聚焦视图，而不必在整棵树里来回找节点。
- 当前 live draft 的分支基线不再只藏在 `Chat` 和 `Version` 里：`Status` 面板现在也会显式显示当前分支基于哪个里程碑 / branch head，方便在主推进面判断自己正沿哪条正式版本线继续。
- 从旧里程碑继续后，`Review` 里的继承评论现在也与正式 lineage 对齐：只有祖先链上仍可重定位的未解决线程会进入当前分支的“继承评论上下文”，兄弟分支线程继续留在各自历史里。
- 联网能力已收成 `Chat 默认轻搜 + 可选深度研究 / Comment 显式深度研究` 这一套统一语义：旧 `searchMode` 与“仅草稿 / 实时网页”切换已退出主表面；轻搜在单次 run 内有固定搜索预算，深度研究必须先出研究计划，再在主交互面只显示计划 / 进度 / 摘要，完整报告统一落到支持资料树的 `研究` 目录。
- 仓库内显式代码 TODO 与旧评论验收语义已清理完成：块级讨论映射不再在渲染阶段直接写 `uniquePathMap`，严格迭代门禁也已切到当前 `@角色 + 监听窗口` 语义。
- 面向旧 `wiki / documents / sessions` 表面的兼容入口已进一步清理：未使用的旧 API 路由、旧 `x-dao-wiki-id` 头和遗留的版本底栏 / 文档 hook 已移除，避免继续给 MVP 主语义制造分叉。
- 本文件不再保留开放 todo。后续若出现新问题，应以新的缺陷或新迭代单独立项，而不是回填为本轮“剩余工作”。

## 目标

- 这份文件只记录已落地事实、验收证据和当前维护状态，不再承担待办清单功能。

## 差距

- 当前无开放产品级 todo。
- 后续只保留缺陷修复、体验打磨和新增需求，不作为本轮收口未完成项。
- “本轮无开放 todo” 不等于“已经达到北极星目标”。当前与最终目标的中长期差距已单独沉淀到 `docs/chengxing-v-next-gap-assessment.md`，避免把迭代收口和长期完成度混为一谈。

## 执行计划

本轮 10 项收口工作已全部完成：

1. 冻结共享数据契约并清退旧 `snapshot` 外露语义。
2. 统一 UI 状态源到 `currentStatus`。
3. 完成评论闭环、版本继承和 lineage 分类。
4. 收完右侧助手栏职责与支持资料树对象操作。
5. 定稿 `Workflow Playbook V1` 三态生命周期和激活 gate。
6. 更新项目状态文档并完成本地命令校验与浏览器走查。
7. 把迭代验收升级为可执行门禁，固化到脚本、Hook 和 `docs/testing/iteration-regression-plan.md`。
8. 用 `@角色 + 监听窗口` 替换评论回复模式，并把 `deliverableType` 产品语义收成创建路由与结果壳投影。
9. 把联网能力收成“默认轻搜 + 显式深度研究”，并把研究计划、进度和完整报告统一接入支持资料树。
10. 把 onboarding 从首页阻断式 welcome modal 改成首页轻提示 + 真实表面渐进式首次引导，覆盖 `Status / Review / Chat / Context / Workflow / Version`。

## 验收标准

- API / 类型
  - UI 代码不再消费 `workflowSummary` prop 名。
  - `/api/workspaces/[workspaceId]/snapshots` 已删除。
  - `WorkflowPlaybookData` 暴露正式 `status`；`CommentThreadData` 暴露 `scope / inheritanceState / sourceVersionId / anchorFingerprint`。
  - 公共 `DeliverableType` 契约只再暴露 canonical `document | web`；legacy `slides / code` 通过显式 stored compatibility 字段保留，不再混进共享 view model。
  - plan generator、workspace tools 与项目级摘要的 prompt-facing 文案统一使用 `result shape / shape`，不再继续向 AI 暴露 `Deliverable type / Type` 旧术语。
  - `get_workspace_context` 的 debug / inspection `details.workspacePlan` 也必须遵守同一条规则：canonical `deliverableType` 对外稳定，legacy 值只通过 `storedDeliverableType` 保留，不允许 raw stored type 直接回流。
- 评论行为
  - live draft 新评论写入当前 `draftRevision`；创建 version 只绑定该 revision 上仍未关闭的 direct 线程。
  - 继承线程已按 `actionable / stale / superseded` 分类；主列表不混入 `stale / superseded`。
  - 从旧里程碑继续后，当前分支只继承祖先链上仍可重定位的未解决评论；兄弟分支评论不会混入当前 `Review`。
  - `applied -> open`、`resolved -> open`、`open -> resolved` 返回更新后的线程元数据与绑定结果。
- UI / 交互
  - 右栏 4 个 tab 各司其职，无重复状态入口。
  - 评论区不再暴露独立回复模式或“让 AI 回复”按钮；等待中的 agent 会显式显示并可停止监听。
  - 支持资料树与中心表面、URL、选中态保持同步。
  - 工作区顶栏会显示当前项目路径；从顶栏创建同级交付物时，会直接继承当前 `projectId / projectFolderId / deliverableType`。
  - 当同一项目下存在多个交付物时，标题栏可直接切换当前交付物，不必先展开左侧项目树。
  - `Version` 历史里的可见里程碑卡可以直接进入对应只读版本视图，不必先回到顶部下拉框切换。
  - 当当前草稿已经站在另一条分支上时，历史里的其他 `Branch Head` 卡片可以直接把 live draft 切到那条分支；切换后新的当前草稿基线和 Chat 基线会同步更新。
  - `Version` 历史顶部会单独显示 branch overview：每条可见分支用一张摘要卡表示，展示 head、lineage 和里程碑数量，并允许直接浏览该 branch head 或把 live draft 切到另一条分支。
  - branch overview 还允许进入单分支聚焦模式：里程碑区会临时只显示目标 branch 的 lineage，并提供返回全部分支的显式动作。
  - `Status` 面板会显式显示当前 live draft 的分支基线标题，不再要求用户只去 `Chat` 或 `Version` 里确认自己正在沿哪条分支推进。
  - `Status` 是当前项目状态、当前 workflow 和下一步动作的唯一主入口，不再承担人工类型管理。
  - `Context` tab 会同时显示 `deliverable + project + user` scope Note，并用显式 scope badge 告知当前知识/记忆来自哪一层；知识条目可以在 tab 内显式写入或迁移到 `交付物 / 项目 / 用户` 任一层，默认新建仍写入当前交付物。
  - `slides` 内容可直接由 `slide_page` block 渲染成分页卡片，不再依赖把 markdown 文本重新按 heading 解析成假 slide。
  - web 结果面会通过同源 preview bridge 承载评论交互：在 iframe 中选中文本或点中元素后可以创建 `web-component` 线程；从 `Review` 选中该线程时，iframe 内对应元素会被重新定位并临时高亮。
  - 首页不再由阻断式 welcome modal 承担 onboarding；只保留可关闭的轻量起步提示。
  - 首次打开 `Status / Review / Chat / Context / Workflow / Version` 时，会在对应真实表面显示一次性 contextual guide。
- 联网与研究
  - Chat 默认按需轻搜，不再暴露旧“仅草稿 / 实时网页”切换；单次 run 的轻搜预算固定为 2 次搜索。
  - `深度研究` 必须先生成研究计划，再进入搜索 / 缺口分析 / 报告整理阶段。
  - Comment 普通回复仍保持本地短回复；显式开启深度研究后，线程里只保留短摘要和报告入口，不直接灌入长报告。
  - 完整研究报告统一写入支持资料树的 `研究` 目录；provider 不可用时，Chat 与 Comment 都会给出阻断文案和设置恢复入口。
  - 已补一个明确的验收场景约束：深度研究需要能产出“成形类产品的市场分析报告”，至少覆盖市场需求和竞品情况，并继续遵守“主交互面只显示摘要、完整报告进入支持资料”的规则。
- Workflow
  - `draft / active / archived` 三态完整可见且可转换。
  - Goal Composer 与 `Context > Workflow` 都会直接暴露系统内置 workflow 模板；当前内置场景至少包含“需求规格到网页上线”和“成形类产品市场分析报告”。
  - 内置 workflow 会显式展示 `Tools / MCP / Skills` 这三条开放扩展轨道，当前 `Status`、`Context` 与 Goal Composer 看到的是同一份结构化提示，而不是各写一套说明文案。
  - 自定义 workflow 保存的 `Tools / MCP / Skills` 提示会持久化到 playbook 本身；刷新页面、复制 workflow、应用到当前任务以及 chat prompt 注入后都继续读取同一份结构化数据，而不是只靠 builtin fallback 补文案。
  - 当前交付物的 chat prompt 与 `get_workspace_context` 会携带同项目交付物摘要，以及 `deliverable + project + user` scope `Note` 派生的 `Knowledge / Memory` 分区。需要参考兄弟交付物时，agent 可以通过 `list_project_deliverables` 与 `read_project_deliverable_file` 读取同项目的显式文件内容。
  - 选择内置 workflow 后，会沿用现有 playbook 绑定链路进入当前任务 / 新交付物，而不是走一套旁路状态机。
  - 只有 `active` playbook 进入默认复用、workspace plan 绑定和 chat prompt 注入链路。
  - `archived -> restore` 返回 `draft`，不会静默恢复成 `active`。
- 已完成验证
  - `npx prisma generate`
  - `npx next typegen`
  - `npx tsc --noEmit`
  - 定向 `eslint`
  - `npm run db:bootstrap:local`
  - `npm run dev`
  - 定向 `npx playwright test tests/e2e/iteration/14-project-ai-context.spec.ts --config=playwright.config.ts`
  - 定向 `npx playwright test tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts`
  - 稳定性复跑 `npx playwright test tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts --repeat-each=3`
  - `npm run verify:iteration` (`52 passed (1.8m)`)
  - 浏览器走查已覆盖 home/workspace 壳一致、右栏职责分离、支持资料创建与选中同步、workflow draft/activate(confirm)/archive/restore，以及评论继承 `actionable / stale / superseded` 分区显示。
  - 严格迭代门禁文档、Playwright 配置、隔离 seed 和 `pre-push` 规则已落地；后续功能交付默认改用 `npm run verify:iteration` 关闭验收。
