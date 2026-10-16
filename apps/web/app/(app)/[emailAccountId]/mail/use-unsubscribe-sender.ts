"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { usePremiumModal } from "@/app/(app)/premium/PremiumModal";
import type { NewsletterStatsResponse } from "@/app/api/user/stats/newsletters/route";
import { usePremium } from "@/hooks/usePremium";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useArchiveSenderQueueActions } from "@/store/archive-sender-queue";
import { decrementUnsubscribeCreditAction } from "@/utils/actions/premium";
import {
  setSenderStatusAction,
  unsubscribeSenderAction,
} from "@/utils/actions/unsubscriber";
import {
  canonicalizeEmailAddress,
  extractEmailAddress,
  extractNameFromEmail,
} from "@/utils/email";
import { assertActionSucceeded, captureException } from "@/utils/error";
import { NewsletterStatus } from "@/generated/prisma/enums";
import {
  getHttpUnsubscribeLink,
  getUserFacingUnsubscribeLink,
} from "@/utils/parse/unsubscribe";
import type { ParsedMessage } from "@/utils/types";
import { createSearchParams } from "@/utils/url";

/**
 * 邮件列表与阅读器共用的发件人操作。
 *
 * 消息的 `List-Unsubscribe` 头立即可用。当发件人被指定时，客户端还会
 * 检查批量退订所使用的发件人统计，这样此前从邮件正文中索引到的链接
 * 在这里仍然可用。
 *
 * 一键退订头会在服务端完成退订并标记发件人；当这一步失败，或发件人
 * 只提供 mailto 时，用户会拿到链接。
 */
