# 成形统一交付模型进度追踪

更新时间：2026-03-20
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
  - 公共 `DeliverableType` 契约已收成 canonical `document | web`，但 `slides / code` 仍留在部分 stored plan / read compatibility 分支里，尚未彻底压回更深的内部兼容层
  - `slide_page` 与 web anchor 的主闭环已完成，但仍需继续复查剩余兼容层，避免旧类型语义从 helper / type alias 回流

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
| Phase 3 | web 画词评论闭环 | 已完成 | 已完成 Phase 3.1 同源 preview bridge、选区评论创建和 Review 回放高亮；已完成 Phase 3.2：锚点绑定、继承重定位、`@assistant` revision run 与 preview run 回流；已完成 Phase 3.3：迁移后重复评论的 superseded 收口；已完成 Phase 3.4：selector / excerpt / domContext 全漂移时的 stale 边界收口 |
| Phase 4 | 语义收口与 plan 动态化 | 进行中 | 已完成 Phase 4.1 `Status` 面板人工类型切换清理；已完成 Phase 4.2 旧结果形态术语与 dead copy 清理；已完成 Phase 4.3 `code` 公共 canonical 语义收口；已完成 Phase 4.4 legacy `code` create / runtime 默认折回 `document`；已完成 Phase 4.5 slide 结果面旧类型文案清理；已完成 Phase 4.6 `fileKind=code` 残余推断收口；已完成 Phase 4.7 公共 `DeliverableType` 契约与 stored legacy type 拆分；已完成 Phase 4.8 prompt/tool/project-context 的 result-shape 术语收口；已完成 Phase 4.9 `implementation` 残留心智文案清理；已完成 Phase 4.10 AI debug / inspection plan 详情 canonical 收口 |

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

### 已完成：Phase 4.4 legacy `code` create / runtime 默认归一

目标：

- 把剩余还会主动长出 `code` 主路径的 create / runtime 默认值继续压回 `document`
- 避免 legacy `code` 请求继续生成 `index.ts`、`kind=code` 这类新的主文件默认值
- 让 plan / live draft / create route 在收到旧 `code` 输入时也保持当前产品只认 `document | web` 的外层语义

当前进度：

- `src/app/api/workspaces/route.ts` 已把 create route 的非 web 请求统一折回 `document`，并删除 `deliverableType=code` 的专属 file seed；legacy `code` 创建现在默认生成 `main` + `markdown`
- `src/lib/ai/pi-agent-tools.ts` 已把 live draft upsert 的默认 `kind / path` 折回 `markdown / main`，不再继续给 legacy `code` 生成 `index.ts`
- `src/lib/workspace/planning.ts` 已删除 `code` 专属阶段 fallback；legacy `code` 现在和文档一样走 `draft / review` 主路径，而不是继续落到 `implement / verify`
- `tests/e2e/iteration/10-deliverable-intent.spec.ts` 已补 API 级回归，确保 legacy `code` 创建请求不会再生成新的 `index.ts` 主文件
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/10-deliverable-intent.spec.ts tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 legacy `code` 在 create route / live draft / plan runtime 默认值上的继续收口
- 保留底层 file kind 兼容，但不再让新的主文件默认语义长回 `code`
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 4.5 slide 结果面旧类型文案清理

目标：

- 清掉 slide 结果面还在直接使用旧 create-time 类型词的文案
- 删除共享 copy 表里已经不再被消费的旧 `slides / implementation / deliverableTypeChanged` 残留 key
- 用一个稳定 E2E 断言防止 slide 结果壳再次回流旧类型标签

当前进度：

- `src/app/workspace/[workspaceId]/page.tsx` 已把 slide 结果面的 badge 从 `goal.slides` 改成新的 `workspace.slideResultBadge`，明确表述当前结果面，而不是旧的创建类型
- `src/lib/i18n/copy.ts` 已删除不再被消费的 `goal.slides`、`goal.slidesDescription`、`goal.implementation`、`workspace.deliverableTypeChanged` 等残留 key，并补 `workspace.slideResultBadge`
- `tests/e2e/iteration/12-slides-blocks.spec.ts` 已补 slide 结果面 badge 断言，确认当前展示的是 `Slide View / 幻灯片视图`，而不是旧的 `Presentation / 演示稿`
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/12-slides-blocks.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 slide 结果面的当前表面文案收口
- 清掉一批不再被消费的旧类型 dead copy key
- 补齐 slide 结果面 badge 的定向 Playwright 验收

