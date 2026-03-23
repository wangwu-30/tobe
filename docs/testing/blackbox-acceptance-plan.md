# 成形黑盒验收计划

> 日期：2026-03-23
> 定位：迭代回归门禁的扩展层；当前通过显式命令运行，所有改造完成后纳入 `verify:iteration`
> 关联：[迭代回归门禁](./iteration-regression-plan.md)

---

## 定位

当前 `verify:iteration` 覆盖静态检查 + 18 个 Playwright spec（62 条 E2E）。这套门禁验证的是"代码是否按预期运行"。

黑盒验收补充两个维度：
- **Layer 1**：视觉回归 + 可访问性 — "用户看到的画面是否一致、可达"
- **Layer 2**：AI Inspector — "真实用户操作流程是否顺畅"

两层在全部改造完成后，作为 `verify:iteration` 的新阶段纳入。

## 隔离规则

- 每次黑盒测试前**清空全部项目历史数据**
- 使用独立 app-data-root：`.tmp/blackbox-acceptance/app-data/`
- 截图和报告产物写入：`.tmp/blackbox-acceptance/artifacts/`
- 不复用 `iteration-regression` 的数据库或产物目录
- 不允许污染仓库根目录
- Layer 2 当前 runner 按场景重置 app-data / db；A1-A3 这类首次使用场景不能共享同一次命令里的历史状态

## Layer 1：场景化视觉回归 + 可访问性

### 设计

按用户场景组织截图，每个场景捕获关键状态转换点。使用 Playwright 截图 + pixelmatch 比较 + axe-core 可访问性检查。

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

AI 扮演用户按自然语言场景操作产品，执行后给出体验评分。当前 `npm run test:ai-inspector` 会串行执行已落地场景，并在每个场景前重置隔离数据库，保证场景不共享历史状态；当前已落地 A1-A3 与 B2-B4，且 seed 的 project root 会从当前 `DAO_APP_DATA_ROOT` 派生。

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
1. db:bootstrap —— 清空并初始化隔离数据库
2. 启动 dev server
3. Layer 1：截图 + 可访问性（约 3 分钟）
4. Layer 2：AI Inspector 场景（约 10-15 分钟）
5. 生成报告
```

## 纳入 verify:iteration 的条件

- 全部改造（Phase 12-17）完成后
- Layer 1 + Layer 2 作为 `verify:iteration` 的新阶段追加
- 执行顺序：static → E2E → visual → AI inspector
- 任一阶段失败阻断交付

## 实现文件结构

```text
tests/
├── visual/
│   ├── scenarios.config.ts      # 检查点定义
│   ├── domains/                 # 每域一个文件
│   └── baselines/               # 基准截图
├── blackbox/
│   └── chengxing/
│       ├── ai-inspector.spec.ts # 当前已落地：A1-A3 + B2-B4 黑盒场景
│       ├── runner.ts            # browser operator consumer runner
│       ├── scenarios.ts         # 场景矩阵
│       ├── report.ts            # JSON / Markdown 聚合报告
│       └── types.ts             # 场景与评分类型
├── infra/
│   └── browser-operator/        # 共享 core runner / driver / artifact contract
```

新增脚本：
- `npm run test:visual`
- `npm run test:ai-inspector`（当前已落地；串行执行 A1-A3 与 B2-B4，并在每个场景前重置 app-data-root）
- `npm run test:blackbox`（待 Layer 1 落地后补齐）
