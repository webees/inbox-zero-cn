"use client";

import { useCallback, useState, useEffect } from "react";
import { toast } from "sonner";
import { useLocalStorage } from "usehooks-ts";
import { useAction } from "next-safe-action/hooks";
import type { PostHog } from "posthog-js/react";
import { toastSuccess } from "@/components/Toast";
import {
  setSenderStatusAction,
  unsubscribeSenderAction,
} from "@/utils/actions/unsubscriber";
import { decrementUnsubscribeCreditAction } from "@/utils/actions/premium";
import { NewsletterStatus } from "@/generated/prisma/enums";
import {
  assertActionSucceeded,
  captureException,
  EmailProviderRateLimitError,
} from "@/utils/error";
import {
  addToArchiveSenderThreadQueue,
  useArchiveSenderQueueActions,
} from "@/store/archive-sender-queue";
import type {
  NewsletterFilterType,
  Row,
} from "@/app/(app)/[emailAccountId]/bulk-unsubscribe/types";
import type { UserResponse } from "@/app/api/user/me/route";
import {
  bulkArchiveAction,
  bulkTrashAction,
} from "@/utils/actions/mail-bulk-action";
import {
  getHttpUnsubscribeLink,
  getUserFacingUnsubscribeLink,
} from "@/utils/parse/unsubscribe";
import { useProductAnalytics } from "@/hooks/useProductAnalytics";
import { fetchAllSenderThreads } from "@/store/fetch-sender-threads";
import { enqueueThreadMailMutationBatch } from "@/utils/mail-engine/thread-mail-mutations";

// SWR mutate 函数的共享类型
type MutateFn = (
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  data?: any,
  opts?: { revalidate?: boolean },
) => Promise<unknown>;

type QueueArchiveSendersFn = (params: { senders: string[] }) => Promise<number>;

type BulkOperationResult = {
  stoppedByRateLimit: boolean;
  total: number;
  successCount: number;
  failureCount: number;
};

function formatSenderNames<T extends Row>(items: T[]): string {
  const names = items.map((item) => item.name);
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")}...`
    : names.join(", ");
}

function itemMatchesFilter(
  status: NewsletterStatus | null | undefined,
  filter: NewsletterFilterType,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unhandled":
      return !status; // 状态为 null/undefined 表示未处理
    case "unsubscribed":
      return status === NewsletterStatus.UNSUBSCRIBED;
    case "autoArchived":
      return status === NewsletterStatus.AUTO_ARCHIVED;
    case "approved":
      return status === NewsletterStatus.APPROVED;
    default:
      return true;
  }
}

