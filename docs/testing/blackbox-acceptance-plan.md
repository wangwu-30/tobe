# 成形黑盒验收计划

> 日期：2026-08-21
> 定位：迭代回归门禁的扩展层；control-plane 与浏览器前置检查已纳入 `verify:iteration`，黑盒场景仍通过显式命令运行
> 关联：[迭代回归门禁](./iteration-regression-plan.md)

---

## 定位

当前 `verify:iteration` 先执行静态检查与完整 control-plane inventory/gate，再 bootstrap 隔离数据库、
构建 production Web 应用、执行浏览器依赖前置检查和 Playwright E2E。这套门禁验证的是
"代码是否按预期运行"，并保证 `apps/**`、`src/**`、`tests/control-plane/**` 下新增的 `*.test.ts`
不会被静默遗漏。

黑盒验收补充两个维度：
- **Layer 1**：视觉回归 + 可访问性 — "用户看到的画面是否一致、可达"
- **Layer 2**：AI Inspector — "真实用户操作流程是否顺畅"

Layer 1 尚未实现，Layer 2 当前仍显式运行；只有在 runner、依赖策略和稳定性都达到日常门禁要求后，
才通过一次明确的 gate 变更纳入 `verify:iteration`。本文不把该演进条件写成当前能力。

身份相关场景只验证当前 trusted local single-user principal 下的 team-mode organization ACL。产品尚无
production identity provider、登录/session/JWT integration、成员邀请/provisioning 或企业 SSO，因此这些
不属于当前黑盒验收；identity header 是受信 Web runtime 的 transport receipt，不是认证机制。下文 OAuth
连接态只指模型 provider credential，不是产品用户登录。remote Git credential/fetch/push 与 monorepo
subpath mount 同样是 non-goal。

## 隔离规则

- 每次黑盒测试前**清空全部项目历史数据**
- 使用独立 app-data-root：`.tmp/blackbox-acceptance/app-data/`
- 截图和报告产物写入：`.tmp/blackbox-acceptance/artifacts/`
- 不复用 `iteration-regression` 的数据库或产物目录
- 不允许污染仓库根目录
- Layer 2 当前 runner 按场景重置 app-data / db；A1-A3 这类首次使用场景不能共享同一次命令里的历史状态

## Layer 1 候选：场景化视觉回归 + 可访问性

### 设计

以下是尚未接线的候选矩阵，不属于当前 gate。落地时按用户场景组织截图，每个场景捕获关键状态转换点，
使用 Playwright screenshot comparison 与 axe-core 可访问性检查；当前仓库没有 `tests/visual/`、
`test:visual` 或 `test:blackbox` 入口。

### 域 1：首次进入 + 项目创建

| 检查点 | 捕获状态 | 可访问性检查 |
|--------|----------|-------------|
| S1.1 首页空态 | 无项目时首页布局、起步提示、新建按钮 | 对比度、按钮 ARIA |
| S1.2 Goal Composer | 目标输入框、workflow 模板卡片 | 焦点管理、键盘导航 |
| S1.3 意图追问卡片 | 结构化追问卡片渲染 | 选项 ARIA |
| S1.4 创建完成跳转 | workspace 首屏 | 加载态 → 就绪态 |

### 域 2：交付物主表面

| 检查点 | 捕获状态 | 可访问性检查 |
|--------|----------|-------------|
| S2.1 document 正文 | 编辑器 + 大纲 | 编辑区 ARIA role |
| S2.2 web 预览 | iframe 预览加载完成 | iframe 标题 |
| S2.3 slides 结果面 | 卡片式幻灯片 | 导航 aria-label |
| S2.4 implementing 态 | 活动画面 + 状态胶囊 | 进度可读性 |
| S2.5 准备态 | 空态 + 主 CTA | 按钮对比度 |
| S2.6 完成态 | 内容 + 下一步卡片 | 操作可达性 |

### 域 3：评论闭环

| 检查点 | 捕获状态 | 可访问性检查 |
|--------|----------|-------------|
| S3.1 文档选区触发器 | 选中文本后浮窗 | 浮窗焦点管理 |
| S3.2 评论 composer | 输入框 + @agent + 提交 | textarea label |
| S3.3 Review 侧边栏 | 线程列表、分组 | 列表语义 |
| S3.4 web 选区评论 | bridge 触发 → composer | 跨 iframe 焦点 |
| S3.5 AI 回复中 | agent chip "等待中" | 状态通知 |
| S3.6 应用到原文 | diff 高亮 + 确认 | 变更可读性 |

### 域 4：版本与分支

