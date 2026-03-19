# 成形统一交付模型进度追踪

更新时间：2026-03-19
状态：进行中
对应技能：[`chengxing-autopilot`](../skills/chengxing-autopilot/SKILL.md)
相关文档：[项目状态](./chengxing-project-status.md) · [产品落地计划](./chengxing-rollout-plan.md) · [v-next 差距评估](./chengxing-v-next-gap-assessment.md) · [迭代回归门禁](./testing/iteration-regression-plan.md)

## 现状

- 当前 iteration goal 已完成并作为本工作流前提：
  - chat prompt 已注入同项目交付物摘要
  - 当前 / 项目 / 全局三层 `Knowledge / Memory` 已进入 prompt
  - `list_project_deliverables` / `read_project_deliverable_file` 已可用
- 创建流去类型化的第一刀已完成：
  - 首页和工作区创建入口已直接进入 `GoalComposerDialog`
  - 创建流不再暴露显式交付类型选择器
  - `GoalComposerDialog` 已内置意图判定；歧义目标会在创建流内展示结构化追问卡片
  - `/api/workspaces` 已支持 `both`，会先创建文档，再在同项目下自动创建 sibling web
- 当前长期 active goal 仍未完成：
  - `slides` 虽已有 `slide_page` block，但仍是独立 `DeliverableType`
  - web 评论仍依赖父页面直读 iframe 选区；当前 raw preview 为跨源 `127.0.0.1`，闭环未成立

## 已确认决策

- 结构化追问放在创建流内完成，不放到创建后的第一轮对话
- `Status` 面板移除人工“交付类型切换器”
- 项目级 AI 上下文视为已完成前提，不重复排期
- web 评论闭环采用预览桥接方案，不继续假设父页面可直接读取 raw preview iframe DOM
- 本阶段不做通用 chat widget 系统；创建追问先做创建流专用组件

## 阶段追踪

| 阶段 | 范围 | 状态 | 备注 |
| --- | --- | --- | --- |
| Phase 0 | 项目级 AI 上下文基线 | 已完成 | 当前 iteration goal，作为后续前提 |
| Phase 1 | 创建流去类型化 | 已完成 | 已完成创建流意图判定、结构化追问卡片、`both` 同项目双交付物创建与回归 |
| Phase 2 | `slides` 并入 `document` | 进行中 | 已完成 Phase 2.1：`document + slide_page` 自动投影成 slide 结果面；已完成 Phase 2.2：公共默认语义开始把 `slides` 折叠回 `document`；已完成 Phase 2.3：create / plan / payload 契约把 legacy `slides` 统一归一到 `document` |
| Phase 3 | web 画词评论闭环 | 进行中 | 已完成 Phase 3.1 同源 preview bridge、选区评论创建和 Review 回放高亮；已完成 Phase 3.2：锚点绑定、继承重定位、`@assistant` revision run 与 preview run 回流；已完成 Phase 3.3：迁移后重复评论的 superseded 收口 |
| Phase 4 | 语义收口与 plan 动态化 | 进行中 | 已完成 Phase 4.1 `Status` 面板人工类型切换清理；已完成 Phase 4.2 旧结果形态术语与 dead copy 清理；已完成 Phase 4.3 `code` 公共 canonical 语义收口 |

## 当前切片

### 已完成：Phase 2.1 `document + slide_page` 投影

目标：

- 让 `deliverableType=document` 且内容全为 `slide_page` 的交付物自动进入 slide 结果面
- 开始把“PPT/路演稿”主路径从独立 `slides` 类型迁到文档内容模型
- 用 E2E 验证 slide 投影由内容决定，而不是只由 `deliverableType=slides` 决定

当前进度：

- `src/lib/workspace/slide-pages.ts` 已新增 `hasOnlySlidePageBlocks`
- `src/app/workspace/[workspaceId]/page.tsx` 已支持“文档 + 全部 slide_page -> SlidesDeliverableCanvas”
- `tests/e2e/iteration/12-slides-blocks.spec.ts` 已改成用 `deliverableType=document` 验证 slide_page 投影
- `tests/e2e/iteration/02-workspace-surface.spec.ts` 已改成用文档 slide_page workspace 验证结果壳稳定
- 已通过定向 Playwright 和全量 `npm run verify:iteration`

