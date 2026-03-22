# 严格迭代回归门禁

更新时间：2026-03-22

## 何时必须执行

- 每次完成功能迭代后，交付前必须执行一次 `npm run verify:iteration`
- 每次修完 bug 后，交付前必须执行一次 `npm run verify:iteration`
- 不允许只跑 `tsc`、`eslint` 或单条 Playwright spec 就关闭任务

## 门禁分层

- 日常迭代门禁：`npm run verify:iteration`
- 浏览器依赖初始化：`npm run test:e2e:install`
- 额外能力门禁：browser operator / blackbox acceptance（仅在显式运行或里程碑前执行）
- 发布 / 打包门禁：`npm run desktop:smoke:packaged`

`desktop:smoke:packaged` 不属于每次迭代的必跑项，只在打包验收或发布前执行。browser operator / blackbox acceptance 也不属于日常 `verify:iteration`，而是后续额外能力和额外门禁。

## 固定执行顺序

1. `verify:iteration:static`
   - `npx prisma generate`
   - `npx next typegen`
   - `npx tsc --noEmit`
   - `npx eslint` 覆盖 `src/`、`apps/`、`scripts/`、`tests/` 与根配置文件
2. `db:bootstrap:local --app-data-root <.tmp/iteration-regression/app-data>`
3. 本地 Web 壳启动
4. Playwright 完整交互回归

## 浏览器场景矩阵

- 创建与起始流
  - home / workspace -> Goal Composer
  - 首页不再弹阻断式 welcome modal；首次进入只显示可关闭的轻量起步提示
  - Goal Composer 会直接暴露系统内置 workflow 模板；至少覆盖“需求规格到网页上线”和“成形类产品市场分析报告”
  - 选中内置 workflow 后，Goal Composer 会同步显示该方法暴露的 `Tools / MCP / Skills` 开放扩展提示
  - 创建流不再暴露 `document / slides / web / code` 类型选择器
  - 明确网页类目标会直接创建网页交付物
  - 歧义目标会在创建流内展示结构化追问卡片
  - 选择“两者都要”后，会在同项目下自动创建文档 + sibling web
  - legacy `code` 创建请求会折回当前文档默认语义：primary file 为 `main`、kind 为 `markdown`，不会再生成新的 `index.ts`
  - 新建后若第一稿尚未启动，中央主表面保持准备态且只出现一个“生成第一稿”主动作，不提前显示进行中动画
- 主交付物表面
  - 正文可见
  - 点击大纲后，目标标题会滚动到顶部附近
  - 状态面板继续显示当前阶段
  - 打开 `web` 交付物，或打开内容全为 `slide_page` 的文档交付物时，中央主表面始终停留在对应的结果壳里，不会默认回退到 Markdown / 实现源码
  - 新建 `web` 交付物后，默认 scaffold 不依赖外网也能直接渲染出可见首屏；iframe 里应看到页面标题或首屏内容，而不是空白结果面
  - slide 结果面既要兼容 legacy `slides` 交付物，也要能直接渲染文档里的结构化 `slide_page` block
  - slide 结果面的 badge 必须描述当前结果面本身，例如 `Slide View / 幻灯片视图`，不能回流旧的 `Presentation / 演示稿` 创建类型词
  - slide 结果面的空态 / 预览文案不再引用“按新类型重整结果”这类已删除动作
  - 若当前内容暂时无法形成合法预览，中央主表面展示结果空态或引导，而不是直接露出源码
  - `Status` 面板不再暴露人工类型切换器或“按新类型重整结果”入口
- 支持资料树
  - 即使全局首页侧栏曾被折叠，进入工作区后仍能直接看到支持资料 section 和新增入口
  - 创建支持资料
  - 重命名支持资料
  - 删除当前支持资料后，URL 和中心表面同步回退