// 通用的批量操作处理器，用于减少重复代码
async function executeBulkOperation<T extends Row>({
  items,
  mutate,
  filter,
  onDeselectItem,
  processItem,
  newStatus,
  getNewStatus,
  loadingMessage,
  successMessage,
  errorMessage,
  onComplete,
  onCompleteRevalidates,
  onSuccess,
}: {
  items: T[];
  mutate: MutateFn;
  filter: NewsletterFilterType;
  onDeselectItem?: (id: string) => void;
  processItem: (item: T) => Promise<void>;
  newStatus: NewsletterStatus | null;
  getNewStatus?: (item: T) => NewsletterStatus | null;
  loadingMessage: string;
  successMessage: string;
  errorMessage: string;
  onComplete?: () => Promise<unknown>;
  onCompleteRevalidates?: boolean;
  onSuccess?: () => void;
}): Promise<BulkOperationResult> {
  const total = items.length;
  const toastId = toast.loading(`${loadingMessage} ${total} 个发件人…`, {
    description: `已完成 0 / ${total}`,
  });

  let completed = 0;
  let failureCount = 0;
  let rateLimitError: EmailProviderRateLimitError | undefined;

  const updateItemOptimistically = (item: T) => {
    const optimisticStatus = getNewStatus ? getNewStatus(item) : newStatus;
    mutate(
      // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
      (currentData: any) => {
        if (!currentData?.newsletters) return currentData;
        return {
          ...currentData,
          newsletters: currentData.newsletters
            // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
            .map((n: any) =>
              n.name === item.name ? { ...n, status: optimisticStatus } : n,
            )
            // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
            .filter((n: any) => itemMatchesFilter(n.status, filter)),
        };
      },
      { revalidate: false },
    );
  };

  for (const item of items) {
    updateItemOptimistically(item);

    try {
      await processItem(item);
      onDeselectItem?.(item.name);
    } catch (error) {
      failureCount++;
      if (error instanceof EmailProviderRateLimitError) {
        rateLimitError = error;
      } else if (!(error instanceof AutomaticUnsubscribeFailedError)) {
        captureException(error);
      }
    } finally {
      completed++;
      toast.loading(`${loadingMessage} ${total} 个发件人…`, {
        id: toastId,
        description: `已完成 ${completed} / ${total}`,
      });
    }

    if (rateLimitError) break;
  }

  let didRevalidateOnComplete = false;
  if (onComplete) {
    try {
      await onComplete();
      didRevalidateOnComplete = onCompleteRevalidates === true;
    } catch (error) {
      captureException(error);
    }
  }

  if (rateLimitError) {
    if (!didRevalidateOnComplete) await mutate();
    const successful = completed - failureCount;
    toast.error(rateLimitError.message, {
      id: toastId,
      description: `已完成 ${successful} / ${total}；为避免过多请求已停止`,
    });
    return {
      stoppedByRateLimit: true,
      total,
      successCount: successful,
      failureCount,
    };
  }

  if (failureCount > 0) {
    await mutate();
    toast.error(`${failureCount} 个发件人${errorMessage}`, {
      id: toastId,
      description: `${total - failureCount} / ${total} 成功`,
    });
  } else {
    toast.success(`${total} 个发件人${successMessage}`, {
      id: toastId,
      description: undefined,
    });
    onSuccess?.();
  }

  return {
    stoppedByRateLimit: false,
    total,
    successCount: total - failureCount,
    failureCount,
  };
}

async function unsubscribeAndArchive({
  senderEmail,
  unsubscribeLink,
  mutate,
  refetchPremium,
  emailAccountId,
  queueArchiveSenders,
  archiveExisting,
}: {
  senderEmail: string;
  unsubscribeLink?: string | null;
  mutate: () => Promise<void>;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  emailAccountId: string;
  queueArchiveSenders: QueueArchiveSendersFn;
  archiveExisting: boolean;
}) {
  const unsubscribed = await performAutomaticUnsubscribe({
    emailAccountId,
    senderEmail,
    unsubscribeLink,
  });
  if (!unsubscribed) return false;

  await mutate();
  await decrementUnsubscribeCreditAction();
  if (archiveExisting) await queueArchiveSenders({ senders: [senderEmail] });
  await refreshPremium(refetchPremium);

  return true;
}

async function blockSender({
  sender,
  emailAccountId,
  labelId,
  labelName,
  queueArchiveSenders,
}: {
  sender: string;
  emailAccountId: string;
  labelId?: string;
  labelName?: string;
  queueArchiveSenders: QueueArchiveSendersFn;
}) {
  const statusResult = await setSenderStatusAction(emailAccountId, {
    senderEmail: sender,
    status: NewsletterStatus.AUTO_ARCHIVED,
    labelId,
    labelName,
  });
  assertActionSucceeded(statusResult);
  await decrementUnsubscribeCreditAction();

  if (labelId) {
    await addToArchiveSenderThreadQueue({
      sender,
      labelId,
      emailAccountId,
    });
  } else {
    await queueArchiveSenders({ senders: [sender] });
  }
}

