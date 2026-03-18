# 成形项目状态

更新时间：2026-03-18
状态：终版收口完成，进入严格迭代验收维护
对应规划：[产品落地计划](./chengxing-rollout-plan.md)
经验台账：[经验教训台账](./chengxing-lessons-learned.md)
长期差距评估：[v-next 差距评估](./chengxing-v-next-gap-assessment.md)

## 现状

- 工作区 UI 对外只再使用 `currentStatus / Version / Review / Chat / Context / Workflow` 这套主语义。`workflowSummary` 不再进入页面 props、hook 命名或 UI helper，服务层仅保留内部 alias。
- 首页、设置页和工作区左栏里的“项目”已收成显式 `ProjectSummary` 摘要对象：项目列表现在直接返回 `projectId + representative workspaceId + deliverableCount + latestDeliverableTitle`，不再继续把 `/api/workspaces` 的分组结果假装成项目导航。
- 工作区顶栏现在会把“当前交付物位于哪个项目 / 文件夹”直接放进第一扫描线，并提供显式“新建同级交付物”动作；该入口会直接沿用当前 `projectId / projectFolderId / deliverableType` 进入 goal composer，不再先绕回全局 starter。若同一项目下已有多个交付物，标题本身也会变成切换器，允许直接切到同项目的另一份当前交付物。
- AI 的当前交付物对话已开始携带项目级摘要上下文：chat system prompt 与 `get_workspace_context` 都会注入同项目交付物的标题 / 类型 / 状态摘要；chat prompt 还会把当前 / 项目 / 全局三层 `Knowledge / Memory` 统一打进同一条上下文链路。当用户提到“参考首页”“跟 FAQ 对齐”这类跨交付物需求时，agent 可以先 `list_project_deliverables`，再 `read_project_deliverable_file` 显式读取同项目兄弟交付物内容，而不必把整个项目内容默认灌进 prompt。
- 评论闭环已固定到 `version + draftRevision` 基点。`CommentThreadData` 现已暴露 `scope / inheritanceState / sourceVersionId / anchorFingerprint`；主列表只显示 `direct(open/applied)` 与 `inherited(actionable)`，`stale / superseded` 收到“更早上下文”。
- 右侧助手栏已收成 `状态 / 评审 / 对话 / 上下文` 四个职责明确的 tab。`状态` 是当前状态、当前 workflow 与下一步动作的唯一主入口；`评审` 只承载线程；`对话` 只承载发送相关阻塞；`上下文` 只承载知识、记忆与 workflow 库。
- 支持资料树已与项目树复用同一对象操作和 `WorkspaceFile.sortOrder`，支持创建、重命名、删除、移动、拖拽与顺序调整，中心表面、URL 与左栏选中态保持同步。
- `Workflow Playbook V1` 已定稿为 `draft / active / archived` 三态。只有 `active` 进入默认复用、workspace plan 绑定和 chat prompt 注入链路；`archived -> restore` 固定回到 `draft`；draft warning 已升级为激活前 gate。
- 系统级内置 workflow 已并入同一套 playbook 轨道，而不是另做单独向导：当前至少内置了“需求规格到网页上线”和“成形类产品市场分析报告”两套模板；它们会直接出现在 Goal Composer 与 Context 里，创建/应用时会落入现有 workflow 绑定链路，并把后续 `tools / MCP / skills` 扩展继续收在同一个方法层入口上。workflow 现在会把开放扩展提示作为正式字段持久化到 playbook 本身，自定义 workflow 在保存、复制、刷新、激活和 plan/chat 注入后都能继续带出同一组 `Tools / MCP / Skills` 提示，避免把未来生态能力埋在纯文本备注里或只对内置模板生效。
- 产品层 `snapshot` 语义已退出主表面：`/api/workspaces/[workspaceId]/snapshots` 已删除，工作区、评论、对话、预览、chat、runs 主路径不再接受 `snapshotId / baseSnapshotId / previewSnapshotId` 等外露参数。
- 已完成一轮 packaged QA 缺陷修补：无 workflow 创建提示已改成说明态，代码交付物入口已禁用为“敬请期待”，生成中空白画布已替换成动画态并去掉轮询闪屏，大纲跳转改为靠近顶部定位，交付物类型选择能正确继承 slides，交付类型切换到 `slides / web` 时主表面已固定留在对应的结果壳而不再默认掉回 Markdown / 源码视图，评论跟进已切到 `@角色 + 监听窗口` 语义，评论“应用到原文”已支持基于锚点候选和归一化文本的安全匹配。
- `slides` 结果面已不再依赖 markdown 字符串切卡片：`slide_page` 现已成为结构化 block，中央画布会优先按 `slide_page` 渲染 slide 卡片；旧的 heading 式内容继续兼容，但底层已转向 block 语义，避免再从扁平文本里反推页结构。
- 已建立严格迭代回归门禁：`npm run verify:iteration` 现在是每次功能迭代 / bug 修复后的统一验收入口，使用隔离 app-data-root 跑静态检查和本地 Web Playwright 完整交互；`pre-push` 会自动兜底执行同一条命令。
- 已建立持续维护的经验教训台账：产品和技术两侧的最佳实践、踩坑记录与待验证方向，统一沉淀在 `docs/chengxing-lessons-learned.md`，后续重要迭代发现新经验时必须同步更新。
- 评论区已改成 `@角色` 驱动的单一触发语义：首批内置 `@assistant`，支持本地自定义 comment agents、一次提及多个角色、3 分钟监听窗口、等待倒计时与逐角色停止等待；旧的 `自动回复 / 手动回复 / 让 AI 回复` 控制面已退出主表面。
- `document / slides / web` 已按“交付类型”对外表达，并在 `Status` 面板提供唯一切换入口；切换只改变当前类型、状态文案和后续 AI 语义，不破坏文件、版本、评论或上下文。
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
8. 用 `@角色 + 监听窗口` 替换评论回复模式，并把 `deliverableType` 产品语义收成可切换的交付类型。
9. 把联网能力收成“默认轻搜 + 显式深度研究”，并把研究计划、进度和完整报告统一接入支持资料树。
10. 把 onboarding 从首页阻断式 welcome modal 改成首页轻提示 + 真实表面渐进式首次引导，覆盖 `Status / Review / Chat / Context / Workflow / Version`。

