# Playwright 迭代回归

更新时间：2026-03-22

## 核心结论

- 日常功能交付的正式门禁是 `npm run verify:iteration`，不是单条 spec，也不是只跑 `tsc` / `eslint`。
- 回归必须跑在隔离 app-data root、隔离数据库和命名 seed 上，不能复用真实开发数据。
- selector 应该绑定稳定结构 id 或 API 返回 id，避免对共享文本做全局 `getByText(...)`。
- seed 要复现真实产物落点，不能为了省事把文件、报告或版本状态塞到一个假的简化位置。

## 默认做法

- 关闭功能或 bug thread 前，执行一次 `npm run verify:iteration`。
- 调试时可以单跑 spec，但修完后必须回到全量门禁。
- 对 Note、版本、项目树这类会跨测试复用的数据，优先断言稳定 id、scope badge 或明确容器，而不是裸文本。
- 当产品改变默认路径、目录或运行时派生规则时，先改 seed / helper / regression plan，再认为功能真的收口。

## 常见坑

- 只看单条 Playwright 绿灯就关闭任务，后面很容易在 static gate、bootstrap 或别的场景矩阵里翻车。
- 共享 user-scope note、编辑器 textarea 回显、重复标题这些场景，会让 strict locator 假红。
- 种子和真实产品写入路径不一致时，回归通过不代表用户路径真的通。

## 关键参考

- [`../testing/iteration-regression-plan.md`](../testing/iteration-regression-plan.md)
- [`../chengxing-lessons-learned.md`](../chengxing-lessons-learned.md)