export function useUnsubscribe<T extends Row>({
  item,
  emailAccountId,
  hasUnsubscribeAccess,
  mutate,
  posthog,
  refetchPremium,
}: {
  item: T;
  emailAccountId: string;
  hasUnsubscribeAccess: boolean;
  mutate: () => Promise<void>;
  posthog: PostHog;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
}) {
  const analytics = useProductAnalytics("bulk_unsubscribe");
  const [unsubscribeLoading, setUnsubscribeLoading] = useState(false);
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);
  const [archiveOnUnsubscribe] = useArchiveOnUnsubscribe();
  const automaticUnsubscribeLink = getAutomaticUnsubscribeLink(
    item.unsubscribeLink,
  );
  const userFacingUnsubscribeLink = getManualUnsubscribeLink(
    item.unsubscribeLink,
  );

  const onUnsubscribe = useCallback(async () => {
    if (!hasUnsubscribeAccess) return;

    setUnsubscribeLoading(true);

    // 无论尝试是否失败，发件人自己的页面始终可用，
    // 读者总能找到完成退订的方式。
    const openPageAction = userFacingUnsubscribeLink
      ? {
          label: "打开页面",
          onClick: () =>
            window.open(
              userFacingUnsubscribeLink,
              "_blank",
              "noopener,noreferrer",
            ),
        }
      : undefined;

    try {
      posthog.capture("Clicked Unsubscribe");
      analytics.captureAction("unsubscribe_sender_started", {
        status: item.status,
        has_automatic_unsubscribe_link: Boolean(automaticUnsubscribeLink),
        has_user_facing_unsubscribe_link: Boolean(userFacingUnsubscribeLink),
      });

      if (item.status === NewsletterStatus.UNSUBSCRIBED) {
        const statusResult = await setSenderStatusAction(emailAccountId, {
          senderEmail: item.name,
          status: null,
        });
        assertActionSucceeded(statusResult);
        await mutate();
      } else {
        if (!userFacingUnsubscribeLink) {
          await blockSender({
            sender: item.name,
            emailAccountId,
            queueArchiveSenders,
          });
          analytics.captureAction("unsubscribe_sender_completed", {
            outcome: "blocked_sender",
          });
          toastSuccess({
            description: "发件人已屏蔽。以后的邮件将被自动归档。",
          });
          await mutate();
          await refreshPremium(refetchPremium);
          return;
        }

        if (!automaticUnsubscribeLink) return;

        const unsubscribed = await unsubscribeAndArchive({
          senderEmail: item.name,
          unsubscribeLink: item.unsubscribeLink,
          mutate,
          refetchPremium,
          emailAccountId,
          queueArchiveSenders,
          archiveExisting: archiveOnUnsubscribe,
        });
        if (!unsubscribed) {
          analytics.captureAction("unsubscribe_sender_failed", {
            reason: "automatic_unsubscribe_failed",
          });
          toast.error(`无法退订 ${item.name}`, {
            action: openPageAction,
          });
        } else {
          analytics.captureAction("unsubscribe_sender_completed", {
            outcome: archiveOnUnsubscribe
              ? "unsubscribed_and_archived"
              : "unsubscribed",
          });
        }
      }
    } catch (error) {
      if (error instanceof EmailProviderRateLimitError) {
        toast.error(error.message, { action: openPageAction });
      } else {
        captureException(error);
        toast.error(`无法退订 ${item.name}`, {
          action: openPageAction,
        });
      }
    } finally {
      setUnsubscribeLoading(false);
    }
  }, [
    hasUnsubscribeAccess,
    item.name,
    item.status,
    item.unsubscribeLink,
    automaticUnsubscribeLink,
    analytics,
    mutate,
    refetchPremium,
    posthog,
    emailAccountId,
    userFacingUnsubscribeLink,
    queueArchiveSenders,
    archiveOnUnsubscribe,
  ]);

  return {
    unsubscribeLoading,
    onUnsubscribe,
    // 仅在缺少自动链接时才有意义：调用方会导航到该链接，
    // 而不是就地退订。
    hasAutomaticUnsubscribe: Boolean(
      hasUnsubscribeAccess && automaticUnsubscribeLink,
    ),
    unsubscribeLink:
      hasUnsubscribeAccess && userFacingUnsubscribeLink
        ? userFacingUnsubscribeLink
        : "#",
  };
}

