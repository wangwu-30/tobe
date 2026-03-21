# Desktop 与 Preview Runtime

更新时间：2026-03-22

## 核心结论

- 日常迭代门禁和桌面打包门禁要分层：`npm run verify:iteration` 关功能，`npm run desktop:smoke:packaged` 只在打包 / 发布前执行。
- 只要 web 结果面实际运行在独立 preview origin，上层页面就不能继续直接读 iframe DOM；评论、聚焦和高亮都必须先过同源 bridge。
- preview 启动后的短时 `502` 或刷新空窗属于 runtime 恢复问题，不该把主表面卡死在“已启动但没内容”的状态。

## 默认做法

- 普通产品切片先跑 `verify:iteration`；只有真的在验收桌面包或发布链路时，才补跑 packaged smoke。
- web preview 默认加载同源 bridge URL，让 iframe 负责回传选区、元素锚点和高亮信号。
- 刷新或重新进入页面时，优先根据当前 view / runs 恢复 preview bridge，而不是要求用户手动再点一次启动。

## 常见坑

- 把 packaged smoke 当成每次迭代必跑项，会显著拖慢反馈回路，但对大部分日常切片并不增加有效信号。
- 父页面直接读 cross-origin iframe DOM，会让评论入口、高亮回放和 selector 锚点全部变得不稳定。
- preview bridge 只处理“理想成功路径”，不处理刷新后 warmup / pending / 502 回稳，用户就会反复遇到空态。

## 关键参考

- [`../testing/iteration-regression-plan.md`](../testing/iteration-regression-plan.md)
- [`../unified-deliverable-model-tracker.md`](../unified-deliverable-model-tracker.md)
- [`../chengxing-project-status.md`](../chengxing-project-status.md)
