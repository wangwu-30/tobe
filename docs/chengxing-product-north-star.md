# 成形产品北极星：一人 AI Wiki

状态：active product direction
更新时间：2026-08-23
执行 brief：[一人 AI Wiki](./briefs/one-person-ai-wiki.md)

## 北极星

成形让一个人拥有一支 AI 团队，但产品本身保持 Wiki 一样简单：先说出问题或想法，确认值得长期保存后
再创建 Wiki Space，随后在 Pages 中持续积累、评审和演化。

衡量产品是否朝北极星前进，不看暴露了多少 Agent 基础设施，而看三个结果：

1. owner 能否从一段自然对话无缝得到一个可长期维护的 Wiki；
2. AI 能否跨 Pages 理解上下文，同时把每次写入保留为可审阅的 Suggested changes；
3. 强大的 Room、Jobs 和 Git Knowledge 能否在需要时出现，而不增加默认路径的认知成本。

## 指导原则

### 1. 一个人，不是假装多人团队

产品只服务一个 human owner。底层 singleton Organization 提供隔离和权限边界；多个 `AgentProfile` 提供
不同 AI 能力。schema 中存在 membership/role 不代表产品已经有多人、登录、邀请或 SSO。

### 2. 先聊，再决定是否形成 Wiki

首页首先是 Chat。用户可以问一个临时问题，也可以逐步形成长期主题。系统不得把每次消息都变成项目、
空容器或占位文档。AI 只能建议创建 Wiki Space；owner 明确确认才创建。

### 3. 对话连续，空间不是复制品

确认创建后，Wiki Space 接管同一个 Session。空间是对已有工作的持久组织，不是复制聊天、重新起步或把
用户踢进另一套 Agent UI。

### 4. Wiki Space 与 Page 是产品对象

- **Wiki Space** = canonical Project root facade。
- **Page** = `Document` facade。

Project/Deliverable/Content/Node 只保留为内部兼容、图结构或历史记录中的词。新 UI、帮助文档和公共契约
不再要求用户理解这些实现名。

### 5. AI suggests，human applies

AI 可以生成计划、草稿和跨文件 Suggested changes，但 live Page 的写入决定属于 owner。review/diff 必须先于 apply；CAS、
revision 和 hash 校验必须由受信边界执行。Git Knowledge 同样需要 human approve，但使用独立 trusted merge
lifecycle。

### 6. 默认简单，高级可达

Chat、Wiki Spaces、Pages 是默认层。Room、Agents、Team Tasks、Execution Jobs、Git Knowledge 是 Advanced
层。Advanced 不是隐藏功能，而是按需展开的能力；它不能再次占据首页或 Wiki Space 默认 tab。

### 7. 两种知识，不混为一谈

Wiki Space 是人类可读、可直接评审的知识源；Git `KnowledgeSpace` 是 Agent/Runtime 的受审仓库。前者通过
Pages 工作，后者通过 binding、suggested branch、change request、CAS merge 和 ready snapshot 工作。它们可以
互相引用，但不能成为同一个对象。

## 产品层级

```text
成形
├── Home Chat
├── Wiki Spaces
│   └── Wiki Space
│       ├── Chat (same Session after creation)
│       ├── Pages
│       │   ├── current draft
│       │   ├── comments / review
│       │   └── versions / recovery
│       ├── Support Material
│       └── Context / Workflow
├── Advanced
│   ├── Room
│   ├── Agents
│   ├── Team Tasks
│   ├── Execution Jobs
│   └── Git Knowledge
└── Settings
```

## 关键旅程

### 从临时问题到长期 Wiki

1. owner 在 Home Chat 提问。
2. 助手回答、追问或形成草稿；此时没有 Wiki Space。
3. 助手识别到长期价值，展示“创建 Wiki Space”建议，说明拟用名称和首页内容。
4. owner 取消：继续原 Chat，不产生任何空空间。
5. owner 确认：幂等创建 canonical root，同一个 Session 绑定到新空间，继续当前对话。
6. 后续结果进入 Pages，版本和评审围绕 Page 生长。

### 修改一个 Page

1. owner 在 Chat 或 Page comment 中表达意图。
2. AI 读取有预算、有来源标记的 Space/Page context。
3. AI 产生 Suggested changes，不改变 live draft。
4. owner 查看 diff，选择 apply 或 discard。
5. trusted command 以 CAS 原子应用，并产生必要 recovery checkpoint。

### 调用 AI 团队和长跑能力

1. owner 从 Advanced 打开 Room，或在明确动作中委派给 Agent。
2. Room 用 typed mention/reply、grant 和 confirmation 协调多个 Agents。
3. 需要离线/隔离工作时才创建 durable Execution Job。
4. Job 结果进入 review；不能跳过 owner 直接改 Page 或完成 TeamTask。
5. Git Knowledge 变更进入独立人工审阅和 trusted merge。