export function useBulkUnsubscribe<T extends Row>({
  hasUnsubscribeAccess,
  mutate,
  posthog,
  refetchPremium,
  emailAccountId,
  onDeselectItem,
  filter,
  onSuccess,
}: {
  hasUnsubscribeAccess: boolean;
  mutate: MutateFn;
  posthog: PostHog;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  emailAccountId: string;
  onDeselectItem?: (id: string) => void;
  filter: NewsletterFilterType;
  onSuccess?: (items: T[]) => void;
}) {
  const analytics = useProductAnalytics("bulk_unsubscribe");
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);
  const [archiveOnUnsubscribe] = useArchiveOnUnsubscribe();

  const onBulkUnsubscribe = useCallback(
    async (items: T[]) => {
      if (!hasUnsubscribeAccess) {
        return {
          stoppedByRateLimit: false,
          total: items.length,
          successCount: 0,
          failureCount: items.length,
        };
      }
      posthog.capture("Clicked Bulk Unsubscribe");
      analytics.captureAction("bulk_unsubscribe_started", {
        item_count: items.length,
        filter,
      });

      const messages = getBulkUnsubscribeMessages(items);

      const result = await executeBulkOperation({
        items,
        mutate,
        filter,
        onDeselectItem,
        newStatus: NewsletterStatus.UNSUBSCRIBED,
        getNewStatus: (item) =>
          getAutomaticUnsubscribeLink(item.unsubscribeLink)
            ? NewsletterStatus.UNSUBSCRIBED
            : NewsletterStatus.AUTO_ARCHIVED,
        ...messages,
        processItem: async (item) => {
          if (!getAutomaticUnsubscribeLink(item.unsubscribeLink)) {
            await blockSender({
              sender: item.name,
              emailAccountId,
              queueArchiveSenders,
            });
            return;
          }

          const unsubscribed = await performAutomaticUnsubscribe({
            emailAccountId,
            senderEmail: item.name,
            unsubscribeLink: item.unsubscribeLink,
          });
          if (!unsubscribed) {
            throw new AutomaticUnsubscribeFailedError();
          }

          await decrementUnsubscribeCreditAction();
          if (archiveOnUnsubscribe) {
            await queueArchiveSenders({ senders: [item.name] });
          }
        },
        onComplete: async () => {
          await mutate();
          await refreshPremium(refetchPremium);
        },
        onCompleteRevalidates: true,
        onSuccess: () => onSuccess?.(items),
      });
      if (result.stoppedByRateLimit) return;

      analytics.captureAction("bulk_unsubscribe_completed", {
        item_count: items.length,
        success_count: result.successCount,
        failure_count: result.failureCount,
        filter,
      });
      return result;
    },
    [
      hasUnsubscribeAccess,
      mutate,
      posthog,
      refetchPremium,
      emailAccountId,
      onDeselectItem,
      filter,
      analytics,
      queueArchiveSenders,
      archiveOnUnsubscribe,
      onSuccess,
    ],
  );

  return { onBulkUnsubscribe };
}

async function autoArchive({
  name,
  labelId,
  labelName,
  mutate,
  refetchPremium,
  emailAccountId,
  queueArchiveSenders,
}: {
  name: string;
  labelId: string | undefined;
  labelName: string | undefined;
  mutate: () => Promise<void>;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  emailAccountId: string;
  queueArchiveSenders: QueueArchiveSendersFn;
}) {
  await blockSender({
    sender: name,
    emailAccountId,
    labelId,
    labelName,
    queueArchiveSenders,
  });
  toastSuccess({ description: "已启用自动归档！" });
  await mutate();
  await refreshPremium(refetchPremium);
}

export function useAutoArchive<T extends Row>({
  item,
  hasUnsubscribeAccess,
  mutate,
  posthog,
  refetchPremium,
  emailAccountId,
}: {
  item: T;
  hasUnsubscribeAccess: boolean;
  mutate: () => Promise<void>;
  posthog: PostHog;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  emailAccountId: string;
}) {
  const [autoArchiveLoading, setAutoArchiveLoading] = useState(false);
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);

  const onAutoArchiveClick = useCallback(async () => {
    if (!hasUnsubscribeAccess) return;

    setAutoArchiveLoading(true);

    try {
      await autoArchive({
        name: item.name,
        labelId: undefined,
        labelName: undefined,
        mutate,
        refetchPremium,
        emailAccountId,
        queueArchiveSenders,
      });

      posthog.capture("Clicked Auto Archive");
    } catch (error) {
      captureException(error);
      toast.error("启用自动归档失败");
    } finally {
      setAutoArchiveLoading(false);
    }
  }, [
    item.name,
    mutate,
    refetchPremium,
    hasUnsubscribeAccess,
    posthog,
    emailAccountId,
    queueArchiveSenders,
  ]);

  const onDisableAutoArchive = useCallback(async () => {
    setAutoArchiveLoading(true);

    try {
      const statusResult = await setSenderStatusAction(emailAccountId, {
        senderEmail: item.name,
        status: null,
      });
      assertActionSucceeded(statusResult);
      toastSuccess({ description: "已停用自动归档！" });
      await mutate();
    } catch (error) {
      captureException(error);
      toast.error("停用自动归档失败");
    } finally {
      setAutoArchiveLoading(false);
    }
  }, [item.name, mutate, emailAccountId]);

  const onAutoArchiveAndLabel = useCallback(
    async (labelId: string, labelName: string) => {
      if (!hasUnsubscribeAccess) return;

      setAutoArchiveLoading(true);

      try {
        await autoArchive({
          name: item.name,
          labelId,
          labelName,
          mutate,
          refetchPremium,
          emailAccountId,
          queueArchiveSenders,
        });
      } catch (error) {
        captureException(error);
        toast.error("启用自动归档失败");
      } finally {
        setAutoArchiveLoading(false);
      }
    },
    [
      item.name,
      mutate,
      refetchPremium,
      hasUnsubscribeAccess,
      emailAccountId,
      queueArchiveSenders,
    ],
  );

  return {
    autoArchiveLoading,
    onAutoArchive: onAutoArchiveClick,
    onDisableAutoArchive,
    onAutoArchiveAndLabel,
  };
}