- 评论闭环
  - 文档编辑器中拖选正文后，会出现浮动评论按钮，并能创建带文本锚点的线程
  - direct 单段线程可应用到原文
  - 跨段线程提前显示不可应用原因
  - 首条评论不 `@` 时，只保留人工讨论，不自动触发回复
  - `@assistant` 后会进入等待态，并显式显示监听中的 agent chip
  - 手动停止等待后，未 `@` 的跟帖不会继续自动续给该角色
  - web preview 通过同源 bridge 载入后，iframe 内选中文本可以创建 `web-component` 线程
  - 在 `Review` 选中该 web 线程时，iframe 内对应元素会重新定位并临时高亮
  - web preview 评论要绑定到真实 preview 源文件或整份 deliverable surface，不能被当前活动源码文件误绑
  - 创建 version 后即使文案变化，只要稳定 selector 仍存在，继承的 web 线程仍应保持 `actionable` 并能从 `Review` 回放高亮
  - 如果元素迁移后用户已经在新位置留下新的 direct 评论，旧 inherited web 线程必须变成 `superseded` 并移入 `Earlier Context`，不能和当前可执行线程并列
  - 如果旧 web 线程的 selector / excerpt / domContext 都已漂移，即使页面里还残留无关 selector token 或同名 id 片段，线程也必须变成 `stale` 并移入 `Earlier Context`
- `web-component` 线程里的 `@assistant` 必须走可修改 live draft 的 revision run，而不是只返回文本建议；评论后预览源码和 bridge 结果都要同步更新
- 启动 preview 后即使立刻刷新页面，web 结果面也不能卡在“预览已启动”空态；iframe 需要能基于当前 view / runs 恢复 bridge 预览，即使 bridge 首次请求短暂返回 `502` 也必须自动回稳
- 编辑器块级线程
  - 带 comment mark 的块级讨论可以正常渲染
  - 跨段线程只在首个 block 显示入口，不会在后续 block 重复显示
- 对话切换与续写
  - 从消息另开对话时，当前 `versionId` 不丢
  - `Version Tree / 版本树` 里的可见里程碑卡可以直接进入对应只读版本视图，不必先回到顶部下拉框切换
  - 从 `Version Tree / 版本树` 里的里程碑 / 回退点继续时，会先创建安全回退点，再把 live draft 切到新的正式 head；URL 退出只读 `versionId` 视图，Version Tree 会标出当前草稿基线，Chat 头部显示新的基线来源
  - `Version Tree` 比较支持“可见里程碑 vs 可见里程碑”与“可见里程碑 vs 当前草稿”两类双边组合，不再只验证“里程碑 vs 当前草稿”
  - `Version Tree / 版本树` 里的里程碑区按 lineage 分层显示；继续从旧里程碑长出新分支后，祖先节点仍保持根层，旧叶子会显示 `Branch Head`，当前 live draft 对应的分支仍显示“当前草稿基线”
  - 当当前草稿已经站在另一条分支上时，历史里的其他 `Branch Head` 卡片可以直接把 live draft 切到那条分支；切换后新的当前草稿基线和 Chat 基线同步更新
  - `Version Tree / 版本树` 顶部会显示独立 branch overview，把每条可见分支摘要成卡片；从这里也可以直接把 live draft 切到另一条 branch head，并看到新的当前草稿分支标识
  - branch overview 允许把里程碑列表临时聚焦到单条分支的 lineage；聚焦时不会混入其他可见分支节点，并且能显式返回全部分支历史
  - `Status` 面板会同步显示当前 live draft 的分支基线标题；从旧里程碑继续或切到另一条 branch head 后，这里的标题也会立即更新
  - 从旧里程碑继续后，`Review` 里只继承该祖先链上仍可重定位的未解决评论；兄弟分支的评论不会泄漏到当前新分支
  - 从对话选择器切换对话时，当前 `fileId` 不丢
