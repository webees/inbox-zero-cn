# 共享邮件包

`@inboxzero/mail-core`、`@inboxzero/mail-sqlite` 和 `@inboxzero/mail-react`
是 Web 和桌面端使用的邮箱引擎。`@inboxzero/mail-ui` 是
React DOM 展示层，保留在本应用中。Expo 适配器保留在
移动应用中。

Web 和桌面端会把 `HostRuntime` 传给 store 和引擎。附件
在附加时就会被添加到服务商的邮箱草稿中，带文件的发送
会从该草稿发出，因此引擎绝不会持有它们的字节。
排队的发送通过 `observeOperation` 进行监视。

## 发布

推送到 `main` 且改动了 `packages/mail-core`、`packages/mail-sqlite`
或 `packages/mail-react` 时，会把这些包发布到 npm。它们共享同一个
版本。该工作流会构建每个包并发布其 `dist` 清单，
顺序为 core、sqlite、react，并跳过已在 npm 上的版本。
合并前，请在每个发生变更的包以及依赖它的包中
提升版本号。移动端依赖已发布的版本。

1. `pnpm -F @inboxzero/mail-core -F @inboxzero/mail-sqlite -F @inboxzero/mail-react run build`
2. `pnpm -F @inboxzero/mail-core pack:smoke`
3. dist 清单会把 `workspace:*` 改写为该版本，并把 `publishConfig.access` 设为 `public`。

不要在非 Node 宿主中导入 `@inboxzero/mail-sqlite/node`。该入口
点使用 Node 文件 API。

## 账号设置 API

已安装的客户端可以通过[拆分收件箱 REST API](mail-api-splits.md)
编辑拆分收件箱标签页并解析库预设。