### 已完成：Phase 4.6 `fileKind=code` 残余推断收口

目标：

- 清掉共享类型推断里“只要 primary file kind 是 `code` 就直接推成 web”的残余分支
- 避免无 plan 或 legacy plan 缺失的交付物，在项目级 AI 摘要、工具上下文和结果面推断里被误标成网页
- 用项目级 AI context 的可执行回归覆盖这条边界，而不是只靠静态代码审查

当前进度：

- `src/lib/workspace/planning.ts` 已删除 `input.fileKind === 'code' -> web` 的直推条件；只有 goal / title / file path 等 corpus 明确出现网页信号时，才会继续推断为 `web`
- `tests/e2e/iteration/14-project-ai-context.spec.ts` 已新增 API 级回归：直接把同项目兄弟交付物改成 `primary file kind=code` 且删除其 plan，再验证项目级 AI context 仍将其摘要成 `document`，不会误标成 `web`

已完成项：

- 完成共享 deliverable 推断里的 `fileKind=code` 残余语义清理
- 补齐“无 plan + code-like primary file”下的项目级 AI context 回归
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 4.7 公共 `DeliverableType` 契约与 stored legacy type 拆分

目标：

- 让公共类型契约真正表达当前产品承认的 canonical 语义，而不是继续把 legacy `slides / code` 混在同一个 `DeliverableType` union 里
- 把存量计划值和旧结果面兼容显式收进 stored legacy 字段，避免 helper、workspace view 和 AI context 再从类型别名层把旧语义带回产品表面
- 用一个可执行回归同时守住两条边界：无 plan 的 code-like 文件仍按 `document` 摘要；stored `slides` 仍能通过统一 slide surface 打开

当前进度：

- `src/types/index.ts` 已把公共 `DeliverableType` 收成 `document | web`，并新增显式 `LegacyDeliverableType` 与 `storedDeliverableType`
- `src/lib/workspace/deliverable-types.ts` 已补 `parseStoredDeliverableType`，公共 helper 统一读取 canonical 语义，legacy `slides / code` 只在 stored/read compatibility 层保留
- `src/lib/workspace/service.ts`、`src/lib/ai/pi-agent-tools.ts`、`src/lib/workspace/planning.ts`、`src/app/workspace/[workspaceId]/page.tsx` 已改成“对外走 canonical deliverable，对内按 stored legacy 做兼容投影”
- `src/app/api/debug/workspaces/[workspaceId]/plan/route.ts` 已补 `PATCH`，仅在 `DAO_E2E=1` 下允许把 raw stored deliverable type 改成 legacy 值，方便稳定验旧
- `tests/e2e/iteration/12-slides-blocks.spec.ts` 已补“stored `slides` 仍会进入统一 slide surface”的回归；`tests/e2e/iteration/14-project-ai-context.spec.ts` 继续守住“无 plan + code-like primary file 不会误判成 web”
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/12-slides-blocks.spec.ts tests/e2e/iteration/14-project-ai-context.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成公共 `DeliverableType` 与 stored legacy type 的显式拆分
- 保持 legacy `slides` 结果面兼容与无 plan code-like 摘要边界不回退
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 4.8 prompt/tool/project-context 的 result-shape 术语收口

目标：

- 清掉 plan generator、workspace tool summary 和项目级 AI 上下文里残留的 `Deliverable type` / `Type` 旧术语
- 确保这些 prompt-facing 摘要统一输出 canonical `result shape`，不把 stored legacy 值直接回流给 AI
- 用现有项目级 AI context 回归覆盖这条文案与语义边界，而不是只做静态搜索

当前进度：

- `src/lib/ai/plan-generator.ts` 已把 prompt 输入里的 `Deliverable type` 改成 `Result shape`
- `src/lib/ai/pi-agent-tools.ts` 已把 `get_workspace_context` 和 `read_project_deliverable_file` 的摘要文案统一改成 `Result shape`，并在 workspace brief 里显式 canonicalize stored plan deliverable 语义
- `src/lib/ai/project-context.ts` 已把项目交付物列表摘要从 `(document, status: ...)` 改成 `(shape: document, status: ...)`，避免把 canonical 值继续按“type”语义拼进 AI 上下文
- `tests/e2e/iteration/14-project-ai-context.spec.ts` 已更新并补充断言，覆盖 system prompt、workspace context tool 和 sibling read tool 的新 `result shape` 语义
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/14-project-ai-context.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 plan/tool/project-context 的 prompt-facing result-shape 术语收口
- 保持项目级 AI context 的 canonical 语义和 sibling read 能力不回退
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 4.9 `implementation` 残留心智文案清理

