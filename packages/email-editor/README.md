# @inboxzero/email-editor

面向 Inbox Zero 的可复用邮件撰写基础原语。该包将服务商交换格式保持为
HTML，同时把可移植的邮件正确性规则与 React 编辑界面分离，后者基于
[Squire](https://github.com/fastmail/Squire) 构建。

## 安装

```sh
pnpm add @inboxzero/email-editor
```

可移植核心以 JavaScript 构建，附带 TypeScript 声明，且不会加载 React 或
编辑器：

```ts
import {
  finalizeEditableEmailHtml,
  prepareEmailDraft,
  validateEmailAttachments,
} from "@inboxzero/email-editor/core";
```

`@inboxzero/email-editor/web` 的使用者还必须安装该包声明的对等依赖：
React、`squire-rte` 和 `dompurify`。这些对等依赖是可选的，因此原生和后端
使用者可以在不引入 Web 编辑器技术栈的情况下安装核心包。

## 导出

- `@inboxzero/email-editor/core` — 引用与签名拆分、共享的邮件安全 HTML
  清理器、内联 Content-ID 重写、附件校验以及公开契约。
- `@inboxzero/email-editor/web` — 非受控的 React 编辑器。
- `@inboxzero/email-editor/fixtures` — 用于测试的匿名 Gmail 与 Outlook
  风格 HTML 夹具以及清理器攻击用例。

编辑器基于邮件安全 HTML 工作：表格、带样式的块、字体和托管图片在加载、编辑
和发送过程中都能保留。一个配置（`core/email-profile.ts`）同时驱动浏览器端
清理器（DOMPurify，在加载、粘贴、拖放和插入时运行）以及
`finalizeEditableEmailHtml` 在发送前应用的 parse5 清理器。从未编辑过的
草稿会以 `"original"` 模式上报，并按加载时的原样发送。

签名会作为可编辑内容加载到单个容器中，该容器会折叠在 "⋯" 开关之后；折叠
时它会与可编辑 DOM 分离，因此输入和删除都不会在不可见的情况下改变它。引用的
消息保持受保护状态，仅在发送时才与回复合并。撰写过程中绝不会从远程图片的
主机获取它们：`resolveRemoteImages` prop 会将它们映射为代理 URL，而发送的
HTML 会保留原始地址。

内联图片在编辑时使用临时的本地预览 URL。发送前，
`finalizeEditableEmailHtml` 会把匹配的预览转换为 `cid:` 引用；服务商适配器
必须发送带有相同 Content-ID 的对应 MIME/Graph 附件。

## 发布

工作区清单在本地开发时指向源文件。`pnpm pack:check` 会把公开包构建到 `dist`
并校验其 tarball 内容。测试和类型检查通过后，经授权的维护者可以用以下命令
发布生成好的包：

```sh
cd dist
pnpm publish --access public --otp <one-time-password>
```
