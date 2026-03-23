---
name: product-acceptance
description: Execute full-spectrum product acceptance: preflight checks, black-box browser audit, and structured issue reporting. Use when asked to "验收", "全面检查", "产品质量审计", or before milestone delivery.
---

# Product Acceptance Skill

产品全面验收流程。适用于功能交付后的完整体验审计，不仅验证功能是否能跑，还验证 UI 是否好用、信息是否清晰、设计是否连贯。

## 触发条件

- 用户说"验收"、"全面检查"、"产品审计"
- 里程碑交付前
- 重构批量完成后需要确认用户体验

## Phase 0：前置检查（必须首先执行）

在做任何浏览器操作前，按顺序检查：

### 0.1 Dev Server 状态

```bash
# 检查 dev server 是否在运行
curl -s -o /dev/null -w "%{http_code}" http://localhost:3217/ 2>/dev/null || echo "OFFLINE"
```

- 如果返回 `200`：继续
- 如果返回 `OFFLINE` 或非 200：
  ```bash
  # 检查端口占用
  lsof -i :3217 -t 2>/dev/null
  # 如果没有进程，启动 dev server
  cd /Users/wangwu/claude/chat-to-your-mind && PORT=3217 npm run dev &
  # 等待 server 就绪（最多 30 秒）
  for i in $(seq 1 30); do
    curl -s -o /dev/null -w "%{http_code}" http://localhost:3217/ 2>/dev/null | grep -q 200 && break
    sleep 1
  done
  ```

### 0.2 数据库状态

```bash
# 确认 dev.db 存在且有数据
ls -la /Users/wangwu/claude/chat-to-your-mind/dev.db 2>/dev/null
# 可选：检查是否有项目数据
sqlite3 /Users/wangwu/claude/chat-to-your-mind/dev.db "SELECT COUNT(*) FROM Project;" 2>/dev/null
```

### 0.3 浏览器可访问性

用 `browser_subagent` 打开 `http://localhost:3217` 并确认页面加载完成。如果 `open_browser_url` 失败，**停止验收并报告 server 问题**。

### 0.4 前置检查报告

输出格式：
```
前置检查:
  ✅ Dev server: 运行中 (port 3217)
  ✅ 数据库: 存在, N 个项目
  ✅ 浏览器: 页面可加载
```

如果任一项失败，不进入 Phase 1。

---

## Phase 1：逐页审计（核心执行）

### 审计原则

引用 `dao-design-principles` 的六条核心原则做审判标准：

1. **Occam 优先**：能移除的不留着，能合并的不分开
2. **一致性可见**：sidebar shell / spacing / row language / naming 跨页一致
3. **简化强调**：密度合理、首扫线清晰（当前对象 + 当前状态 + 下一步操作）
4. **响应式行为**：每个 pane 一个滚动容器，不溢出
5. **状态反馈显式**：loading / slow / success / failure / read-only 都有视觉
6. **AI-native**：从目标出发、AI 循环为主、手动控制为后备

### 审计页面清单

按以下顺序逐页检查。每页需要截图 + 问题列表。

#### 1.1 首页（Dashboard）

**检查点：**
- [ ] 项目卡片：信息密度、可读性、hover 效果
- [ ] 侧栏展开态：section 标题、间距、对齐
- [ ] 侧栏折叠态：图标是否有意义、是否可读（⚠️ 已知问题点）
- [ ] "+ 新建项目" 按钮位置和视觉权重
- [ ] 空态：无项目时是否有引导
- [ ] 顶栏：标题、导航、动作按钮布局
- [ ] 底部"设置"入口
- [ ] 整体配色、字号层次

#### 1.2 工作区（Workspace）— 文档类型