目标：

- 清掉首页引导、通用 AI 指令和 plan blueprint 里还会把 `implementation` 当成主要结果形态示例的残留文案
- 避免产品明明已经收成“结果形态 + supporting/source asset”语义，但首页和通用提示仍在偷偷把用户往旧 `code/implementation` 心智上带
- 用最小改动收掉这一簇 copy residue，不引入新的交互分支

当前进度：

- `src/lib/i18n/copy.ts` 已把首页 hero 文案里的 “report, proposal, page, or implementation” 改成更中性的 “report, proposal, page, or result”
- `src/lib/ai/context-builder.ts` 已把通用 AI 指令里的 `implementation asset / implementation details` 改成 `supporting asset / source details`
- `src/lib/workspace/plan-blueprints.ts` 已把 web review 阶段默认描述从 `implementation` 改成更贴近结果面的 `interaction details`
- 定向 `npx tsc --noEmit` 已通过

已完成项：

- 完成首页、通用 AI 指令和 web plan blueprint 的 `implementation` 残留文案清理
- 保持现有统一结果形态语义不回退
- 已再次通过全量 `npm run verify:iteration`

### 已完成：Phase 4.10 AI debug / inspection plan 详情 canonical 收口

目标：

- 避免 `get_workspace_context` 的 debug / inspection `details.workspacePlan` 继续把 raw stored `slides / code` 直接暴露给调试面和 E2E 辅助链路
- 让 AI 调试视图和正式产品面使用同一套 canonical `deliverableType + storedDeliverableType` 语义，而不是 summary 已收口、details 仍泄漏 legacy 值
- 用一条可执行回归守住“legacy `slides` 只在 stored compatibility 层可见”的边界

当前进度：

- `src/lib/ai/pi-agent-tools.ts` 已为 `get_workspace_context` 增加 debug plan details 归一逻辑；返回的 `workspacePlan` 现在显式区分 canonical `deliverableType` 与 `storedDeliverableType`
- `tests/e2e/iteration/14-project-ai-context.spec.ts` 已新增调试面回归：当 raw stored deliverable type 被设成 `slides` 时，tool summary 仍显示 `Result shape: document`，而 `details.workspacePlan` 只会暴露 `deliverableType=document` 与 `storedDeliverableType=slides`
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/14-project-ai-context.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 AI debug / inspection plan details 的 canonical 收口
- 补齐 legacy stored type 只留在 compatibility 字段的定向 Playwright 验收
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

### 已完成：Phase 3.4 web stale/fallback 边界收口

目标：

- 避免旧 web 继承线程只因为页面里还残留零散 selector token，就被错误地继续判成 actionable
- 让 `selector / excerpt / domContext` 都漂移后的旧线程稳定进入 `stale`
- 把 web 线程可重定位的判断标准从弱 token 命中收紧到真正能反证“当前表面仍是同一目标”的强信号

当前进度：

- `src/app/api/threads/route.ts` 已把 `web-component` 线程的当前表面映射判断拆成独立分支，不再沿用普通文本线程的弱匹配逻辑
- web stale 判定现在只接受三类强信号：完整 selector 或其稳定 `id` 来源、完整 excerpt、完整 domContext 或至少两个稳定上下文片段；仅剩零散 selector token 时不会再误判为可重定位
- `tests/e2e/iteration/15-web-preview-comments.spec.ts` 已新增“selector、excerpt、domContext 都漂移后旧线程变 stale”的回归，并刻意保留无关 `hero-*` token 验证不会假阳性存活
- 定向 `npx tsc --noEmit` 与 `npx playwright test tests/e2e/iteration/15-web-preview-comments.spec.ts --config=playwright.config.ts` 已通过

已完成项：

- 完成 web 继承线程 stale/fallback 边界的强信号收口
- 清掉 selector token 残留导致 inherited 线程假阳性存活的判定路径
- 补齐“完全漂移 -> stale / Earlier Context” 的定向 Playwright 验收
- 已再次通过全量 `npm run verify:iteration`

