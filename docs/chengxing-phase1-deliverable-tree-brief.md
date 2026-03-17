# Phase 1 交付物树最小对象模型简报

更新时间：2026-03-14
状态：基础闭环已完成，用于冻结 `Phase 1` 的对象边界，避免把源码文件树误当成交付物树。

## 现状

当前代码里的真实主对象仍然是“单交付物工作区”，但 `Phase 1` 的项目树外壳已经开始落地。

- `Document / workspace` 目前承载的是一个交付物的完整工作现场，而不是“一个项目里的多个交付物”。
- `workspace_file` 虽然已经支持 `parentId`、`file/folder` 和 `role=deliverable|support`，但这层树当前表达的是工作文件，而不是产品意义上的交付物树。
- `buildDeliverable()` 仍然通过 primary file 推导当前交付物，说明系统默认前提还是“一个 workspace 只有一个当前交付物”。
- 版本、评论、对话、预览、状态面板目前都围绕当前 workspace 运转，没有独立的“交付物叶子节点”边界。
- `web / code` 类型的一个交付物天然可能包含多个源码文件，所以现有源码文件树不能直接等价成多个交付物。
- 当前实现里已经补出 `projectId / projectTitle / projectFolderId` 和独立 `ProjectFolder` 对象；左栏 `Project Tree` 现在能显示 `folder -> deliverable` 的混合树，并支持显式移动、直接拖放到新的父文件夹，以及同层上移/下移。
- 新建 deliverable 已开始直接继承 `projectFolderId`；`parentDocumentId` 已退出 Phase 1 的产品表面和新建路径。
- `Document` 和 `ProjectFolder` 已共享 `treeSortOrder`，项目树的同层顺序不再继续靠 `updatedAt` 假装稳定。
- 当前明确按绿地前提推进，不再为了旧数据迁移保留 `parentDocumentId` 或旧排序链路的产品兼容。

## 目标

Phase 1 的目标是让“一个项目包含多个交付物”先成立，同时保持中央和右侧仍只服务当前交付物，而不是把源码文件树误包装成交付物树。

- 用户可见的树节点先只保留 `文件夹 Folder` 和 `交付物 Deliverable`。
- 交付物节点必须是叶子节点，并且它才拥有版本、评论、对话、上下文和预览。
- 源码文件、页面实现文件、资源文件继续留在交付物内部，不直接冒充项目树上的兄弟交付物。

## 差距

当前实现和目标之间剩下的结构性差距已经不在对象树本身，而在 `Phase 2` 的版本基点：

1. `Phase 1` 的树关系已经稳定落在 `projectFolderId + treeSortOrder`。
   Folder / deliverable 的新建、重命名、删除、显式移动、直接拖放、同层显式重排都已落地。
2. 中央和右侧虽然仍保持单 deliverable 解释，但版本、评论、对话的唯一基点还没完全冻结。
   这意味着后续问题不再是“项目树怎么搭”，而是“branch / checkpoint / version 用哪一个对象名和附着关系”。

## 执行计划

1. 继续把 `ProjectFolder` 保持为唯一文件夹对象。
   不能回退去复用 `workspace_file` 或 `parentDocumentId` 充当项目树文件夹。
2. 新建 deliverable 继续默认挂到 `projectFolderId`。
   Phase 1 的树关系只认 `projectFolderId`，不再让 `parentDocumentId` 回流到产品表面。
3. 当前交付物切换继续保持成“同项目内切换当前 workspace”。
   中央主表面和右侧助手栏仍只解释当前 deliverable，不提前重做版本和评论附着模型。
4. `Phase 1` 到这里先收口，不再继续扩项目树语义。
   后续优先级切到 `Phase 2`，先冻结版本基点，再谈评论继承和 workflow reuse。
5. 源码文件树继续留在交付物内部。
   对 `web / code`，项目树节点只显示“首页 Web”“FAQ Web”这类交付物，不显示 `index.tsx / styles.css` 这类实现文件。

## 验收标准

- 同一个项目下可以出现多个交付物叶子节点，但中央主表面任意时刻仍只显示一个当前交付物。
- 同一个项目下可以出现文件夹节点，且 folder 只负责组织，不会夺走中央表面的唯一 deliverable 焦点。
- `web / code` 交付物在项目树里仍然只显示为单个交付物节点，不会被拆成源码文件兄弟节点。
- 切换交付物后，右侧 `Status / Review / Chat / Context` 仍然能围绕唯一当前交付物解释清楚。
- 版本、评论、对话的附着对象仍然是单个交付物，不会因为项目树引入而重新漂回 workspace 全局。
- 如果暂时不打开这个简报，仅看运行中的产品，也不会把源码文件树误解为交付物树。
