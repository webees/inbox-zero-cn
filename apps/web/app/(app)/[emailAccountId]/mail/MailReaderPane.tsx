"use client";

import { type ComponentProps, memo, useCallback } from "react";
import { BufferedThreadReader } from "@/app/(app)/[emailAccountId]/mail/BufferedThreadReader";
import { MailPanelErrorBoundary } from "@/app/(app)/[emailAccountId]/mail/MailPanelErrorBoundary";
import { MessageActionsMenu } from "@/app/(app)/[emailAccountId]/mail/MessageActionsMenu";
import { ThreadActionsMenu } from "@/app/(app)/[emailAccountId]/mail/ThreadActionsMenu";
import {
  ThreadReader,
  type ThreadReaderProps,
} from "@/app/(app)/[emailAccountId]/mail/ThreadReader";
import type { ThreadSelection } from "@/app/(app)/[emailAccountId]/mail/types";
import type { ThreadMessage } from "@/components/email-list/types";
import { useThreadPlans } from "@/hooks/useThreadPlans";
import { EmailAccountScopeProvider } from "@/providers/EmailAccountProvider";

const NO_PLANS: never[] = [];

type ReaderEmailAccount = ComponentProps<
  typeof EmailAccountScopeProvider
>["emailAccount"];

/**
 * 已打开的会话。已记忆化，这样列表快照、选择以及其他
 * 屏幕状态只有在它显示的内容发生变化时才会重新渲染它。
 */
export const MailReaderPane = memo(function MailReaderPane({
  readerEmailAccount,
  readerKey,
  planSelection,
  dataReady,
  onReady,
  onClose,
  showFixWithChat,
  lastMessage,
  isStarred,
  onToggleStar,
  onMarkSpam,
  onDelete,
  onLabel,
  onMove,
  onTranslate,
  onComment,
  isMenuOpen,
  onMenuOpenChange,
  ...readerProps
}: Omit<ThreadReaderProps, "onBackToInbox" | "menu" | "renderMessageMenu"> & {
  /** 在拥有已打开会话的账号仍在加载时未定义。 */
  readerEmailAccount: ReaderEmailAccount;
  /** 已打开的会话，空阅读器时为 null。 */
  readerKey: string | null;
  /** 已确定的选项，邮件菜单会显示其匹配到的规则。 */
  planSelection: ThreadSelection | null;
  dataReady: boolean;
  onReady: (threadKey: string) => void;
  onClose: () => void;
  showFixWithChat: boolean;
  lastMessage: ThreadMessage | null;
  isStarred: boolean;
  onToggleStar: () => void;
  onMarkSpam: () => void;
  onDelete: () => void;
  onLabel?: () => void;
  onMove?: () => void;
  onTranslate?: () => void;
  onComment?: () => void;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const { data: planData } = useThreadPlans({
    threadId: planSelection?.threadId,
    emailAccountId: planSelection?.emailAccountId,
  });
  const plans = planData?.plans ?? NO_PLANS;
  const renderMessageMenu = useCallback(
    (message: ThreadMessage) => (
      <MessageActionsMenu
        message={message}
        plans={plans}
        showFixWithChat={showFixWithChat}
      />
    ),
    [plans, showFixWithChat],
  );

  if (readerKey && !readerEmailAccount) {
    return (
      <div
        aria-label="正在加载"
        className="flex min-h-0 min-w-0 flex-1 items-center justify-center text-muted-foreground text-sm"
        role="status"
      >
        正在加载…
      </div>
    );
  }

  return (
    <MailPanelErrorBoundary
      resetKey={readerKey ?? "empty"}
      title="无法显示此会话"
      onBack={onClose}
    >
      <EmailAccountScopeProvider emailAccount={readerEmailAccount}>
        <BufferedThreadReader
          key={readerEmailAccount?.id ?? "empty"}
          threadKey={readerKey ?? "empty"}
          dataReady={dataReady}
          onReady={onReady}
        >
          <ThreadReader
            {...readerProps}
            onBackToInbox={onClose}
            renderMessageMenu={renderMessageMenu}
            menu={
              <ThreadActionsMenu
                message={lastMessage}
                isStarred={isStarred}
                onToggleStar={onToggleStar}
                onMarkSpam={onMarkSpam}
                onDelete={onDelete}
                onLabel={onLabel}
                onMove={onMove}
                onTranslate={onTranslate}
                onComment={onComment}
                open={isMenuOpen}
                onOpenChange={onMenuOpenChange}
              />
            }
          />
        </BufferedThreadReader>
      </EmailAccountScopeProvider>
    </MailPanelErrorBoundary>
  );
});