## 验收标准

- API / 类型
  - UI 代码不再消费 `workflowSummary` prop 名。
  - `/api/workspaces/[workspaceId]/snapshots` 已删除。
  - `WorkflowPlaybookData` 暴露正式 `status`；`CommentThreadData` 暴露 `scope / inheritanceState / sourceVersionId / anchorFingerprint`。
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
  - `Status` 是当前项目状态、当前 workflow 和交付类型切换的唯一主入口。
  - `slides` 内容可直接由 `slide_page` block 渲染成分页卡片，不再依赖把 markdown 文本重新按 heading 解析成假 slide。
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
  - 当前交付物的 chat prompt 与 `get_workspace_context` 会携带同项目交付物摘要；chat prompt 还会把当前 / 项目 / 全局三层 `Knowledge / Memory` 一起注入。需要参考兄弟交付物时，agent 可以通过 `list_project_deliverables` 与 `read_project_deliverable_file` 读取同项目的显式文件内容。
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
  - `npm run verify:iteration`
  - 浏览器走查已覆盖 home/workspace 壳一致、右栏职责分离、支持资料创建与选中同步、workflow draft/activate(confirm)/archive/restore，以及评论继承 `actionable / stale / superseded` 分区显示。
  - 严格迭代门禁文档、Playwright 配置、隔离 seed 和 `pre-push` 规则已落地；后续功能交付默认改用 `npm run verify:iteration` 关闭验收。
