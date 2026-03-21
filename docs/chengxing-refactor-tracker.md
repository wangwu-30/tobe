# 成形重构追踪器

更新时间：2026-03-21
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
- Phase 2 在 `page.tsx` 退回 route 适配壳、`service.ts` 只剩 Phase 3 相邻的版本主流程与零碎 helper 后视为达到 stop gate；Phase 3 先走 additive Label bootstrap，再迁移旧 `versionType` 语义。
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
| 2 | 巨石拆分 | done | `page.tsx` 已退回 route 适配壳，`service.ts` 的非 Phase 3 seam 基本抽空，并按 stop gate 在 1844 行收口。 |
| 3 | 版本系统优雅化 | done | 已把 `Label` 合约扩到 `milestone/head/recovery/pinned`，补齐 recovery/pinned 回填与写侧 lifecycle，并让应用层停止读取 `Version.versionType`。 |
| 4 | 评论系统优雅化 | done | thread/comment read side 的 active agent watching 已切到 message history derive，`agentBindingsJson` 退回写侧兼容。 |
| 5 | Agent 统一 | done | `/api/agent/run` 已统一承接 chat / research-plan / comment-reply / suggest-edit / extract-memory，旧 AI route 已全部删除。 |
| 6 | 清理收口 | in_progress | 旧 AI adapter route、`src/lib/wiki/` 兼容壳、dead alias 与 framework import guard 已完成；`Knowledge + Memory -> Note` 因对象契约差距待决。 |

## 已冻结的 non-chat `/api/agent/run` envelope

- `comment-reply`
  - `mode: 'comment-reply'`
  - `target: { threadId, workspaceId?, agentId? }`
  - `input: { anchorText?, documentContent? }`
  - `model?`
- `suggest-edit`
  - `mode: 'suggest-edit'`
  - `target: { workspaceId? }`
  - `input: { anchorText, threadDiscussion, documentContent? }`
  - `model?`
- `extract-memory`
  - `mode: 'extract-memory'`
  - `target: { threadId }`
  - `model?`
- 旧 `/api/ai/*` adapter 继续接受 legacy 平铺字段，但只在 adapter 层兼容；共享入口与 repo docs 统一以上述 `mode + target + input` 契约为准。

## 当前切片

切片目标：进入 Phase 6 的第七十个切片，在确认 `Knowledge + Memory -> Note` 的对象契约后，执行 additive schema / migration / Context UI 收口。

当前切片退出条件：

- 确认 `Note` 是否需要补 `title` / category taxonomy 等字段，能无损承接现有 `KnowledgeItem` 与 `Memory` 的用户可见语义
- 明确 `source` / `sourceRef` 如何覆盖 `KnowledgeItem.sourceType` 与 `Memory.sourceThreadId`
- 确定 Context 面板是继续保留 `Knowledge / Memory` 双分区，还是改成单 `Note` 视图加过滤
- 在上述决策明确前，不启动 Note 表、route 或迁移代码

## 下一候选切片

1. Phase 6：确认 `Knowledge + Memory -> Note` 的对象契约后，执行 Note schema / migration / route / view 收口。
2. Phase 6：回写 `SYSTEM.md` / `docs/chengxing-project-status.md`，把 Phase 6 的完成态文档收口清楚。
3. Phase 6：回顾本轮可复用的工程经验，补仓库外通用知识沉淀。

## 剩余验收项

- 合约文档存在且与本次讨论一致。
- skill 与 tracker 能把下一轮 autopilot 固定在当前 workstream，而不是旧计划面。
- 后续每个 phase 都要补 phase 状态、当前切片、verification history。
- 任何修改产品代码的切片都要记录 `npm run verify:iteration` 结果。

## Blockers

- `SYSTEM.md` 里的 `Note` 目前只有 `{ id, scope, scopeId, kind, content, source, sourceRef?, active }`，不足以无损表达 `KnowledgeItem.title/sourceType` 与 `Memory.category/sourceThreadId/active`；`src/components/knowledge/knowledge-panel.tsx` 与 AI context builder 也仍把二者当成不同用户语义。详情见 [docs/chengxing-note-merge-brief.md](./chengxing-note-merge-brief.md)。
- 在 Note contract 决策明确前，Phase 6 的 6a 不继续落 schema / route / migration 代码；其余只做与该阻塞无关的文档沉淀。