- 联网与研究
  - Chat 默认显示轻搜语义，不再暴露旧“仅草稿 / 实时网页”切换
  - `深度研究` 必须先进入研究计划卡，再允许开始长跑
  - Chat 与 Comment 的深度研究都只在主交互面显示摘要 / 计划 / 进度，完整报告通过支持资料文件打开
  - 深度研究需要覆盖一个明确业务场景：生成“成形类产品”的市场分析报告，至少包含市场需求与竞品情况
  - 深度研究 provider 不可用时，Chat 和 Comment 都要给出明确阻断文案，并暴露直接跳到设置的恢复入口
  - 当当前搜索 provider 选为 `Browser Operator Search` 且 endpoint 指向可访问搜索页时，`/api/search/query` 可以通过 browser operator 打开页面、等待结果并提取可见 result card；这条闭环不要求额外 API key
  - 研究报告入口必须能直接打开对应支持资料文件
  - 研究报告文件必须出现在支持资料树的 `研究` 目录下，而不是漂在根层
- Workflow / Status
  - `draft / active / archived` 三态都可见
  - `Context > Workflow` 会单独显示内置 workflow 模板区，且可直接把模板应用到当前任务
  - 内置 workflow 卡片和 `Status` 面板会显示同一组 `Tools / MCP / Skills` 开放扩展提示，不允许各写一套分叉文案
  - 自定义 workflow 在 `Context` 中填写并保存 `Tools / MCP / Skills` 后，刷新页面仍能看到同样的提示；应用到当前任务后，`Status` 也会显示同一组开放扩展标签
  - 项目级 AI 上下文需要覆盖一个明确场景：在当前交付物上构建 chat prompt / `get_workspace_context` 时，能够带出同项目其他交付物的标题、类型、状态摘要，以及 `deliverable + project + user` scope `Note` 派生的 `Knowledge / Memory`；当 AI 需要参考兄弟交付物时，必须能先列出同项目交付物，再显式读取目标文件内容
  - 如果同项目里存在无 plan 的历史实现说明类交付物，即使其 primary file `kind=code`，项目级 AI context 也不能仅凭 file kind 把它误标成 `web`；只有明确的网页线索才能进入网页语义
  - `workspace view`、项目级 AI context 和共享 helper 对外 deliverable 语义只应暴露 canonical `document | web`；legacy `slides` 只通过统一 slide 结果面兼容，不能重新回流到公共类型契约或项目摘要里
  - plan generator、`get_workspace_context`、`list_project_deliverables` 和 `read_project_deliverable_file` 这类 AI-facing 摘要应统一使用 `result shape / shape` 语义；stored legacy deliverable 值必须先 canonicalize，再进入 prompt 或工具输出
  - `get_workspace_context` 的 debug / inspection `details.workspacePlan` 也必须只暴露 canonical `deliverableType`，并把 legacy `slides / code` 限制在显式 `storedDeliverableType` 字段里
  - `Status` 面板显示当前绑定的 active workflow
  - 工作区顶栏会显示当前交付物的项目路径；从顶栏“新建同级交付物”进入 goal composer 后，新交付物仍落在同一 `projectId / projectFolderId`
  - 当同一项目下已有多个交付物时，标题栏切换器可以直接切到另一份交付物，URL 和当前中心/右侧上下文同步更新
  - 完成态且存在 active workflow 时，`Status` 面板会显示“沿用这套方法继续开工”，并在当前项目里带着该 workflow 创建下一个交付物
  - `Status` 面板在准备阶段只显示摘要与当前 workflow / 下一步动作，不重复展示“生成第一稿”的第二张同主题卡，也不再承担类型管理
  - 首次打开 `Status / Review / Chat / Context` 时，会出现一次性 contextual guide
  - 首次进入 `Context` 时，workflow 区域会显示一次性 guide；打开只读版本视图时，会显示对应的版本 guide

## 隔离与产物

- 门禁默认使用 `.tmp/iteration-regression/` 作为隔离运行根目录
- 数据库写入 `.tmp/iteration-regression/app-data/dev.db`
- Playwright trace、截图、video、HTML report 都写入 `.tmp/iteration-regression/artifacts/`
- 不允许污染仓库根目录 `dev.db`

## 失败处理

- `pre-push` 会自动执行 `npm run verify:iteration`
- 任一阶段失败都阻断 push
- 调试时可以单独跑某一条 spec，但交付前必须重新跑完整 `npm run verify:iteration`
- 修复后必须重跑全套，不允许只凭“失败那一条已绿”直接交付
