# 严格迭代回归门禁

更新时间：2026-03-17

## 何时必须执行

- 每次完成功能迭代后，交付前必须执行一次 `npm run verify:iteration`
- 每次修完 bug 后，交付前必须执行一次 `npm run verify:iteration`
- 不允许只跑 `tsc`、`eslint` 或单条 Playwright spec 就关闭任务

## 门禁分层

- 日常迭代门禁：`npm run verify:iteration`
- 浏览器依赖初始化：`npm run test:e2e:install`
- 发布 / 打包门禁：`npm run desktop:smoke:packaged`

`desktop:smoke:packaged` 不属于每次迭代的必跑项，只在打包验收或发布前执行。

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
  - home -> starter -> goal
  - 首页不再弹阻断式 welcome modal；首次进入只显示可关闭的轻量起步提示
  - 无 workflow 时显示说明态
  - `slides` 选择会传到下一步
  - 代码交付物保持禁用并显示“敬请期待”
  - 新建后若第一稿尚未启动，中央主表面保持准备态且只出现一个“生成第一稿”主动作，不提前显示进行中动画
- 主交付物表面
  - 正文可见
  - 点击大纲后，目标标题会滚动到顶部附近
  - 状态面板继续显示当前阶段
  - `document -> slides -> web` 切换时，中央主表面始终停留在对应的结果壳里，不会默认回退到 Markdown / 实现源码
  - 若当前内容暂时无法形成合法预览，中央主表面展示结果空态或引导，而不是直接露出源码
  - 交付类型切换只保留在右侧 `Status` 面板，不再从标题栏暴露第二个入口
- 支持资料树
  - 创建支持资料
  - 重命名支持资料
  - 删除当前支持资料后，URL 和中心表面同步回退
- 评论闭环
  - direct 单段线程可应用到原文
  - 跨段线程提前显示不可应用原因
  - 首条评论不 `@` 时，只保留人工讨论，不自动触发回复
  - `@assistant` 后会进入等待态，并显式显示监听中的 agent chip
  - 手动停止等待后，未 `@` 的跟帖不会继续自动续给该角色
- 编辑器块级线程
  - 带 comment mark 的块级讨论可以正常渲染
  - 跨段线程只在首个 block 显示入口，不会在后续 block 重复显示
- 对话切换与续写
  - 从消息另开对话时，当前 `versionId` 不丢
  - `Version` 历史里的可见里程碑卡可以直接进入对应只读版本视图，不必先回到顶部下拉框切换
  - 从 `Version` 历史里的里程碑 / 回退点继续时，会先创建安全回退点，再把 live draft 切到新的正式 head；URL 退出只读 `versionId` 视图，History 会标出当前草稿基线，Chat 头部显示新的基线来源
  - `Version` 比较支持“可见里程碑 vs 可见里程碑”与“可见里程碑 vs 当前草稿”两类双边组合，不再只验证“里程碑 vs 当前草稿”
  - `Version` 历史里的里程碑区按 lineage 分层显示；继续从旧里程碑长出新分支后，祖先节点仍保持根层，旧叶子会显示 `Branch Head`，当前 live draft 对应的分支仍显示“当前草稿基线”
  - 当当前草稿已经站在另一条分支上时，历史里的其他 `Branch Head` 卡片可以直接把 live draft 切到那条分支；切换后新的当前草稿基线和 Chat 基线同步更新
  - `Version` 历史顶部会显示独立 branch overview，把每条可见分支摘要成卡片；从这里也可以直接把 live draft 切到另一条 branch head，并看到新的当前草稿分支标识
  - branch overview 允许把里程碑列表临时聚焦到单条分支的 lineage；聚焦时不会混入其他可见分支节点，并且能显式返回全部分支历史
  - `Status` 面板会同步显示当前 live draft 的分支基线标题；从旧里程碑继续或切到另一条 branch head 后，这里的标题也会立即更新
  - 从旧里程碑继续后，`Review` 里只继承该祖先链上仍可重定位的未解决评论；兄弟分支的评论不会泄漏到当前新分支
  - 从对话选择器切换对话时，当前 `fileId` 不丢
- 联网与研究
  - Chat 默认显示轻搜语义，不再暴露旧“仅草稿 / 实时网页”切换
  - `深度研究` 必须先进入研究计划卡，再允许开始长跑
  - Chat 与 Comment 的深度研究都只在主交互面显示摘要 / 计划 / 进度，完整报告通过支持资料文件打开
  - 深度研究 provider 不可用时，Chat 和 Comment 都要给出明确阻断文案，并暴露直接跳到设置的恢复入口
  - 研究报告入口必须能直接打开对应支持资料文件
  - 研究报告文件必须出现在支持资料树的 `研究` 目录下，而不是漂在根层
- Workflow / Status
  - `draft / active / archived` 三态都可见
  - `Status` 面板显示当前绑定的 active workflow
  - 工作区顶栏会显示当前交付物的项目路径；从顶栏“新建同级交付物”进入 goal composer 后，新交付物仍落在同一 `projectId / projectFolderId`
  - 当同一项目下已有多个交付物时，标题栏切换器可以直接切到另一份交付物，URL 和当前中心/右侧上下文同步更新
  - 完成态且存在 active workflow 时，`Status` 面板会显示“沿用这套方法继续开工”，并在当前项目里带着该 workflow 创建下一个交付物
  - `Status` 面板在准备阶段只显示摘要与交付类型切换，不重复展示“生成第一稿”的第二张同主题卡
  - 首次打开 `Status / Review / Chat / Context` 时，会出现一次性 contextual guide
  - 首次进入 `Context` 时，workflow 区域会显示一次性 guide；打开只读 `Version` 时，会显示对应的版本 guide

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
