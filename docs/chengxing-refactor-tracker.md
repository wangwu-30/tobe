# 成形重构追踪器

更新时间：2026-03-20
状态：active
来源计划：[refactor_plan.md](../refactor_plan.md)

## 当前工作流范围

本追踪器只服务当前这轮“地基沉淀 + 成形重构”workstream。

- 当前范围只看本次讨论确认的重构计划与后续落地进度。
- 旧的产品收口计划、维护状态或历史 backlog 不参与本追踪器的切片选择。
- 只有当本轮切片真的改变了已上线事实时，才回写项目状态类文档。

## 已确认决策

- 本 workstream 由通用 skill `program-autopilot` 驱动，不使用 repo 旧的 `chengxing-autopilot` 作为主追踪器。
- `program-autopilot` 需要支持当前 workstream override、contract docs、tracker bootstrap 和 workstream-local stop gate。
- 当前重构不是单纯目录搬迁，目标边界是统一 runtime、对象模型、derive 层和 renderAs 扩展缝。
- Agent 边界按 `Context + ToolKit + Persona + Policy + RenderAdapter` 理解，而不是只按前三项。
- 迁移顺序遵循“先统一内部 runtime，再统一外部 route”。
- Phase 2 对 `service.ts` 设止损点：压到约 1500-1800 行后，剩余 `restore / continue / switch branch` 这类版本主流程改在 Phase 3 配合 Label 模型一起收口，不在 Phase 2 里硬拆完。
- Phase 2 的当前主线优先转向 `src/app/workspace/[workspaceId]/page.tsx`，继续拆 sidebar 渲染、dialog 管理、版本比较和其他不依赖 Phase 3 版本模型的页面逻辑。
- 通用知识库是非阻塞副线，可以在切片间隙持续积累，但不抢占当前主重构顺序。
- 地基分两层：
  - 仓库内合约文档：当前 workstream 的强绑定地基，优先落地。
  - 仓库外通用知识库：持续沉淀，但不阻塞主重构。
- 对于会改动产品代码或行为的完整切片，结束前必须运行 `npm run verify:iteration`。
- 仅修改 skill / tracker / 纯文档 bootstrap 的切片，可以记录为 `未跑 verify（无产品代码变更）`。

## Phase 状态

| Phase | 名称 | 状态 | 说明 |
| --- | --- | --- | --- |
| 0 | Autopilot / Tracker Bootstrap | done | 已确定主 skill、补齐通用 skill 规则并创建本追踪器。 |
| 1 | 合约文档 | done | 已创建四份合约文档，并在 `AGENTS.md` 挂接项目合约与 refactor tracker 读序。 |
| 2 | 巨石拆分 | in_progress | 先抽 façade，再做目录和文件迁移。 |
| 3 | 版本系统优雅化 | todo | 建立 `State + Label + Draft` 边界并逐步脱离旧版本分类字段。 |
| 4 | 评论系统优雅化 | todo | 让分类与监听状态尽量回到推导层与 action 边界。 |
| 5 | Agent 统一 | todo | 先统一内部 runtime，再收口外部 route。 |
| 6 | 清理收口 | todo | 合并 Note、删旧壳、补规则与文档。 |

## 当前切片

切片目标：完成 Phase 2 的第三十一个切片，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 `workspaceShellActions` 提到独立 surface / helper，继续压缩 route 页本身，同时保留 sibling deliverable 入口、view 菜单、preview start/stop 和实现态切换行为。

当前切片退出条件：

- `page.tsx` 不再直接持有 `workspaceShellActions` 这块 header action JSX 主体
- sibling deliverable 按钮、实现态切换、pane swap、preview start/stop / open preview 行为保持不变
- 相关文案、图标和禁用态继续由现有 route 状态驱动，不在这一刀里改交互语义
- `WorkspaceScreen` 继续只消费上层传入的 actions 节点，不额外回流业务逻辑
- 不在这一刀里同时改 goal dialog 管理或 version compare 逻辑
- 延续“先 façade、后迁移”的拆分方式，不做纯目录迁移式拆分
- 若改动了产品代码或行为，完成前运行 `npm run verify:iteration`

## 下一候选切片

1. Phase 2：继续拆 `page.tsx`，优先看 goal/dialog 管理、版本比较以及其他仍挂在 route 页上的重型 surface 组装逻辑。
2. Phase 2：当 `service.ts` 压到约 1500-1800 行前，可按止损点评估是否还值得继续拆非 Phase 3 依赖的 service 簇；其余版本主流程留给 Phase 3。
3. Phase 3：在 runtime 边界稳定后推进 `State + Label + Draft`。

## 剩余验收项