export function useBulkAutoArchive<T extends Row>({
  hasUnsubscribeAccess,
  mutate,
  refetchPremium,
  emailAccountId,
  onDeselectItem,
  filter,
}: {
  hasUnsubscribeAccess: boolean;
  mutate: MutateFn;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  emailAccountId: string;
  onDeselectItem?: (id: string) => void;
  filter: NewsletterFilterType;
}) {
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);

  const onBulkAutoArchive = useCallback(
    async (items: T[]) => {
      if (!hasUnsubscribeAccess) return;

      await executeBulkOperation({
        items,
        mutate,
        filter,
        onDeselectItem,
        newStatus: NewsletterStatus.AUTO_ARCHIVED,
        loadingMessage: "正在设置自动归档",
        successMessage: "已设为自动归档",
        errorMessage: "设置自动归档失败",
        processItem: async (item) => {
          await blockSender({
            sender: item.name,
            emailAccountId,
            queueArchiveSenders,
          });
        },
        onComplete: refetchPremium,
      });
    },
    [
      hasUnsubscribeAccess,
      mutate,
      refetchPremium,
      emailAccountId,
      onDeselectItem,
      filter,
      queueArchiveSenders,
    ],
  );

  return { onBulkAutoArchive };
}

export function useApproveButton<T extends Row>({
  item,
  mutate,
  posthog,
  emailAccountId,
  filter,
}: {
  item: T;
  mutate: (
    // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
    data?: any,
    opts?: {
      revalidate?: boolean;
      // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
      optimisticData?: any;
      rollbackOnError?: boolean;
    },
  ) => Promise<void>;
  posthog: PostHog;
  emailAccountId: string;
  filter: NewsletterFilterType;
}) {
  const [optimisticStatus, setOptimisticStatus] = useState<
    NewsletterStatus | null | undefined
  >(undefined);

  // 当 item.status 变化时（mutate 之后）重置乐观状态
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset when item.status changes
  useEffect(() => {
    setOptimisticStatus(undefined);
  }, [item.status]);

  const onApprove = async () => {
    const previousStatus = item.status;
    const newStatus =
      item.status === NewsletterStatus.APPROVED
        ? null
        : NewsletterStatus.APPROVED;

    // 乐观地更新 UI
    setOptimisticStatus(newStatus);

    // 乐观地更新状态，并过滤掉不再匹配当前视图的条目
    // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
    const optimisticUpdate = (currentData: any) => {
      if (!currentData?.newsletters) return currentData;
      return {
        ...currentData,
        newsletters: currentData.newsletters
          // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
          .map((n: any) =>
            n.name === item.name ? { ...n, status: newStatus } : n,
          )
          // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
          .filter((n: any) => itemMatchesFilter(n.status, filter)),
      };
    };

    // 乐观地显示 toast
    if (newStatus === NewsletterStatus.APPROVED) {
      toast.success("已保留发件人", {
        description: item.name,
      });
    } else {
      toast.success("已将发件人移至待审核", {
        description: item.name,
      });
    }

    // 立即开始乐观更新（不等待——为 UI 触发后即忘）
    mutate(optimisticUpdate, { revalidate: false });

    posthog.capture("Clicked Approve Sender");

    try {
      // 同时移除该发件人已有的自动归档过滤器
      const result = await setSenderStatusAction(emailAccountId, {
        senderEmail: item.name,
        status: newStatus,
      });
      assertActionSucceeded(result);
      // 不要重新校验——乐观更新是正确的
    } catch (error) {
      // 出错时通过重新校验来回滚
      setOptimisticStatus(previousStatus);
      await mutate();
      captureException(error);
      toast.error("更新发件人状态失败");
    }
  };

  // 若设置了乐观状态则使用它，否则使用实际条目状态
  const displayStatus =
    optimisticStatus !== undefined ? optimisticStatus : item.status;

  return {
    approveLoading: false,
    onApprove,
    isApproved: displayStatus === NewsletterStatus.APPROVED,
  };
}

