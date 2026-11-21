# @inboxzero/mail-react

邮件引擎门面的轻量 `useSyncExternalStore` 绑定。此包不拥有邮箱状态、不与服务商通信，也不导入 React DOM。

对等依赖：React >= 19.2。

```ts
import { MailEngineProvider } from "@inboxzero/mail-react/MailEngineProvider";
import { useMailboxWindow } from "@inboxzero/mail-react/use-mailbox-window";
import { useConversation } from "@inboxzero/mail-react/use-conversation";
import { useOperation } from "@inboxzero/mail-react/use-operation";
```
