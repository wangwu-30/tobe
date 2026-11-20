# M6 架构提案：统一 Runtime 代理层（XAR / External Proxy）接入评估与 Fail-Closed 适配器契约

- 关联议题：[#49](https://github.com/wangwu-30/tobe/issues/49)（M6: Monolith Guardrails, Final 2k-Line Weight-Loss & Unified Runtime Proxy Spike）
- 结论性质：**Adopted for Opt-In Spike（保留现有控制面与本地默认路径，通过 V1 Port 接入可选的 Fail-Closed HTTP/JSON Proxy 适配器）**

---

## 一、现状

### 1.1 `tobe` 当前的双运行时边界
- **Chat / Project Room 低延迟对话面（`RoomSessionRuntimePortV1`）**：由 `src/agent/room-runtime/contracts.ts` 定义，当前默认由 `@earendil-works/pi-agent-core`（`src/agent/room-runtime/adapters/pi-agent-core.ts`）驱动；会话生命周期、`@mention` 路由、委派深度限制（`guardRoomDelegation`）、工具审批（`enforceGovernedAgentTool`）与多 Host 租约代际栅栏（`RoomHostStoreV1` / `prisma-store.ts`）全部由 `tobe` 控制面与 Room Session Host 掌握。
- **后台长耗时执行面（`ExecutionRuntimeDriverV1`）**：由 `src/agent/execution/driver.ts` 与 `src/agent/execution/contracts.ts` 定义，当前生产可执行路径仅限 `generic-cli` 与受信任的 `external-module`（`runtime-plugin-loader.ts`）；`OpenHands` 适配器（`src/agent/execution/drivers/openhands.ts`）严格保持 `disabled / unavailable / executable: false` fail-closed；工作区变更通过 per-attempt 隔离 clone（capability 名为 `git-worktree`）与 `StagedChangeSet` / `KnowledgeChangeRequest` 交由人类审核合并。
- **两层物理隔离**：Room Agent Session 与 durable `ExecutionJob` 保持独立生命周期、独立数据库租约和独立守护进程（`apps/room-session-host` vs `apps/execution-daemon`）。

### 1.2 外部统一 Runtime 代理层（如 XAR / 本地多 CLI 网关 / ACP Sidecar）的出现
- 近年来社区涌现出多类“统一 Agent Runtime 代理层”（如 XAR、本地 HTTP/JSON-RPC 多 CLI 网关、ACP-style sidecar），试图把 Claude Code、Codex CLI、OpenCode、Gemini CLI 等高频演进的外部 Agent 运行时收敛成统一协议。
- 如果 `tobe` 直接在仓库内为每一种外部 Agent CLI / SDK 维护原生适配器，就会把上游 SDK 的高频破坏性变更、鉴权协议差异和子进程生命周期细节直接耦合进 `tobe` 的 `package.json` 与 CI 门禁。

---

## 二、目标

在不削弱 `tobe` 控制面安全边界、不改变默认本地体验（Chat 默认入口、`pi-agent-core`、`generic-cli`）的前提下，明确并验证：
1. **客观边界划分**：哪些职责适合下沉给外部统一 Runtime 代理层（如 XAR / HTTP-JSON Sidecar），哪些控制面不变量绝对不能让渡。
2. **零外部依赖的 Fail-Closed 接入范式**：交付一套覆盖 `ExecutionRuntimeDriverV1` 与 `RoomSessionRuntimePortV1` 的可选 HTTP/JSON Proxy 适配器 Spike，证明外部代理层可以直接挂在现有 V1 Port 背后并通过全套契约与合规测试。
3. **默认安全与零副作用**：默认关闭（`enabled: false`）、默认仅允许 loopback 端点、严格校验 V1 协议帧、绝不在错误/事件/Checkpoint 中泄漏凭证，且不影响 `OpenHands` 的 fail-closed 姿态。

---

## 三、差距与辩证权衡

### 3.1 外部统一代理层能解决什么（适合外包的复杂度）
| 维度 | 仓内原生维护多套 Adapter | 接入统一 Runtime 代理层（Proxy Sidecar） |
| --- | --- | --- |
| 第三方 CLI / SDK 演进税 | 每个上游升级都直接冲击 `package.json`、Vite 打包与 CI | 上游适配下沉到独立进程/代理层，`tobe` 只守稳定 V1 传输契约 |
| 多模型/多 CLI 复用 | 需为每个 CLI 重复实现输出解析、重试、进程托管 | 由代理层统一提供流式 NDJSON、会话复用与健康探测 |
| 进程与依赖隔离 | 第三方 SDK 依赖污染 Next.js / Daemon 依赖树 | `tobe` 侧零新增第三方依赖，仅通过本地 loopback HTTP/JSON 通信 |

### 3.2 外部统一代理层绝对不能接管什么（必须留在 `tobe` 控制面）
1. **持久化状态与租约代际栅栏（Lease & Generation Fencing）**：代理层只能回报事实事件，绝不能直接写 SQLite 或绕过 `ExecutionDaemonV1` / `RoomHostStoreV1` 的 `(attemptId/roomSessionId, workerId, generation)` CAS 栅栏。
2. **工具治理与人类主权（Policy & StagedChangeSet）**：代理层不得绕过 `enforceGovernedAgentTool`、`RoomPolicyV1`（Quiet Host / Delegation 预算）与 `StagedChangeSet` / `KnowledgeChangeRequest`；文件修改产物仍必须由控制面在受控工作区中采集并经人类确认后才可落盘或合并。
3. **工作区路径信任边界**：控制面只允许向代理层传递经校验的无 host 本地 `file:` URI（`RuntimeWorkspaceRefV1`），绝不透传私有仓库路径或控制面内部 receipt（`knowledgeWorkspace` / `workspaceLifecycle`）。
4. **凭证与隐私边界**：代理鉴权 token 只存在于传输层 header（`Authorization: Bearer ...`），绝不写入 `RoomSessionCheckpointEnvelopeV1`、事件流或异常消息。
5. **双生命周期隔离**：即便同一个外部代理进程同时提供对话端点与任务端点，`tobe` 侧仍必须分别由 `RoomSessionRuntimePortV1`（Room Session Host）与 `ExecutionRuntimeDriverV1`（Execution Daemon）两个独立适配器接入，不得把两者合并成单一隐式上下文。

### 3.3 当前差距
- 在本提案之前，仓库虽已具备 `ExecutionRuntimeDriverV1` 与 `RoomSessionRuntimePortV1` 端口定义及 `OpenHands` fail-closed 骨架，但尚无面向本地 HTTP/JSON 代理 sidecar 的标准传输层、V1 线缆协议校验器，以及通过 `registerRoomSessionRuntimeComplianceSuiteV1` 的代理适配器参考实现。
- 同时必须诚实说明：社区中不同代理层（包括 XAR 等新兴项目）的线上 Wire API 仍在演进且未形成单一冻结标准；因此本仓库不硬编码某个未冻结第三方项目的私有路径，而是定义受控的 **`tobe` V1 Proxy Wire Contract**（可由任何外部代理或轻量桥接层实现）。

---

## 四、执行计划

### 4.1 M6 本期交付（Opt-In Fail-Closed Proxy Adapter Spike）
1. **零外部依赖 Loopback-Safe 传输层**（`src/agent/runtime-proxy/http-transport.ts`）：
   - 基于 Node 原生 `node:http` / `node:https` 与 `@/framework/resilience/safe-data` 的 `safeJsonParse`（零裸 `fetch`、零裸 `JSON.parse`）。
   - 默认仅放行 loopback 地址（`127.0.0.1`、`localhost`、`::1`）；远程地址必须同时显式配置 `allowRemoteEndpoint: true` 且使用 `https:`，并拒绝 URL 内嵌凭证、查询串与片段。
   - 支持有界响应字节上限（默认 2 MiB）、有界超时、`AbortSignal` 级联中止与 NDJSON 流式解析，异常消息绝不回显 bearer token。
2. **Execution 代理驱动**（`src/agent/execution/drivers/http-proxy.ts`）：
   - 实现 `ExecutionRuntimeDriverV1`（`describe / start / resume / interrupt / reconcile / archive`）。
   - 默认 `enabled: false` fail-closed；配置不合法时在发包前抛出 `HttpProxyRuntimeUnavailableError`。
   - 对所有入站 `RuntimeEventV1`、`RuntimeSnapshotV1`、`RuntimeArtifactRefV1` 与出站 `workspace.uri`（hostless `file:`）执行严格校验；消费者提前终止迭代时自动中止底层 HTTP 流。
3. **Room Session 代理适配器**（`src/agent/room-runtime/adapters/http-proxy.ts`）：
   - 实现 `RoomSessionRuntimePortV1`（`describe / open / resume / handle / checkpoint`）。
   - 在适配器本地维护 `roomSessionId -> { generation, runtimeSessionId, eventSequence }` 栅栏表：过期 handle 直接在本地返回 `stale-runtime-handle` 错误，不放行到代理；`intent: 'observe'` 严格遵循 Quiet Host 契约零调用返回 `observed`；中断迭代时中止流并等待显式 cancel 完成；恶意或畸形远端事件流一律 fail-closed 收口为单条 `error` 终态且禁止伪造 `message-ready`。
4. **单测与合规测试**：
   - `src/agent/execution/drivers/http-proxy.test.ts` 与 `src/agent/room-runtime/adapters/http-proxy.test.ts`（接入 `registerRoomSessionRuntimeComplianceSuiteV1`），均以 `runner: 'node'` 登记到 `scripts/control-plane-test-inventory.mjs`。

### 4.2 后续生产接线前提（待验证，本期不启用）
- 在真正接入具体外部代理（如特定冻结版本的 XAR sidecar 或 ACP gateway）前，需先完成：
  1. 冻结目标代理的端点映射与错误码表，并补充真实子进程冒烟集成测；
  2. 将代理运行时注册纳入 `ExecutionRuntime` / `RoomSessionHost` 的组织级显式 allowlist 配置，继续保持默认关闭；
  3. 验证工具调用确认（`room.tool_confirmation.requested`）与工作区变更回传仍完全受控于 `tobe` 策略与人类确认流。

---

## 五、验收标准

- [x] `docs/rfcs/m6-unified-runtime-proxy-adapter.md` 发布，清晰界定代理层与控制面边界。
- [x] `HttpProxyExecutionRuntimeDriverV1` 与 `HttpProxyRoomSessionRuntimeAdapterV1` 零新增 npm 依赖，默认 fail-closed，不改动默认 `pi-agent-core` / `generic-cli` / `OpenHands` 行为。
- [x] `src/agent/execution/drivers/http-proxy.test.ts` 与 `src/agent/room-runtime/adapters/http-proxy.test.ts` 覆盖 loopback SSRF 防护、凭证零泄漏、畸形负载 fail-closed、真实本地 HTTP 服务器端到端通信以及完整 `registerRoomSessionRuntimeComplianceSuiteV1` 合规套件。
- [x] 两条测试已 1:1 登记在 `scripts/control-plane-test-inventory.mjs` 并通过 `npm run test:control-plane:inventory`、`npm run test:unit`、`npm run verify:iteration:static` 与 GitHub Actions 完整 `Iteration Gate`。