| 检查点 | 捕获状态 | 可访问性检查 |
|--------|----------|-------------|
| S4.1 版本历史 | 里程碑列表 + branch 标识 | 列表导航 |
| S4.2 版本比较 | 双边 diff | diff 可读性 |
| S4.3 从里程碑继续 | 新 branch + URL 更新 | 状态通知 |
| S4.4 branch 切换 | 基线更新 + chat 切换 | 分支标识 |
| S4.5 branch overview | 分支摘要卡片 | 卡片语义 |

### 域 5：对话与研究

| 检查点 | 捕获状态 | 可访问性检查 |
|--------|----------|-------------|
| S5.1 Chat 空态 | 输入框 + 轻搜 | 输入框 label |
| S5.2 对话进行中 | 消息流 + AI 动画 | 消息角色 ARIA |
| S5.3 深度研究计划 | 计划确认 UI | 确认按钮可达性 |
| S5.4 研究报告完成 | 报告入口 + 支持资料树 | 链接可达性 |
| S5.5 对话分叉 | 新对话 + 上下文保持 | 切换通知 |

### 域 6：上下文与工作流

| 检查点 | 捕获状态 | 可访问性检查 |
|--------|----------|-------------|
| S6.1 Workflow 模板 | 内置模板 + 扩展提示 | 卡片语义 |
| S6.2 自定义 workflow | 编辑表单 + Tools/MCP | 表单 label |
| S6.3 Knowledge note | note 卡片 | 卡片操作 ARIA |
| S6.4 Status 面板 | 阶段 + workflow + 下一步 | 状态可读性 |
| S6.5 支持资料树 | 文件树 + CRUD | 键盘导航 |

### 域 7：设置与全局

| 检查点 | 捕获状态 | 可访问性检查 |
|--------|----------|-------------|
| S7.1 设置页 | 所有 card section | 表单标签完整性 |
| S7.2 模型选择器 | provider + model 选择 | 下拉菜单 ARIA |
| S7.3 OAuth 连接态 | 已连接/未连接 | 状态标识 |
| S7.4 语言切换 | 全页面文案变化 | 语言属性 |
| S7.5 错误降级 | ErrorBoundary UI | 重试按钮可达性 |

---

## Layer 2：AI Inspector

### 设计

AI 扮演用户按自然语言场景操作产品，执行后给出体验评分。当前 `npm run test:ai-inspector` 会串行执行已落地场景，并在每个场景前重置隔离数据库，保证场景不共享历史状态；当前枚举并执行 A1-A3、B2-B4 与 C1-C2，且 seed 的 project root 会从当前 `DAO_APP_DATA_ROOT` 派生。场景枚举使用与 Playwright spec 完全一致的标题，并由脚本契约测试锁定，避免已实现场景被 runner 静默漏掉。

### 场景列表

| ID | 旅程 | 场景 | 验收重点 |
|----|------|------|----------|
| A1 | 首次使用 | 空白起步：首页 → Goal Composer → 输入目标 → 进入 workspace | 从打开到进入是否连贯 |
| A2 | 首次使用 | 网页创建：输入网页类目标 → 确认 web 交付物 → 预览自动启动 | 是否需要额外操作才看到预览 |
| A3 | 首次使用 | 歧义追问：输入模糊目标 → 追问卡片 → 选择 → 创建 | 追问是否清晰 |
| B1 | 日常创作 | 阅读评论：选中正文 → 浮窗 → 输入 @assistant → 提交 → Review 出现 | 选中到提交 ≤ 3 步 |
| B2 | 日常创作 | 对话推进：Chat 输入修改请求 → AI 响应 → 草稿更新 → Status 同步 | 对话到结果是否一气呵成 |
| B3 | 日常创作 | 版本保存：保存里程碑 → 历史中找到 → 进入比较视图 | 保存到比较是否顺畅 |
| B4 | 日常创作 | 分支操作：从里程碑继续 → URL 更新 → Chat 基线变化 → 切分支 | 分支后是否清楚自己在哪 |
| C1 | 上下文 | 知识管理：Context → 创建 note → 编辑 → 保存 → 持久化 | 创建编辑保存是否直觉 |
| C2 | 上下文 | Workflow：查看模板 → 应用到任务 → Status 更新 | 模板应用是否一键 |
| C3 | 上下文 | 支持资料：创建 → 重命名 → 删除 → UI 回退 | 三个操作是否有即时反馈 |
| D1 | 研究 | 深度研究：切换模式 → 计划卡 → 执行 → 报告入口 → 在"研究"目录 | 全程是否在 workspace 内 |
| E1 | 多交付物 | 继续下一份：完成态 → 找到入口 → 创建 → 同项目 | 是否被带回首页 |
| E2 | 多交付物 | 项目切换：标题栏切换器 → 另一份交付物 → URL + 内容 + 上下文同步 | 切换是否立即生效 |
| F1 | 设置 | 设置完整性：所有配置可见 → 切英文 → 全页文案变化 | 设置是否全量生效 |
| F2 | 错误恢复 | API 500 → ErrorBoundary → 重试 → 恢复 | 是否白屏、重试是否有效 |
| G1 | 模型选择 | 打开模型选择器 → provider 切换 → model 切换 → 保存 | 选择器是否直觉 |