- 合约文档存在且与本次讨论一致。
- skill 与 tracker 能把下一轮 autopilot 固定在当前 workstream，而不是旧计划面。
- 后续每个 phase 都要补 phase 状态、当前切片、verification history。
- 任何修改产品代码的切片都要记录 `npm run verify:iteration` 结果。

## Blockers

当前无阻塞。

## Verification History

- 2026-03-20：完成 Phase 2 切片 30，新增 `src/surfaces/sidebar/workspace-sidebar.tsx`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 `renderWorkspaceSidebar` prop 组装与 version-view guard 下沉到独立 surface adapter，并把 route 页压到 2507 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 29，扩展 `src/objects/state/commands.ts` 与 `src/objects/state/index.ts`，把 `src/lib/workspace/service.ts` 里的 `restoreWorkspaceVersion` 提到 state command cluster，并继续由 `service.ts` façade 注入 `ensureWorkspaceEditable / listWorkspaceRuns / materializeWorkspaceMirror / startWorkspacePreview / bindDraftThreadsToVersion / recordSyncEvent`；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 28，扩展 `src/objects/state/commands.ts` 与 `src/objects/state/index.ts`，新增 `src/objects/state/draft-commands.ts` / `src/objects/state/shared.ts`，把 `src/lib/workspace/service.ts` 里的 `setWorkspaceVersionPinned` 与 `WorkspaceRecoveryPinLimitError` 收进 state command cluster，并让 `service.ts` 继续作为 façade 出口；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 27，扩展 `src/objects/state/commands.ts` 与 `src/objects/state/index.ts`，把 `src/lib/workspace/service.ts` 里的 `createWorkspaceVersion` 提到 state command module，并继续由 `service.ts` façade 注入 `ensureWorkspaceEditable / bindDraftThreadsToVersion / recordSyncEvent`；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 26，扩展 `src/objects/state/commands.ts` 与 `src/objects/state/index.ts`，把 `src/lib/workspace/service.ts` 里的 `replaceWorkspaceDraftWithVersionFiles` 提到 state command module，并继续由 `service.ts` façade 注入 `materializeWorkspaceMirror / startWorkspacePreview`；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 25，新增 `src/objects/state/commands.ts`，把 `src/lib/workspace/service.ts` 里的 `pruneWorkspaceRecoveryCheckpoints` 提到 state command module，并让 `service.ts` 继续作为过渡出口；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 24，扩展 `src/objects/file/commands.ts` 与 `src/objects/file/index.ts`，把 `src/lib/workspace/service.ts` 里的 `deleteWorkspaceFile` 提到 file object command module，并通过依赖注入继续由 `service.ts` 提供 `ensureWorkspaceEditable` guard；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 23，扩展 `src/objects/file/commands.ts` 与 `src/objects/file/index.ts`，把 `src/lib/workspace/service.ts` 里的 `updateWorkspaceFile` 提到 file object command module，并通过依赖注入继续由 `service.ts` 提供 `ensureWorkspaceEditable` guard；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 22，扩展 `src/objects/file/commands.ts` 与 `src/objects/file/index.ts`，把 `src/lib/workspace/service.ts` 里的 `createWorkspaceFile / ensureSupportUploadsFolder` 提到 file object command module，并通过依赖注入继续由 `service.ts` 提供 `ensureWorkspaceEditable` 这层 guard；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 21，新增 `src/objects/state/schema.ts`、`src/objects/state/queries.ts` 与 `src/objects/state/index.ts`，把 `src/lib/workspace/service.ts` 里的 `normalizeWorkspaceVersionType / resolveDraftBaseVersionIdForVersion / findNearestVersionBeforeMessage` 提到 state object schema/query module，并让 `service.ts` 继续作为过渡出口；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 20，扩展 `src/objects/project/queries.ts`，把 `buildProjectFolders` 从 `src/lib/workspace/service.ts` 提到 project query module，并移除 `buildCurrentProjectSummary` 这层空 wrapper，改为在 view builder 中直接复用 `buildProjectSummary`；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 19，新增 `src/objects/file/commands.ts`，把 `src/lib/workspace/service.ts` 里的 `ensureWorkspaceFiles / rebuildDescendantPaths` 抽到 file object command module，并让 `service.ts` 继续作为过渡出口；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 18，新增 `src/objects/file/schema.ts` 与 `src/objects/file/index.ts`，把 `src/lib/workspace/service.ts` 里的 file object 纯函数簇（schema mapping、version payload 解析、path/default/infer helper）抽到独立 object module，并让 `service.ts` 继续作为导出兼容层；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 17，新增 `src/objects/project/queries.ts`，把 `src/lib/workspace/service.ts` 里的 project query 簇抽到 object query module，并让 `service.ts` 继续作为过渡出口；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 16，新增 `src/canvas/document-canvas/document-canvas.tsx`，把 deliverable panel、canvas helper 与 outline/plate 相关工具从 `src/app/workspace/[workspaceId]/page.tsx` 提到独立 canvas 模块，并让 route 页继续只保留数据装配与状态编排；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 15，新增 `src/surfaces/status-panel/status-panel.tsx`、`src/surfaces/review-panel/review-panel.tsx`、`src/surfaces/assistant-panel/assistant-panel.tsx`、`src/surfaces/context-panel/context-panel.tsx`，把 assistant rail 的四个 panel slot 从 `src/app/workspace/[workspaceId]/page.tsx` 下沉到独立 surface，并让 route 页继续只保留 panel 数据装配与回调透传；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 14，新增 `src/surfaces/workspace/workspace-screen.tsx`，把 workspace route 的主渲染壳从 `src/app/workspace/[workspaceId]/page.tsx` 提到独立 surface，并让 route 页只保留 sidebar/actions/panel/dialog 的数据装配与透传；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 13，新增 `src/lib/workspace/file-client.ts`，把 workspace 文本文件 autosave 的 `PATCH /files/:id` request 从 `src/app/workspace/[workspaceId]/page.tsx` 抽成薄 helper，并让页面只保留 optimistic content 回写、debounce 编排与 saving indicator；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 12，新增 `src/lib/workspace/read-client.ts`，把 workspace 读侧的 `view / runs / threads` request 从 `src/app/workspace/[workspaceId]/page.tsx` 抽成同域 read helper，并让页面只保留结果回写、editor reset 与轮询编排；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 11，扩展 `src/lib/workspace/create-request.ts`，把 workspace create surface 的 request / response / recovery builder 抽成共享 helper，并让 `src/app/page.tsx` 与 `src/app/workspace/[workspaceId]/page.tsx` 共用同一套 transport 契约；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 10，扩展 `src/lib/workspace/plan-client.ts`，把 `applyWorkflowPlaybook` request 从 `src/app/workspace/[workspaceId]/page.tsx` 抽成同域 helper，并让页面只保留 workspace plan 回写与 success notice；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 9，新增 `src/lib/workspace/project-client.ts`，把 sidebar project rename / delete request 从 `renderSidebar` 内联回调抽成 client helper，并让 `page.tsx` 只保留当前 project title 回写、notice 与 router 跳转；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 8，新增 `src/lib/workspace/project-tree-client.ts`，把 project folder 的 create / rename / delete / move / reorder 与 deliverable 的 rename / delete / move / reorder request 从 `page.tsx` 抽成同域 helper；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 7，新增 `src/lib/workspace/support-files-client.ts`，把 create / rename / move / delete support file request 从 `page.tsx` 抽成同域 helper，并让 reorder 复用同一 move helper；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 6，扩展 `src/lib/workspace/version-client.ts`，把 branch from message / continue from version / switch branch request 从 `page.tsx` 抽成同域 helper；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 5，新增 `src/lib/workspace/version-client.ts`，把 create version / pin recovery point / restore version request 从 `page.tsx` 抽成 client helper，并补齐统一错误解析；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 4，新增 `src/lib/workspace/preview-client.ts`，把 preview start / stop request 与错误解析从 `page.tsx` 抽成 client helper，并补齐 stop-preview 的网络错误 notice；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 3，新增 `src/agent/response.ts`，把 agent stream 的 ok/error 解析、workspace header 解析和文本流消费从 `use-chat.ts` 抽成 helper；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 2，新增 `src/agent/messages.ts`，把本地 attachment / user / assistant draft 构造从 `use-chat.ts` 抽进 `src/agent`；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 1，新增 `src/agent/run.ts` 与 `src/framework/agent/stream.ts`，让 `use-chat.ts` 改为依赖 façade 处理 request/stream/timeout 边界；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 1 合约文档 bootstrap，新增 `SYSTEM.md / CONVENTIONS.md / CONSTRAINTS.md / PATTERNS.md`，并更新 `AGENTS.md`；未运行 `npm run verify:iteration`，因为本切片只涉及文档与执行约束。
- 2026-03-20：回写 `refactor_plan.md`，纳入 Phase 0、当前 workstream tracker、`Policy + RenderAdapter` 边界，以及“先统一内部 runtime、后统一外部 route”的迁移顺序。
- 2026-03-20：初始化重构追踪器；未运行 `npm run verify:iteration`，因为本切片只涉及 skill / tracker / 纯文档 bootstrap。

## 维护规则

- 每完成一个切片，先更新本追踪器，再决定是否继续下一切片。
- 若切片改变了合约或可复用经验，同时更新对应合约文档和 `docs/chengxing-lessons-learned.md`。
- 若切片改变了已上线事实，再回写项目状态文档；否则不要让旧状态文档重新成为当前 workstream 的主追踪面。