## 信息架构规则

- 首页主输入是 **Ask Assistant / 问助手**；**Create Wiki Space / 创建 Wiki 空间** 是显式次级动作或
  conversation suggestion。
- 没有 Wiki Spaces 时展示 Chat，而不是一个催促创建容器的 empty state。
- Wiki Space 列表显示最近 Page 和继续对话入口；不显示“项目交付物数”。
- Space 内左侧是 Pages、搜索、支持资料；中间是当前 Page；右侧默认是 Chat/Review。
- 普通 Chat/Wiki/Page 流程不展示 runtime selector、lease/attempt、recovery 或 Git merge 控制台。
- Room/Agents/Tasks/Jobs/Git Knowledge 放在 Advanced 分组，可直接访问但不与 Pages 平铺。
- rename/move/delete/link 属于对象菜单；View 只控制当前 Page 的呈现方式。

## 术语表

| 术语 | 定义 | 不是 | 实现映射 |
| --- | --- | --- | --- |
| Organization | 当前部署唯一的本地隔离边界 | tenant picker、多家公司 | `Organization` singleton |
| human owner | 唯一最终决策者 | 可邀请的团队成员集合 | `User + owner membership` |
| Agent | AI 协作者配置 | human account | `AgentProfile` |
| Wiki Space | 长期主题/目标的 Page 容器 | Git repo、Room、临时 Chat | canonical Project root facade |
| Page | 可编辑、评审、版本化的内容单元 | Deliverable、Chat message | `Document` facade |
| Chat | 默认连续助手会话 | 自动创建 Wiki 的命令 | `Session + ChatMessage` |
| Room | 高级多 Agent 协作面 | 默认 Chat | `Room + RoomAgentSession` |
| Execution Job | 高级 durable machine work | Chat run 或 Page status | `ExecutionJob + Attempt` |
| Git Knowledge | Agent/Runtime 的受审 Git 知识 | Wiki Space | `KnowledgeSpace` lifecycle |

## 产品状态与迁移

2026-08-22 的交付树证明了 Web-only Room、durable Execution、suggest/apply 和 Git Knowledge 等底层能力。
当时“Project Room default”是该历史 workstream 的验收事实。2026-08-23 起，当前 workstream 将默认入口
迁为 Home Chat，并把旧 Project/Deliverable 可见语言收敛成 Wiki Space/Page facade。

因此必须区分：

- 历史 gate 数字继续只证明当时的 Project Room baseline；
- 文档与 i18n 迁移不等于 Home Chat/same-Session behavior 已全部实现；
- 当前实现进度只能由新 workstream 的代码、测试和 dated same-tree gate 证明；
- 旧 internal names 可阶段性存在，但不能继续决定产品信息架构。

## 不变量与非目标

- Web-only；不恢复 desktop/Electron。
- trusted local single-user；不宣称 multi-user/login/invite/SSO。
- OpenHands 保持 disabled/offline/capacity-zero/fail-closed。
- tldraw watermark 不隐藏；生产许可证另行处理。
- AI prepares Suggested changes/human applies；任何 Agent/Runtime 都无直接 apply/merge authority。
- remote Git credential/fetch/push、monorepo subpath mount 和未知 dirty workspace 自动恢复不在范围内。
- 不把成形做成默认暴露基础设施的 IDE、Agent dashboard 或项目管理器。

## 北极星验收

- 首页的一次普通 Chat 不新增 Wiki Space。
- owner 明确确认后只创建一个 canonical root，并保持原 Session ID。
- 用户主路径只需理解 Wiki Space/Page/Chat；高级对象收拢在 Advanced。
- 一个 owner 可维护多个 Wiki Spaces，一个 Space 可有多个 Pages。
- AI 修改在 human apply 前不改变 live Page draft。
- Git Knowledge 在名称、导航和 authority 上都与 Wiki Space 分离。
- 产品不出现 multi-user/login 已交付的暗示。
- 新代码和文档继续通过 Web-only、OpenHands fail-closed、tldraw watermark 与完整门禁边界。

## 决策优先级

遇到冲突时按以下顺序决策：

1. owner 对写入和长期保存的明确控制；
2. Chat 到 Wiki 的上下文连续性；
3. Wiki Space/Page 心智的一致性；
4. 默认路径的简单程度；
5. Advanced 能力的完整性；
6. 历史内部命名和迁移便利性。

本文件定义产品方向，不把尚未通过新门禁的实现描述为已完成。详细流程与验收以
[一人 AI Wiki brief](./briefs/one-person-ai-wiki.md) 为准；持久化和权限不变量以 [SYSTEM.md](../SYSTEM.md)
与 [CONSTRAINTS.md](../CONSTRAINTS.md) 为准。