已完成项：

- 完成 `document + slide_page` 自动 slide 投影
- 用文档型 workspace 覆盖 slide 结果面回归
- 保持现有 legacy `slides` 兼容路径不回退
- 已通过 `npm run verify:iteration`

### 已完成：Phase 2.2 `slides` 公共默认语义收口

目标：

- 让新的 plan blueprint、公共标签和 AI 默认提示不再把 `slides` 当成第三条主路径
- 保留旧 `slides` 数据兼容，但让共享默认语义优先回到 `document`
- 清掉 slide 结果面里还引用“按新类型重整结果”的过期文案

当前进度：

- `src/lib/workspace/deliverable-types.ts` 已新增 canonical helper，把 legacy `slides` 折叠回 `document`
- `src/lib/workspace/plan-blueprints.ts` 已去掉独立 `slides` blueprint，默认按 `document` blueprint 生成阶段
- `src/lib/workspace/deliverable-labels.ts`、`src/lib/ai/project-context.ts`、`src/lib/ai/plan-generator.ts`、`src/app/workspace/[workspaceId]/page.tsx` 已改用 canonical deliverable 语义
- `src/lib/workspace/planning.ts` 已把 slide/deck/ppt 这类新推断主路径改回 `document`
- `src/lib/i18n/copy.ts` 已清掉 slide 结果面里的旧“按新类型重整结果”文案；`src/components/workspace/workspace-starter-dialog.tsx` 已删除
- `tests/e2e/iteration/12-slides-blocks.spec.ts` 已补“结果面不再出现旧重整文案”的回归断言
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 2.3 `slides` 旧 API / payload 归一化收口

目标：

- 让创建、plan 更新、replan proposal、assistant run payload 和本地恢复状态不再继续把 `slides` 当成独立新写入类型
- 保留 legacy `slides` 阅读兼容，但把共享契约里的落盘 / 回流语义统一折回 `document`
- 避免“画布已统一、但 API / session payload 还在继续长出 `slides`”这种半收口状态

当前进度：