export function useBulkApprove<T extends Row>({
  mutate,
  posthog,
  emailAccountId,
  onDeselectItem,
  filter,
}: {
  mutate: MutateFn;
  posthog: PostHog;
  emailAccountId: string;
  onDeselectItem?: (id: string) => void;
  filter: NewsletterFilterType;
}) {
  const onBulkApprove = async (items: T[], unapprove?: boolean) => {
    posthog.capture(
      unapprove ? "Clicked Bulk Unapprove" : "Clicked Bulk Approve",
    );

    const newStatus = unapprove ? null : NewsletterStatus.APPROVED;
    const actionPast = unapprove ? "已移至待审核" : "已保留";

    await executeBulkOperation({
      items,
      mutate,
      filter,
      onDeselectItem,
      newStatus,
      loadingMessage: unapprove ? "正在移至待审核" : "正在保留",
      successMessage: actionPast,
      errorMessage: `无法${unapprove ? "移至待审核" : "保留"}`,
      processItem: async (item) => {
        const result = await setSenderStatusAction(emailAccountId, {
          senderEmail: item.name,
          status: newStatus,
        });
        assertActionSucceeded(result);
      },
    });
  };

  return { onBulkApprove };
}

export function useBulkArchive<T extends Row>({
  posthog,
  emailAccountId,
  mutate,
}: {
  posthog: PostHog;
  emailAccountId: string;
  mutate?: MutateFn;
}) {
  const { executeAsync: executeBulkArchive, isExecuting } = useAction(
    bulkArchiveAction.bind(null, emailAccountId),
  );

  const onBulkArchive = (items: T[]) => {
    posthog.capture("Clicked Bulk Archive");
    const promise = executeBulkArchive({
      froms: items.map((item) => item.name),
    }).then(async (result) => {
      if (result?.serverError) {
        throw new Error(result.serverError);
      }

      await mutate?.(undefined, { revalidate: true });
      return result;
    });

    const displayNames = formatSenderNames(items);

    toast.promise(promise, {
      loading: `正在归档来自 ${displayNames} 的邮件…`,
      success: () => `已归档来自 ${displayNames} 的邮件`,
      error: (error: unknown) =>
        getBulkActionErrorMessage(error, "归档邮件时出错"),
    });
  };

  return { onBulkArchive, isBulkArchiving: isExecuting };
}

async function deleteAllFromSender({
  name,
  onFinish,
  emailAccountId,
}: {
  name: string;
  onFinish: () => void;
  emailAccountId: string;
}) {
  const deletion = (async () => {
    const { threads } = await fetchAllSenderThreads({
      sender: name,
      emailAccountId,
    });
    if (threads.length) {
      await enqueueThreadMailMutationBatch({
        emailAccountId,
        payload: { kind: "trash" },
        threads,
      });
    }
    return threads.length;
  })();

  toast.promise(deletion, {
    loading: `正在删除来自 ${name} 的所有邮件`,
    success: (count: number) =>
      count
        ? `已将来自 ${name} 的 ${count} 封邮件加入删除队列`
        : `没有来自 ${name} 的邮件可删除`,
    error: `删除来自 ${name} 的邮件时出错 :(`,
  });

  try {
    return await deletion;
  } finally {
    onFinish();
  }
}

export function useDeleteAllFromSender<T extends Row>({
  item,
  posthog,
  emailAccountId,
}: {
  item: T;
  posthog: PostHog;
  emailAccountId: string;
}) {
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  const onDeleteAll = async () => {
    setDeleteAllLoading(true);

    posthog.capture("Clicked Delete All");

    try {
      await deleteAllFromSender({
        name: item.name,
        onFinish: () => setDeleteAllLoading(false),
        emailAccountId,
      });
    } catch (error) {
      captureException(error);
    }
  };

  return {
    deleteAllLoading,
    onDeleteAll,
  };
}