### 评分维度（每个场景 1-5 分）

| 维度 | 含义 |
|------|------|
| 可达性 | 用户能否找到入口并完成操作 |
| 流畅度 | 是否连贯，有无卡顿/白屏/多余步骤 |
| 反馈性 | 每步是否有明确的视觉/状态反馈 |
| 可理解性 | 文案和状态是否让人理解发生了什么 |
| 错误容忍 | 异常时是否有友好提示和恢复路径 |

**门禁阈值**：每场景每维度 ≥ 3；总平均 ≥ 4。

---

## 执行顺序

```text
verify:iteration
1. static
2. control-plane：校验全量 test inventory，构建 execution daemon、room-session-host 与 knowledge merge worker，执行 control-plane / daemon / room-host / knowledge tests
3. db:bootstrap：初始化隔离数据库
   - 强制并校验 SQLite WAL，设置 busy timeout 与 foreign keys
4. production build：构建 Web 应用
5. browser-preflight：检查实际 Chromium headless-shell 的共享库；缺失时列出准确 soname 并失败
6. browser E2E：在 production Web server 上运行完整交互回归

当前显式 AI Inspector gate
1. db:bootstrap —— 清空并初始化隔离数据库
2. 启动 dev server
3. Layer 2：逐场景 AI Inspector
4. 生成 JSON/Markdown 聚合报告

Layer 1 候选（当前无可执行命令）
1. 截图 + 可访问性
2. 与基准比较
3. 将结果汇入统一报告
```

浏览器前置检查不会安装系统包、伪造共享库或把依赖缺失记为 skip/pass。宿主缺库（例如 `libgbm.so.1`）时，门禁必须保持失败，直到宿主依赖真实可用。

## 门禁接入状态

- 已接入：确定性的 `apps/**` / `src/**` / `tests/control-plane/**` test inventory、三个 Node service build/suites、browser dependency preflight
- 未接入：visual regression；当前没有 runner、baseline 目录或 package script
- AI Inspector 仍显式运行；纳入日常门禁前需确认时长与外部 AI 依赖策略
- 任一已接入阶段失败都阻断交付；浏览器依赖失败不允许降级为绿色

## 当前文件与候选结构

```text
tests/
├── visual/                      # 规划：Layer 1 落地时创建
│   ├── scenarios.config.ts      # 规划：检查点定义
│   ├── domains/                 # 规划：每域一个文件
│   └── baselines/               # 规划：基准截图
├── blackbox/
│   └── chengxing/
│       ├── ai-inspector.spec.ts # 当前已落地：A1-A3 + B2-B4 + C1-C2 黑盒场景
│       ├── runner.ts            # browser operator consumer runner
│       ├── scenarios.ts         # 场景矩阵
│       ├── report.ts            # JSON / Markdown 聚合报告
│       └── types.ts             # 场景与评分类型
├── infra/
│   └── browser-operator/        # 共享 core runner / driver / artifact contract
```

当前脚本：
- `npm run test:control-plane`（完整 Node/control-plane 门禁；先校验 inventory）
- `npm run test:control-plane:inventory`（只校验当前全部 `*.test.ts` 与专用配置一一对应）
- `npm run test:browser:preflight`（只检查浏览器二进制与宿主共享库）
- `npm run test:ai-inspector`（当前已落地；串行执行 A1-A3、B2-B4 与 C1-C2，并在每个场景前重置 app-data-root）

候选脚本名（当前 package scripts 中不存在）：

- `npm run test:visual`（随 Layer 1 实现后接入）
- `npm run test:blackbox`（在 Layer 1 与聚合报告入口实现后接入）

## 本轮结果记录边界

本轮 `verify:iteration` 与显式 blackbox 命令的精确结果由本轮最终 gate 补录到 active tracker。补录前，
本计划只定义范围、顺序和阈值，不宣称当前工作树通过任何未实际执行完成的 gate。
