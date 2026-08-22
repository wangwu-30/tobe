# Web Preview Runtime

更新时间：2026-03-22

## 核心结论

- 日常迭代门禁使用 `npm run verify:iteration`；Web production build 与三个独立 Node 服务的构建均包含在门禁中。
- 只要 web 结果面实际运行在独立 preview origin，上层页面就不能继续直接读 iframe DOM；评论、聚焦和高亮都必须先过同源 bridge。
- preview 启动后的短时 `502` 或刷新空窗属于 runtime 恢复问题，不该把主表面卡死在“已启动但没内容”的状态。

## 默认做法

- 普通产品切片跑 `verify:iteration`，发布前同样以这条 Web-only 门禁为准。
- web preview 默认加载同源 bridge URL，让 iframe 负责回传选区、元素锚点和高亮信号。
- 刷新或重新进入页面时，优先根据当前 view / runs 恢复 preview bridge，而不是要求用户手动再点一次启动。

## 常见坑

- 绕过 `verify:iteration` 只跑单条浏览器测试，会漏掉 Web build 和独立 Node 服务回归。
- 父页面直接读 cross-origin iframe DOM，会让评论入口、高亮回放和 selector 锚点全部变得不稳定。
- preview bridge 只处理“理想成功路径”，不处理刷新后 warmup / pending / 502 回稳，用户就会反复遇到空态。

## 关键参考

- [`../testing/iteration-regression-plan.md`](../testing/iteration-regression-plan.md)
- [`../unified-deliverable-model-tracker.md`](../unified-deliverable-model-tracker.md)
- [`../chengxing-project-status.md`](../chengxing-project-status.md)