export function useBulkDelete<T extends Row>({
  mutate,
  posthog,
  emailAccountId,
}: {
  mutate: () => Promise<unknown>;
  posthog: PostHog;
  emailAccountId: string;
}) {
  const { executeAsync: executeBulkTrash, isExecuting } = useAction(
    bulkTrashAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        mutate();
      },
    },
  );

  const onBulkDelete = (items: T[]) => {
    posthog.capture("Clicked Bulk Delete");

    const promise = executeBulkTrash({ froms: items.map((item) => item.name) });

    const displayNames = formatSenderNames(items);

    toast.promise(promise, {
      loading: `正在删除来自 ${displayNames} 的邮件…`,
      success: `已删除来自 ${displayNames} 的邮件`,
      error: (error: unknown) =>
        getBulkActionErrorMessage(error, "删除邮件时出错"),
    });
  };

  return { onBulkDelete, isBulkDeleting: isExecuting };
}

export function useBulkUnsubscribeShortcuts<T extends Row>({
  newsletters,
  selectedRow,
  onOpenNewsletter,
  setSelectedRow,
  refetchPremium,
  hasUnsubscribeAccess,
  mutate,
  emailAccountId,
  // userEmail,
}: {
  newsletters?: T[];
  selectedRow?: T;
  setSelectedRow: (row: T) => void;
  onOpenNewsletter: (row: T) => void;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  hasUnsubscribeAccess: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  mutate: () => Promise<any>;
  emailAccountId: string;
  userEmail: string;
}) {
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);
  const [archiveOnUnsubscribe] = useArchiveOnUnsubscribe();

  // 使用键盘快捷键执行操作
  // TODO 也让它可用于 command-K 对话框
  useEffect(() => {
    const down = async (e: KeyboardEvent) => {
      try {
        const item = selectedRow;
        if (!item) return;

        // 防止在输入框中输入时触发（例如 Crisp 客服）
        if (document?.activeElement?.tagName !== "BODY") return;

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const index = newsletters?.findIndex((n) => n.name === item.name);
          if (index === undefined) return;
          const nextItem =
            newsletters?.[index + (e.key === "ArrowDown" ? 1 : -1)];
          if (!nextItem) return;
          setSelectedRow(nextItem);
          return;
        }
        if (e.key === "Enter") {
          // 打开弹窗
          e.preventDefault();
          onOpenNewsletter(item);
          return;
        }

        if (!hasUnsubscribeAccess) return;

        if (e.key === "e") {
          // 自动归档
          e.preventDefault();
          const statusResult = await setSenderStatusAction(emailAccountId, {
            senderEmail: item.name,
            status: NewsletterStatus.AUTO_ARCHIVED,
          });
          assertActionSucceeded(statusResult);
          toastSuccess({ description: "已启用自动归档！" });
          await mutate();
          await decrementUnsubscribeCreditAction();
          await refreshPremium(refetchPremium);
          return;
        }
        if (e.key === "u") {
          // 退订
          e.preventDefault();
          const automaticUnsubscribeLink = getAutomaticUnsubscribeLink(
            item.unsubscribeLink,
          );
          const userFacingUnsubscribeLink = getManualUnsubscribeLink(
            item.unsubscribeLink,
          );

          if (!userFacingUnsubscribeLink) {
            await blockSender({
              sender: item.name,
              emailAccountId,
              queueArchiveSenders,
            });
            toastSuccess({
              description: "发件人已屏蔽。以后的邮件将被自动归档。",
            });
            await mutate();
            await refreshPremium(refetchPremium);
            return;
          }

          if (!automaticUnsubscribeLink) {
            window.open(
              userFacingUnsubscribeLink,
              "_blank",
              "noopener,noreferrer",
            );
            return;
          }

          const unsubscribed = await unsubscribeAndArchive({
            senderEmail: item.name,
            unsubscribeLink: item.unsubscribeLink,
            mutate,
            refetchPremium,
            emailAccountId,
            queueArchiveSenders,
            archiveExisting: archiveOnUnsubscribe,
          });
          if (!unsubscribed) return;
          return;
        }
        if (e.key === "a") {
          // 批准
          e.preventDefault();
          const statusResult = await setSenderStatusAction(emailAccountId, {
            senderEmail: item.name,
            status: NewsletterStatus.APPROVED,
          });
          assertActionSucceeded(statusResult);
          await mutate();
          return;
        }
      } catch (error) {
        captureException(error);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [
    mutate,
    newsletters,
    selectedRow,
    hasUnsubscribeAccess,
    refetchPremium,
    setSelectedRow,
    onOpenNewsletter,
    emailAccountId,
    queueArchiveSenders,
    archiveOnUnsubscribe,
  ]);
}

export function useArchiveOnUnsubscribe() {
  // 在挂载后读取，避免已保存的 `false` 与服务端渲染不一致。
  return useLocalStorage("bulk-unsubscribe-archive-on-unsubscribe", true, {
    initializeWithValue: false,
  });
}

export function useNewsletterFilter() {
  const [filter, setFilter] = useState<NewsletterFilterType>("unhandled");

  // 将单个过滤器转换为数组格式，以兼容 API
  const filtersArray: (
    | "unhandled"
    | "unsubscribed"
    | "autoArchived"
    | "approved"
  )[] =
    filter === "all"
      ? ["unhandled", "unsubscribed", "autoArchived", "approved"]
      : [filter];

  return {
    filter,
    filtersArray,
    setFilter,
  };
}

function didAutomaticUnsubscribeSucceed(
  result: Awaited<ReturnType<typeof unsubscribeSenderAction>>,
) {
  if (result?.serverError) {
    assertActionSucceeded({ serverError: result.serverError });
  }

  return result?.data?.unsubscribe.success === true;
}

async function performAutomaticUnsubscribe({
  emailAccountId,
  senderEmail,
  unsubscribeLink,
}: {
  emailAccountId: string;
  senderEmail: string;
  unsubscribeLink?: string | null;
}) {
  const unsubscribeResult = await unsubscribeSenderAction(emailAccountId, {
    senderEmail,
    unsubscribeLink,
  });

  return didAutomaticUnsubscribeSucceed(unsubscribeResult);
}

function getAutomaticUnsubscribeLink(unsubscribeLink?: string | null) {
  return getHttpUnsubscribeLink({
    unsubscribeLink,
  });
}

function getManualUnsubscribeLink(unsubscribeLink?: string | null) {
  return getUserFacingUnsubscribeLink({
    unsubscribeLink,
  });
}

function getBulkUnsubscribeMessages<T extends Row>(items: T[]) {
  const hasAutomatic = items.some((item) =>
    getAutomaticUnsubscribeLink(item.unsubscribeLink),
  );
  const hasBlock = items.some(
    (item) => !getAutomaticUnsubscribeLink(item.unsubscribeLink),
  );

  if (hasAutomatic && hasBlock) {
    return {
      loadingMessage: "正在处理",
      successMessage: "已处理",
      errorMessage: "处理失败",
    };
  }
  if (hasBlock) {
    return {
      loadingMessage: "正在屏蔽",
      successMessage: "已屏蔽",
      errorMessage: "屏蔽失败",
    };
  }
  return {
    loadingMessage: "正在退订",
    successMessage: "已退订",
    errorMessage: "退订失败",
  };
}

/**
 * 过期的额度计数只影响显示，因此刷新它绝不能把已经成功的操作变成失败提示。
 */
async function refreshPremium(
  refetchPremium: () => Promise<UserResponse | null | undefined>,
) {
  try {
    await refetchPremium();
  } catch (error) {
    captureException(error);
  }
}

function getBulkActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;

  if (
    error &&
    typeof error === "object" &&
    "error" in error &&
    error.error &&
    typeof error.error === "object" &&
    "serverError" in error.error &&
    typeof error.error.serverError === "string"
  ) {
    return error.error.serverError;
  }

  return fallback;
}

// 这是预期内的结果（发件人的退订端点拒绝或需要人工处理），而非 bug：
// 服务端会记录原因，toast 则报告失败数量。
class AutomaticUnsubscribeFailedError extends Error {
  constructor() {
    super("自动退订未成功");
    this.name = "AutomaticUnsubscribeFailedError";
  }
}