### 下一切片

优先顺序：

1. 继续审计更深层 stored plan / create / read fallback，确认 `slides / code` 不会从内部兼容分支重新泄漏到公共 view model
2. 继续复查 Phase 2 / Phase 3 的交叉边界，确认 `slide_page` 投影和 web anchor 兼容层不会重新长回旧类型分支
3. 继续扫描剩余共享 copy / blueprint fallback，确认不再有新的 `implementation / legacy result-shape` 语义回流点

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
- 2026-03-19：Phase 3.4 web stale/fallback 边界收口完成；web 继承线程只有在 selector / excerpt / domContext 仍有强源证据时才保持 actionable，三者都漂移时会稳定转入 `stale`；定向 `tsc` 与 `tests/e2e/iteration/15-web-preview-comments.spec.ts` 通过后，再次通过 `npm run verify:iteration`，结果为 `47 passed (1.3m)`。
- 2026-03-19：Phase 4.4 legacy `code` create / runtime 默认归一完成；旧 `code` 请求现在会落到 `main + markdown` 和文档式阶段默认，而不会继续生成新的 `index.ts` 主路径；定向 `tsc` 与 create/web 相关 Playwright 通过后，再次通过 `npm run verify:iteration`，结果为 `47 passed (1.3m)`。
- 2026-03-19：Phase 4.5 slide 结果面旧类型文案清理完成；slide 结果壳改用 `Slide View / 幻灯片视图` 这类当前视图语义，并删除不再被消费的旧 `slides / implementation / deliverableTypeChanged` copy key；定向 `tsc` 与 `tests/e2e/iteration/12-slides-blocks.spec.ts` 通过后，再次通过 `npm run verify:iteration`，结果为 `47 passed (1.7m)`。
- 2026-03-19：Phase 4.6 `fileKind=code` 残余推断收口完成；共享 deliverable 推断不再因为 primary file `kind=code` 就把无 plan 的历史交付物误标成 `web`，项目级 AI context 已补 API 级回归；定向 `tsc` 与 `tests/e2e/iteration/14-project-ai-context.spec.ts` 通过后，再次通过 `npm run verify:iteration`，结果为 `48 passed (1.8m)`。
- 2026-03-19：Phase 4.7 公共 `DeliverableType` 契约与 stored legacy type 拆分完成；workspace view、公共 helper 和项目级 AI context 对外只再暴露 canonical `document | web`，legacy `slides / code` 改为显式 stored compatibility 语义；定向 `tsc` 与 `tests/e2e/iteration/12-slides-blocks.spec.ts`、`tests/e2e/iteration/14-project-ai-context.spec.ts` 通过后，再次通过 `npm run verify:iteration`，结果为 `49 passed (1.7m)`。
- 2026-03-19：Phase 4.8 prompt/tool/project-context 的 result-shape 术语收口完成；plan generator、workspace tools 和项目级 AI 摘要不再使用 `Deliverable type / Type` 旧文案，且 workspace brief 会先 canonicalize stored plan deliverable 语义后再注入 prompt；定向 `tsc` 与 `tests/e2e/iteration/14-project-ai-context.spec.ts` 通过后，再次通过 `npm run verify:iteration`，结果为 `49 passed (1.7m)`。
- 2026-03-19：Phase 4.9 `implementation` 残留心智文案清理完成；首页 hero、通用 AI 指令和 web plan blueprint 不再把 `implementation` 当作统一结果形态的主示例；定向 `tsc` 通过后，再次通过 `npm run verify:iteration`，结果为 `49 passed (1.8m)`。
- 2026-03-20：Phase 4.10 AI debug / inspection plan 详情 canonical 收口完成；`get_workspace_context` 的 debug details 不再直接泄漏 raw stored `slides / code`，而是显式返回 canonical `deliverableType` 与 `storedDeliverableType`；定向 `tsc` 与 `tests/e2e/iteration/14-project-ai-context.spec.ts` 通过后，再次通过 `npm run verify:iteration`，结果为 `50 passed (2.0m)`。

## 进度更新规则

- 每完成一个 bounded slice，必须更新：
  - 当前阶段状态
  - 当前切片进度
  - 验收记录
- 每次 `npm run verify:iteration` 后，都要在本文件追加结果，并立刻判断下一切片是否继续推进。