export function useUnsubscribeSender(
  message: Pick<ParsedMessage, "headers" | "threadId"> | null,
) {
  const { emailAccountId } = useAccount();
  const { hasUnsubscribeAccess, mutate: refetchPremium } = usePremium();
  const { PremiumModal, openModal } = usePremiumModal();
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);
  const [updatedAutoArchive, setUpdatedAutoArchive] = useState<{
    sender: string;
    enabled: boolean;
  } | null>(null);
  const [isUpdatingAutoArchive, setIsUpdatingAutoArchive] = useState(false);

  const listUnsubscribeHeader = message?.headers["list-unsubscribe"] ?? null;
  const from = message?.headers.from ?? "";
  const senderEmail = extractEmailAddress(from);
  const senderName = extractNameFromEmail(from);
  const senderStatsUrl = senderEmail
    ? `/api/user/stats/newsletters?${createSearchParams({
        types: [],
        search: senderEmail,
        orderBy: "emails",
        orderDirection: "desc",
        includeMissingUnsubscribe: true,
      })}`
    : null;
  const {
    data: senderStats,
    mutate: refetchSenderStats,
    isLoading: isSenderStatsLoading,
  } = useSWR<NewsletterStatsResponse>(
    senderStatsUrl ? [senderStatsUrl, emailAccountId] : null,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
  const canonicalSenderEmail = canonicalizeEmailAddress(senderEmail);
  const sender = senderStats?.newsletters.find(
    (sender) => sender.name === canonicalSenderEmail,
  );
  const unsubscribeLink = sender?.unsubscribeLink;
  const httpLink = getHttpUnsubscribeLink({
    unsubscribeLink,
    listUnsubscribeHeader,
  });
  const userFacingLink = getUserFacingUnsubscribeLink({
    unsubscribeLink,
    listUnsubscribeHeader,
  });
  const canUnsubscribe = Boolean(senderEmail && userFacingLink);
  const updatedAutoArchiveEnabled =
    updatedAutoArchive?.sender === canonicalSenderEmail
      ? updatedAutoArchive.enabled
      : undefined;
  const isAutoArchived =
    updatedAutoArchiveEnabled ??
    (senderStats?.searchedSenderStatus === NewsletterStatus.AUTO_ARCHIVED ||
      Boolean(sender?.autoArchived));
  const isAutoArchiveStatusLoading = Boolean(
    senderEmail && !senderStats && updatedAutoArchiveEnabled === undefined,
  );

  const onToggleAutoArchive = useCallback(async () => {
    if (!senderEmail || isAutoArchiveStatusLoading || isUpdatingAutoArchive)
      return;

    if (!isAutoArchived && !hasUnsubscribeAccess) {
      openModal();
      return;
    }

    setIsUpdatingAutoArchive(true);
    const toastId = toast.loading(
      `${isAutoArchived ? "正在关闭" : "正在开启"} ${senderName} 的自动归档`,
    );

    try {
      const result = await setSenderStatusAction(emailAccountId, {
        senderEmail,
        status: isAutoArchived ? null : NewsletterStatus.AUTO_ARCHIVED,
      });
      assertActionSucceeded(result);
      refetchSenderStats().catch(captureException);
      setUpdatedAutoArchive({
        sender: canonicalSenderEmail,
        enabled: !isAutoArchived,
      });
    } catch (error) {
      captureException(error);
      toast.error(
        `无法${isAutoArchived ? "关闭" : "开启"} ${senderName} 的自动归档`,
        { id: toastId },
      );
      return;
    } finally {
      setIsUpdatingAutoArchive(false);
    }

    if (isAutoArchived) {
      toast.success(`来自 ${senderName} 的以后的邮件将留在收件箱`, {
        id: toastId,
      });
      return;
    }

    toast.success(`来自 ${senderName} 的以后的邮件将被自动归档`, {
      id: toastId,
    });

    // 这些后续任务不会改变刚刚提交的服务商过滤器，因此它们失败时
    // 不能把这次开启报告为失败。
    queueArchiveSenders({ senders: [senderEmail] }).catch(captureException);
    decrementUnsubscribeCreditAction()
      .then(() => refetchPremium())
      .catch(captureException);
  }, [
    canonicalSenderEmail,
    refetchSenderStats,
    emailAccountId,
    hasUnsubscribeAccess,
    isAutoArchived,
    isAutoArchiveStatusLoading,
    isUpdatingAutoArchive,
    openModal,
    queueArchiveSenders,
    refetchPremium,
    senderEmail,
    senderName,
  ]);

  const onUnsubscribe = useCallback(async () => {
    if (
      !senderEmail ||
      isUpdatingAutoArchive ||
      (isSenderStatsLoading && !httpLink)
    )
      return;
    if (!canUnsubscribe) {
      if (isAutoArchiveStatusLoading) return;
      if (!isAutoArchived) await onToggleAutoArchive();
      return;
    }
    if (!userFacingLink) return;

    if (!hasUnsubscribeAccess) {
      openModal();
      return;
    }

    // 让用户去编写 mailto 邮件是最后的手段：http 链接会打开一个能
    // 完成操作的页面，因此当两者都存在时优先选它。
    const manualLink = httpLink ?? userFacingLink;

    if (!httpLink) {
      openUnsubscribePage(userFacingLink);
      return;
    }

    const toastId = toast.loading(`正在退订 ${senderName}`);
    const failed = () =>
      toast.error(`无法退订 ${senderName}`, {
        id: toastId,
        action: {
          label: "打开页面",
          onClick: () => openUnsubscribePage(manualLink),
        },
      });

    try {
      const result = await unsubscribeSenderAction(emailAccountId, {
        senderEmail,
        unsubscribeLink,
        listUnsubscribeHeader,
      });
      if (!result?.data?.unsubscribe.success) {
        failed();
        return;
      }
    } catch {
      failed();
      return;
    }

    toast.success(`已退订 ${senderName}`, { id: toastId });

    queueArchiveSenders({ senders: [senderEmail] }).catch(() => {});

    // 计量在事后进行，两部分都不会改变用户刚刚看到的结果：
    // 这里的失败不应被理解为退订失败。
    decrementUnsubscribeCreditAction()
      .then(() => refetchPremium())
      .catch(() => {});
  }, [
    canUnsubscribe,
    isSenderStatsLoading,
    isAutoArchiveStatusLoading,
    isUpdatingAutoArchive,
    isAutoArchived,
    onToggleAutoArchive,
    emailAccountId,
    hasUnsubscribeAccess,
    httpLink,
    listUnsubscribeHeader,
    openModal,
    refetchPremium,
    senderEmail,
    senderName,
    unsubscribeLink,
    userFacingLink,
    queueArchiveSenders,
  ]);

  return {
    isUnsubscribeDisabled:
      isUpdatingAutoArchive ||
      (isSenderStatsLoading && !httpLink) ||
      (!canUnsubscribe && (isAutoArchiveStatusLoading || isAutoArchived)),
    unsubscribeLabel: canUnsubscribe
      ? "退订发件人"
      : isAutoArchived
        ? "发件人已屏蔽"
        : "屏蔽发件人",
    canManageAutoArchive: Boolean(senderEmail),
    isAutoArchived,
    isAutoArchiveStatusLoading,
    isUpdatingAutoArchive,
    onToggleAutoArchive,
    onUnsubscribe,
    PremiumModal,
  };
}

function openUnsubscribePage(link: string) {
  window.open(link, "_blank", "noopener,noreferrer");
}