**检查点：**
- [ ] 中央编辑区：内容渲染方式（⚠️ 已知问题：raw md vs 渲染结果）
- [ ] 顶栏面包屑：项目路径、节点切换下拉
- [ ] "继续下一项内容" 按钮
- [ ] 版本控制栏：草稿状态、比较、版本树、Pin、里程碑
- [ ] 右侧面板标签（状态/评审/对话/上下文）
- [ ] 状态面板：当前阶段、workflow 步骤、目标
- [ ] 评审面板：空态文案
- [ ] 对话面板：消息渲染、输入框
- [ ] 上下文面板：知识/记忆 section
- [ ] 侧栏滚动区域（需要向下滚动才能看到"目录/大纲/关联项目/搜索"）

#### 1.3 工作区 — Web 类型

**检查点：**
- [ ] 预览 iframe 是否可见
- [ ] 是否默认显示预览结果而非源码
- [ ] 切换实现/预览的交互

#### 1.4 设置页

**检查点：**
- [ ] 所有 card section 完整渲染
- [ ] 模型选择器
- [ ] 语言切换
- [ ] 配置保存反馈

---

## Phase 2：问题分类与记录

### 问题严重性分级

| 级别 | 定义 | 示例 |
|------|------|------|
| **P0 阻断** | 功能不可用或数据丢失 | 创建项目后白屏、保存失败无提示 |
| **P1 严重** | 核心体验受损，用户必须绕行 | 内容仅显示 raw md 不渲染、导航丢失 |
| **P2 中等** | 影响效率或视觉质量，但可用 | 折叠侧栏无可读信息、间距不一致 |
| **P3 轻微** | 细节打磨，不影响使用 | hover 效果缺失、文案可优化 |

### 问题分类维度

| 维度 | 含义 |
|------|------|
| **功能** | 操作是否能完成预期效果 |
| **渲染** | 内容是否以正确形式展示（md渲染 vs raw文本） |
| **布局** | 组件位置、间距、对齐是否合理 |
| **交互** | hover / click / 键盘导航是否符合预期 |
| **信息架构** | 标签、命名、分组是否清晰直觉 |
| **一致性** | 跨页面的 shell / naming / action 是否统一 |
| **反馈** | 状态变化是否有视觉确认 |
| **性能** | 加载、响应是否有感知延迟 |

### 输出格式

每个问题以下格式记录：

```markdown
### [P级别] [维度] 简短标题

**位置**：页面 > 区域 > 组件
**现状**：描述当前行为
**预期**：描述应有行为
**截图**：（如有）
**建议**：修复方向
```

---

## Phase 3: 汇总报告

### 报告结构

```markdown
# 产品验收报告

> 日期：YYYY-MM-DD
> 版本：当前 commit hash
> 验收范围：[描述]

## 前置检查

[Phase 0 输出]

## 总结

| 级别 | 数量 | 
|------|------|
| P0 阻断 | N |
| P1 严重 | N |
| P2 中等 | N |
| P3 轻微 | N |

## 亮点

[做得好的地方]

## 问题清单

### P0 阻断
[问题列表]

### P1 严重
[问题列表]

### P2 中等
[问题列表]

### P3 轻微
[问题列表]

## 截图附件

[关键截图]
```

将报告写入 artifacts 目录，文件名格式：`product-acceptance-report-YYYYMMDD.md`

---

## 关键执行约束

1. **不修代码**：验收过程只观察、不改代码。发现问题只记录。
2. **截图为证**：每个页面至少一张截图，每个 P0/P1 问题必须附截图
3. **逐页推进**：按 1.1 → 1.2 → 1.3 → 1.4 顺序，不跳页
4. **滚动检查**：每个页面至少检查折叠态、展开态、滚动后内容
5. **暗示零容忍**：如果报告中说"可能有问题但没细看"，等于没验收

## 与其他 Skill 的协作

- 记录的问题如需修复，使用 `dao-change-briefs` 组织修复提案
- 涉及 UI 调整时参考 `dao-design-principles` checklist
- 修复后用 `npm run verify:iteration` 做门禁检查
