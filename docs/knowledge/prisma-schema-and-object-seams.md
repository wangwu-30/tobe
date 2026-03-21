# Prisma Schema 与 Object Seam 演进

更新时间：2026-03-22

## 核心结论

- 本地已有 SQLite 库时，不要把 `prisma migrate deploy` 当成默认开发入口；先走仓库自己的 bootstrap 路径。
- schema 演进优先走 additive seam，再做读侧 hydration，最后做写侧 cutover 和 legacy 退场。
- legacy 字段、旧表或旧 route 真要保留，也只能留在 schema mapping / normalize 层，不能继续进入 CRUD、查询条件和正式对象 contract。
- 新 contract 落地时，要同时把 schema、types、object seam 和 route surface 对齐；不要只改一层。

## 默认做法

- 本地开发和桌面 runtime 默认走 [`../local-full-app.md`](../local-full-app.md) 里的 bootstrap 路径。
- 做模型替换时，先让新表或新 object seam 跑通门禁，再开始删旧读写。
- 如果一个字段已经降为 legacy 兼容，收口标准应明确到 `rg` 层面，例如“只剩类型定义和 schema mapping 命中”。
- 用户可见语义先在 contract 文档里写清，再进 migration 和代码。

## 常见坑

- 把“新模型出生”和“旧字段退场”绑成一刀，回归失败后很难定位是 migration、query wiring 还是业务语义切换。
- 旧字段虽然不再写，但如果查询条件或 AI-facing 摘要还在读，它就仍然是活的主语义。
- 只合并存储，不同时校准 UI 和 AI contract，会留下“底层统一了，表面还是两套词”的假收口。

## 关键参考

- [`../local-full-app.md`](../local-full-app.md)
- [`../chengxing-refactor-tracker.md`](../chengxing-refactor-tracker.md)
- [`../chengxing-lessons-learned.md`](../chengxing-lessons-learned.md)