- `src/lib/workspace/deliverable-types.ts` 已补 `normalizeStoredDeliverableType`，把 legacy `slides` 统一归一成 `document`
- `src/lib/workspace/create-request.ts`、`src/lib/workspace/create-intent.ts` 已把创建流恢复态和 create intent 映射统一收口到 canonical 语义
- `src/app/api/workspaces/route.ts`、`src/app/api/workspaces/[workspaceId]/plan/route.ts` 已不再把 `slides` 当成独立新写入分支；create / plan 路径收到 legacy `slides` 时会按 `document` 处理
- `src/app/api/workspaces/route.ts` 已删除 `slides` 专属 file seed 分支，新创建不再生成独立 `slides` 文件壳
- `src/lib/workspace/planning.ts`、`src/lib/ai/replan-proposal.ts`、`src/lib/workspace/assistant-run-payload.ts` 已把 payload 里的 legacy `slides` 一律折回 `document`
- 定向 `npx tsc --noEmit`、`npx playwright test tests/e2e/iteration/01-home-start.spec.ts tests/e2e/iteration/10-deliverable-intent.spec.ts tests/e2e/iteration/12-slides-blocks.spec.ts tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 `slides -> document` 在 create / plan / payload 契约层的统一归一
- 清掉新创建路径里的独立 `slides` file seed
- 保持 legacy slide 阅读与投影兼容不回退
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 4.2 旧结果形态术语与 dead copy 清理

目标：

- 清掉 workflow draft、replan prompt、first-pass prompt 和 tool 描述里残留的 `deliverable type` 旧术语
- 避免已经从 UI 退出的旧类型文案继续通过 workflow 内容、AI prompt 或 dead i18n key 回流
- 把“结果形态”语义收口到共享 copy 层，而不是只停留在某几个页面组件

当前进度：

- `src/lib/workflows/service.ts` 生成 workflow draft 时，已不再写入 “deliverable type” 文案，兜底约束统一改成围绕当前 goal 和 result shape
- `src/lib/ai/replan-proposal.ts`、`src/app/workspace/[workspaceId]/page.tsx` 已把 replan / first-pass prompt 里的旧 `deliverable type` 表述改成 `result shape`
- `src/lib/ai/context-builder.ts`、`src/lib/ai/pi-agent-tools.ts` 已把“slide decks 不是单独 deliverable type”这类描述统一改成 result-shape 语义
- `src/lib/i18n/copy.ts` 已删除未被调用的 `deliverableType / regenerateWithDeliverableType / codeDeliverable` 等 dead key，避免后续继续从共享 copy 层长回旧语义

已完成项：

- 完成 workflow / prompt / tool 文案里的旧结果类型术语收口
- 清掉一批已失效的 deliverable-type 相关 i18n key
- 保持现有创建流、Status 和 slides/web 回归不受影响
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 4.3 `code` 公共 canonical 语义收口

目标：

- 让共享 canonical 语义真正收成 `document | web`，不再把 `code` 继续当成对外主路径
- 保留底层 `file.kind=code` 和 legacy 存量读取兼容，但把公共 label、blueprint 和默认推断压回文档/网页两条主干
- 避免新的 plan / create intent / deliverable label 继续从共享 helper 里长出第三条 `code` 分支

当前进度：

- `src/lib/workspace/deliverable-types.ts` 已把 `CanonicalDeliverableType` 收成 `document | web`；legacy `code`/`slides` 只在 normalize 层兼容
- `src/lib/workspace/deliverable-labels.ts`、`src/lib/workspace/create-intent.ts` 已不再把 `code` 当成独立公共 label / intent 分支
- `src/lib/workspace/plan-blueprints.ts` 已删除独立 `code` blueprint，公共 plan 默认只按 `document | web` 两套基础模板生成
- `src/lib/workspace/planning.ts` 已不再把新的代码类目标默认推断成 `code`；显式 legacy `code` 也会在共享推断层折回 `document`
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/01-home-start.spec.ts tests/e2e/iteration/06-workflow-status.spec.ts tests/e2e/iteration/12-slides-blocks.spec.ts tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 `code` 在公共 canonical helper / label / intent / blueprint / 默认推断层的收口
- 保留底层 file kind 和 legacy 读取兼容，不影响 web/slides 现有闭环
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 3.1 同源 preview bridge 与 Review 回放

目标：

- 让 cross-origin `127.0.0.1` web preview 不再依赖父页面直读 iframe DOM
- 在 preview 内打通“文本选区/元素点击 -> 创建评论线程 -> Review 选中后回放高亮”这条最短闭环
- 为后续 `web-component` 线程的源码定位和 stale 重定位补齐 `cssSelector / domContext / boundingRect` 锚点基础

当前进度：

- `src/lib/workspace/preview-bridge.ts` 已新增同源 bridge 协议、HTML 注入和 iframe 内高亮回放脚本
- `src/app/api/workspaces/[workspaceId]/preview/bridge/[runId]/[[...path]]/route.ts` 已新增 preview bridge 代理路由；web 结果面默认加载 bridge URL
- `src/components/comments/web-selection-comment-trigger.tsx` 已改成 message-driven，父页面不再直接读取 iframe DOM，而是消费 bridge 回传的选区/元素 payload
- `src/app/workspace/[workspaceId]/page.tsx` 已在 Review 聚焦时把 `web-component` anchor 通过 `postMessage` 回送给 iframe 做重定位与高亮
- `src/types/index.ts` 已扩展 `ReviewAnchorPayloadData`，正式承载 `cssSelector / domContext / boundingRect`
- `tests/e2e/iteration/15-web-preview-comments.spec.ts` 已覆盖同源 bridge 选区评论创建和 Review 回放高亮

已完成项：

- 完成 preview bridge 路由和注入脚本
- 完成 message-driven web 评论入口
- 完成 Review -> preview refocus/highlight 闭环
- 补齐 web preview 评论的定向 Playwright 验收

### 已完成：Phase 3.2 第一刀 web 锚点绑定与继承重定位

目标：

- 避免 web preview 评论继续错误绑定到“当前活动源码文件”，导致明明可重定位的线程被误判成 stale
- 让 `Review` 在 web 交付物里按交付物级线程加载，而不是继续被 `currentFileId` 过滤掉
- 让跨版本改文案但保留稳定 selector 的 `web-component` 线程继续保持 actionable，并能回放高亮

当前进度：

- `src/lib/workspace/preview.ts` 已新增 `resolveWebPreviewAnchorFile`，静态 HTML 预览会优先把评论绑定到实际 preview 源文件；dev-server 预览则保守回退到 `null`
- `src/app/workspace/[workspaceId]/page.tsx` 已不再把 web 评论线程强绑到 `currentFile`，同时 `Review` 加载线程时也不再按当前源码文件过滤 web 交付物
- `src/app/api/threads/route.ts` 已让 `web-component` 线程在 file 级匹配失败时回退到整份 deliverable surface 搜索，避免旧错绑或多文件预览把线程误判成 stale
- `tests/e2e/iteration/15-web-preview-comments.spec.ts` 已覆盖“评论绑定到 `index.html`、创建 version 后改文案但保留 selector、继承线程仍 actionable 且可重新高亮”这条回归

已完成项：

- 修正 web 评论锚点 `fileId` 绑定策略
- 修正 web 交付物 `Review` 线程的加载过滤策略
- 补齐 selector 保持稳定时的继承 / refocus 定向验收

### 已完成：Phase 3.2 第二刀 `web-component @assistant` revision run 与 preview run 回流

目标：

- 把 `web-component` 线程里的 `@assistant` 从轻量 comment-reply 文本流切到可用工具的 workspace revision run
- 让 AI 能基于 review anchor、源码文件树和 preview 状态直接修改 live draft，并在需要时刷新预览
- 消除“页面状态已显示预览启动，但 reload 后中央 iframe 还没回流”这类 preview run 空窗

当前进度：

- `src/app/api/ai/comment-reply/route.ts` 已对 `web-component + @assistant` 切到 tool-enabled revision run；非 web 线程仍保留原轻量 comment-reply 路径
- `src/hooks/use-ai-reply.ts` 已补 `stripAIStreamControlTokens`，避免 tool-enabled stream heartbeat 泄漏到评论 UI
- `src/types/index.ts`、`src/lib/workspace/service.ts`、`src/app/workspace/[workspaceId]/page.tsx` 已补 `activePreviewRun` 视图契约与前端 fallback；preview/start 成功后会先把 run 回流到本地状态，页面刷新也可直接用 workspace view 恢复 iframe
- `src/lib/workspace/preview-start-recovery.ts`、`src/app/workspace/[workspaceId]/page.tsx` 已补 preview start reload 恢复链路：`preview/start` 请求使用 `keepalive`，前端会暂存短时 pending marker；若用户立刻刷新，新页面会先做短时 `runs` warmup polling，必要时再按 marker 补发恢复启动，避免中央结果面卡在“预览已启动”空态
- `tests/e2e/iteration/15-web-preview-comments.spec.ts` 已新增 `web-component @assistant` 线程修改实现并刷新预览的回归，同时保持首个 bridge 评论 + Review refocus 用例稳定通过
- 定向 `npx playwright test tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts` 已全绿，`--repeat-each=3` 稳定性复跑也已通过

已完成项：

- 完成 `web-component @assistant` tool-enabled revision run
- 完成评论流 heartbeat token 的 UI 清理
- 完成 preview run 在 workspace view 与前端本地状态之间的双重回流
- 完成 preview/start 在 reload 场景下的恢复收口
- 补齐“评论驱动改源码并刷新预览”的定向 Playwright 验收

### 已完成：Phase 3.3 迁移后重复评论的 superseded 收口

目标：

- 当 web 锚点跨版本迁移后，若用户已经在新位置留下新的 direct 评论，旧 inherited 线程不应继续留在 actionable 区
- 避免 selector 改名后只靠旧 fingerprint 判定，导致同一块结果同时出现“新 direct + 旧 inherited”两条当前可执行线程
- 让 `Review` 把这类旧线程稳定收进 earlier context，而不是继续和当前修改并列

当前进度：

- `src/lib/comments/review-anchor.ts` 已新增高信号 identity candidate 提取，优先使用完整 selector、excerpt 和 domContext，而不只靠原有 fingerprint/token
- `src/app/api/threads/route.ts` 已在 inherited 分类时同时比较 direct / inherited 的高信号 identity candidate；当新 direct 线程已经覆盖同一结果块时，旧 inherited 线程会被标成 `superseded`
- `tests/e2e/iteration/15-web-preview-comments.spec.ts` 已新增“元素迁移后重新评论，旧 inherited 线程进入 earlier context”的回归
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 web 迁移评论场景下的 superseded 去重判定
- 保持 selector 改名后的 inherited/actionable 与 direct/superseded 分区一致
- 补齐迁移后重复评论的定向 Playwright 验收
- 已再次通过全量 `npm run verify:iteration`

### 下一切片

优先顺序：

1. Phase 3.4：继续评估 selector、excerpt、domContext 都漂移后的 web 锚点 stale/fallback 边界
2. Phase 4.4：继续评估剩余 raw `code` 兼容路径，尽量限制在 create/tool/runtime 内部实现层
3. 继续检查是否还有共享 copy / prompt / workflow fallback 会把旧类型术语带回主语义

## 验收记录

- 2026-03-18：项目级 AI 上下文切片已通过 `npm run verify:iteration`，作为本工作流前提。
- 2026-03-18：统一交付模型 tracker 建立，用于持续记录阶段状态、当前切片和验证结果。
- 2026-03-18：Phase 1 创建流去类型化完成，`npm run verify:iteration` 全绿，结果为 `42 passed (1.1m)`。
- 2026-03-18：Phase 4.1 `Status` 面板人工类型切换清理完成，定向 Playwright 全绿后再次通过 `npm run verify:iteration`，结果为 `42 passed (1.2m)`。
- 2026-03-18：Phase 2.1 `document + slide_page` 投影完成，定向 Playwright 全绿后再次通过 `npm run verify:iteration`，结果为 `42 passed (1.2m)`。
- 2026-03-18：Phase 2.2 `slides` 公共默认语义收口完成，清掉独立 `slides` blueprint / label 默认路径与旧重整文案后，再次通过 `npm run verify:iteration`，结果为 `42 passed (1.2m)`。
- 2026-03-18：Phase 3.2 第一刀 web 锚点绑定与继承重定位完成，定向 `tests/e2e/iteration/15-web-preview-comments.spec.ts` 全绿后再次通过 `npm run verify:iteration`，结果为 `43 passed (1.5m)`。
- 2026-03-19：Phase 3.2 第二刀 web-component revision / preview 回流收口，补齐 preview/start 在 reload 场景下的恢复链路；定向 `tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts` 与 `--repeat-each=3` 通过后，再次通过 `npm run verify:iteration`，结果为 `44 passed (1.2m)`。
- 2026-03-19：Phase 2.3 `slides` 旧 API / payload 归一化收口完成，create / plan / replan / assistant payload 不再把 `slides` 当成独立新写入类型；定向 `tsc` 与 create/slides/web 相关 Playwright 通过后，再次通过 `npm run verify:iteration`，结果为 `44 passed (1.2m)`。
- 2026-03-19：Phase 4.2 旧结果形态术语与 dead copy 清理完成，workflow draft / replan / first-pass / tool 描述统一改成 result-shape 语义，并删除未使用的 deliverable-type 旧 key；静态检查通过后再次通过 `npm run verify:iteration`，结果为 `44 passed (1.2m)`。
- 2026-03-19：Phase 3.3 迁移后重复评论的 superseded 收口完成，高信号 identity candidate 会把“新位置上的 direct 评论”与旧 inherited 线程判成覆盖关系；定向 `tsc` 与 `tests/e2e/iteration/15-web-preview-comments.spec.ts` 通过后，再次通过 `npm run verify:iteration`，结果为 `45 passed (1.3m)`。
- 2026-03-19：Phase 4.3 `code` 公共 canonical 语义收口完成，共享 helper / label / plan blueprint / 默认推断现在只认 `document | web`；定向 `tsc` 与 create/workflow/slides/web 相关 Playwright 通过后，再次通过 `npm run verify:iteration`，结果为 `45 passed (1.3m)`。

## 进度更新规则

- 每完成一个 bounded slice，必须更新：
  - 当前阶段状态
  - 当前切片进度
  - 验收记录
- 每次 `npm run verify:iteration` 后，都要在本文件追加结果，并立刻判断下一切片是否继续推进。