## Verification History

- 2026-03-21：完成 Phase 6 切片 69，盘点 `Knowledge + Memory -> Note` 的真实差距，新增 [docs/chengxing-note-merge-brief.md](./chengxing-note-merge-brief.md) 并把 blocker 回写 tracker / `refactor_plan.md`；未跑 `npm run verify:iteration`（无产品代码变更）。
- 2026-03-21：完成 Phase 6 切片 68，为 `src/framework/**` 补 scoped `no-restricted-imports` guard，禁止反依赖 `objects / derive / canvas / surfaces / agent`，并覆盖常见相对路径绕行；`npx eslint src/framework --max-warnings=0` 与 `npm run verify:iteration` 均通过（50 passed）。
- 2026-03-21：完成 Phase 6 切片 67，把 `src/app/api/{knowledge,memories,conversations,threads/**}` 对 `@/lib/wiki/service` 的剩余依赖全部改指向 canonical `workspace/service` 或 object view seam，删除 `src/lib/wiki/service.ts`、`src/lib/workspace/service.ts` 里的 wiki compatibility export，以及 `src/types/index.ts` 中未再使用的 `Wiki* / SessionWithRelations / DocumentData / VersionData` alias；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 66，把 `src/hooks/use-ai-reply.ts` 与 `src/components/comments/comment-sidebar.tsx` 的剩余 caller 切到统一 `/api/agent/run` non-chat envelope，删除旧 `src/app/api/ai/{chat,comment-reply,suggest-edit,research-plan,extract-memory}/route.ts`，并让 `src/lib/comments/reply-run.ts` 直接复用 `conversation-runner` lifecycle、删掉 `src/lib/ai/workspace-assistant-run.ts` 这层旧壳；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 4 切片 65，扩展 `src/derive/agent-watching.ts` 让 comment read side 在有消息历史时完全按 `user mention + stop control + in-flight agent reply refresh` 回放当前 binding，并让 `src/objects/comment/agent-bindings.ts`、`src/app/api/threads/[threadId]/{research-plan,research/start}/route.ts` 改用同一 derive seam 解析 research target；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 4 切片 64，新增 `src/derive/agent-watching.ts`，并在 `src/app/api/threads/[threadId]/route.ts` 为 `stop_agent_listening` 同步写出隐藏 control message；`src/objects/comment/view.ts`、`src/app/api/threads/[threadId]/messages/route.ts`、`src/lib/comments/research-orchestration.ts` 与 `src/lib/ai/non-chat-agent-run.ts` 开始消费 stop-event-aware derive / visible-message filter，修复“stop 后重新 @ 同一角色仍被视为永久停用”的回放语义；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 63，新增 `src/lib/ai/agent-run-request.ts` / `src/lib/ai/non-chat-agent-run.ts`，为 `comment-reply / suggest-edit / extract-memory` 冻结统一的 `mode + target + input` non-chat `/api/agent/run` envelope，并让 `src/app/api/ai/{comment-reply,suggest-edit,extract-memory}/route.ts` 全部退成共享 handler forwarder；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 62，新增 `src/lib/ai/agent-run-route.ts` 与 `src/app/api/agent/run/route.ts`，把 chat/light run 与 deep research proposal 收到同一条共享 server handler，并让 `src/agent/run.ts` 改打新入口、旧 `src/app/api/ai/{chat,research-plan}/route.ts` 退成 forwarder；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 61，扩展 `src/lib/ai/conversation-runner.ts` 新增 `buildWorkspaceAssistantSystemPrompt`，并让 `comment-reply / research-plan / research-plan/start` 停止各自直连 `buildChatSystemPrompt`，先把 workspace AI route 的 system prompt assembly 收到同一 seam；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 60，扩展 `src/lib/ai/conversation-runner.ts` 新增 `initializeWorkspaceAssistantRun`，并让 `src/app/api/ai/research-plan/route.ts` 与 `src/app/api/workspaces/[workspaceId]/assistant-runs/[runId]/research-plan/start/route.ts` 复用同一条非流式 assistant-run 初始化 seam，不再各自手写 create + initial update；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 59，扩展 `src/lib/ai/conversation-runner.ts` 新增 `buildWorkspaceAssistantConversationContext`，并让 `src/app/api/ai/chat/route.ts` 与 `src/app/api/workspaces/[workspaceId]/assistant-runs/[runId]/proposal/continue/route.ts` 共用 history + tool message + system prompt 组装，不再在 route 内各自拼装上下文；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 58，扩展 `src/lib/ai/conversation-runner.ts` 新增 `startWorkspaceAssistantRun` 的 route-level lifecycle seam，并让 `src/app/api/ai/comment-reply/route.ts` 的 tool-enabled web revision run 复用同一条 assistant-run 创建 / running / finish/error 收口逻辑，只保留 review-specific prompt 与 persistence 适配；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 5 切片 57，新增 `src/framework/agent/run.ts`，把 `src/lib/ai/pi-runtime.ts` 与 `src/lib/ai/chat-agent.ts` 共享的 provider API key 解析、message 正规化和 assistant text 抽取收口到统一 runtime 原语，并修正 server-only helper 不能经由 `src/framework/agent/index.ts` 暴露到 client graph 的边界问题；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 4 切片 56，新增 `src/objects/comment/agent-bindings.ts`，把 `threads` / `comment-reply` 相关 route 里的 `agentBindingsJson -> parse / refresh / stringify / research target` 生命周期 helper 下沉到 comment object seam，减少 API 对 binding JSON 的直接感知面；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 4 切片 55，新增 `src/derive/thread-classify.ts`，把 `src/app/api/threads/route.ts` 里 inherited comment 的 `actionable / stale / superseded` 分类和 surface remap 规则下沉到纯 derive helper，并保持 web preview / Review comment 回归矩阵不变；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 3 切片 54，新增 `prisma/migrations/20260321170000_backfill_recovery_labels/migration.sql`，扩展 `SYSTEM.md` / `src/types/index.ts` / `src/objects/{label,state,workspace}`，并在 `src/objects/state/commands.ts`、`src/lib/workspace/service.ts`、`src/lib/workflows/service.ts`、`src/app/api/threads/*` 与 `src/lib/ai/pi-agent-tools.ts` 把 recovery/pinned 语义切到 label contract，应用层不再读取 `Version.versionType`；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 3 切片 53，新增 `prisma/migrations/20260321150000_backfill_head_labels/migration.sql`，并在 `src/objects/state/commands.ts` / `src/lib/workspace/service.ts` 把 manual 版本写侧补齐为“创建 milestone + head label、归档上一可见 head”的一致生命周期；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 3 切片 52，新增 `prisma/migrations/20260321143000_backfill_milestone_labels/migration.sql`，并在 `src/objects/state/commands.ts` 让 manual 版本创建同步写入 milestone label，先把 manual 版本读写都接到 label 模型；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 3 切片 51，扩展 `src/objects/state/schema.ts`、`src/objects/state/queries.ts`、`src/objects/workspace/view.ts`、`src/lib/workspace/service.ts` 与 `src/app/api/workspaces/[workspaceId]/versions/route.ts`，把 `visible / recovery / pinned` 读侧语义收进 state-label derive seam，并让 workspace versions/filtering 改为消费 derive 结果；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 3 切片 50，扩展 `src/objects/label/queries.ts`、`src/objects/workspace/view.ts` 与 `src/lib/workspace/service.ts`，把 `Label` bootstrap 真正接到 `listWorkspaceVersions` 读侧，让 `WorkspaceVersionData` 开始携带 `labels` hydration seam，但保持现有 `versionType` 语义与 UI 契约不变；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 3 切片 49，新增 `prisma/migrations/20260321120000_add_state_labels/migration.sql` 与 `src/objects/label/{schema,queries,commands,index}.ts`，并在 `prisma/schema.prisma` / `src/types/index.ts` 落下 `Label` 持久模型与 `StateLabelData` bootstrap，先建立 additive label object seam，不改现有 `versionType` 运行时语义；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 48，新增 `src/objects/project/view.ts`，把 `src/lib/workspace/service.ts` 里的 `buildProjectDeliverables` 下沉到独立 object view module，并把 service 巨石压到 1844 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 47，扩展 `src/objects/conversation/view.ts`，把 `src/lib/workspace/service.ts` 里的 `buildConversationTree / mapConversationWithRelations` 下沉到独立 object view module，并继续由 `service.ts` import 使用，把 service 巨石压到 1894 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 46，新增 `src/objects/comment/view.ts`，把 `src/lib/workspace/service.ts` 里的 `mapCommentMessage / mapCommentThread` 与相邻的 `buildCommentAnchorFingerprint` 下沉到独立 object view module，并继续由 `service.ts` 兼容 import + re-export，把 service 巨石压到 1966 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 45，新增 `src/objects/workspace/view.ts`，把 `src/lib/workspace/service.ts` 里的 `mapWorkspace / mapWorkspaceVersion / mapWorkspaceEditLock` 以及相邻的 `mapKnowledgeItem / mapMemory / mapWorkspaceWithRelations` 下沉到独立 object view module，并继续由 `service.ts` 兼容 import + re-export，把 service 巨石压到 2085 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 44，新增 `src/objects/conversation/view.ts`，把 `src/lib/workspace/service.ts` 里的 `mapConversation / mapConversationMessage / mapChatAttachment / mapAssistantRun` 以及相邻 normalize helper 下沉到独立 object view module，并继续由 `service.ts` 兼容 re-export，把 service 巨石压到 2300 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 42，新增 `src/surfaces/workspace/use-workspace-outline-navigation.ts`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 outline DOM scroll / focus helper 下沉到独立 hook，并把 route 页压到 681 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 41，新增 `src/surfaces/workspace/use-workspace-shell-controller.ts`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 pane order 持久化、workflow apply、首稿 prompt queue 和 notice auto-dismiss 下沉到独立 controller hook，并把 route 页压到 765 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 40，新增 `src/surfaces/workspace/use-workspace-route-controller.ts`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 read-side load / poll、plan generate 和 URL sync controller 下沉到独立 hook，并把 route 页压到 897 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 39，新增 `src/surfaces/workspace/use-workspace-file-save-controller.ts`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 optimistic file save、debounce 和 cleanup timer 下沉到独立 controller hook，并把 route 页压到 1122 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 38，新增 `src/surfaces/workspace/use-workspace-version-preview-controller.ts`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 create / restore version、pin / unpin recovery point、branch / continue / switch、preview start / stop 与 preview recovery orchestration 下沉到独立 controller hook；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 37，新增 `src/surfaces/workspace/use-workspace-sidebar-actions.ts`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 support file / project tree action controller 簇下沉到独立 hook，并保持 `WorkspaceRouteSidebar` 的 callback 契约不变；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 36，新增 `src/surfaces/workspace/use-workspace-goal-dialog-controller.tsx`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 workspace create / goal dialog recovery、seed、idempotent submit 和路由跳转控制下沉到独立 controller hook，并把 route 页压到 2089 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-21：完成 Phase 2 切片 35，新增 `src/surfaces/workspace/workspace-deliverable-panel.tsx`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 `deliverablePanel` prop 组装下沉到独立 surface adapter，并把 route 页压到 2270 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 34，新增 `src/surfaces/workspace/workspace-assistant-rail.tsx`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 `assistantRail` 组装下沉到独立 surface adapter，并把 route 页压到 2308 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 33，新增 `src/surfaces/workspace/workspace-route-chrome.tsx`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 deliverable title switcher 与 `GoalComposerDialog` 组装下沉到 route chrome surface adapter，并把 route 页压到 2339 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 32，新增 `src/surfaces/workspace/workspace-header-version-controls.tsx`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 header 状态条、review comment 入口和 `DeliverableVersionControls` 组装下沉到独立 surface adapter，并把 route 页压到 2387 行；`npm run verify:iteration` 通过（50 passed）。
- 2026-03-20：完成 Phase 2 切片 31，新增 `src/surfaces/workspace/workspace-shell-actions.tsx`，把 `src/app/workspace/[workspaceId]/page.tsx` 里的 `workspaceShellActions` 提到独立 surface adapter，并保持 sibling deliverable 入口、view 菜单、preview start/stop / open preview 和实现态切换行为不变；`npm run verify:iteration` 通过（50 passed）。
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
