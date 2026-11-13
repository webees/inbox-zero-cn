"use client";

import {
  useCallback,
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type { I18n } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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

// Shared type for SWR mutate function
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

type BulkOperationMessages = {
  loadingMessage: (count: number) => string;
  successMessage: (count: number) => string;
  errorMessage: (count: number) => string;
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
      return !status; // null/undefined status means unhandled
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

// 通用的批量操作处理程序，用于减少重复代码
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
  i18n,
}: {
  items: T[];
  mutate: MutateFn;
  filter: NewsletterFilterType;
  onDeselectItem?: (id: string) => void;
  processItem: (item: T) => Promise<void>;
  newStatus: NewsletterStatus | null;
  getNewStatus?: (item: T) => NewsletterStatus | null;
  onComplete?: () => Promise<unknown>;
  onCompleteRevalidates?: boolean;
  onSuccess?: () => void;
  i18n: I18n;
} & BulkOperationMessages): Promise<BulkOperationResult> {
  const total = items.length;
  let completed = 0;
  const toastId = toast.loading(loadingMessage(total), {
    description: i18n._(msg`已完成 ${completed}/${total}`),
  });

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
      toast.loading(loadingMessage(total), {
        id: toastId,
        description: i18n._(msg`已完成 ${completed}/${total}`),
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
      description: i18n._(
        msg`已完成 ${successful}/${total}；为避免发出更多请求已停止`,
      ),
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
    const succeeded = total - failureCount;
    toast.error(errorMessage(failureCount), {
      id: toastId,
      description: i18n._(msg`成功 ${succeeded}/${total}`),
    });
  } else {
    toast.success(successMessage(total), {
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
  const { t } = useLingui();
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

    // 无论尝试如何失败，发件人自己的页面始终可用，读者总有一种方式完成操作。
    const openPageAction = userFacingUnsubscribeLink
      ? {
          label: t`打开页面`,
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
            description: t`发件人已屏蔽。将来的邮件会被归档。`,
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
          toast.error(t`无法退订 ${item.name}`, {
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
        toast.error(t`无法退订 ${item.name}`, {
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
    t,
  ]);

  return {
    unsubscribeLoading,
    onUnsubscribe,
    // Only meaningful without an automatic link: the caller navigates to it
    // instead of unsubscribing in place.
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
  mutate: swrMutate,
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
  const { i18n } = useLingui();
  const mutate = useMountedMutate(swrMutate);
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

      const messages = getBulkUnsubscribeMessages(items, i18n);

      const result = await executeBulkOperation({
        i18n,
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
      i18n,
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
  i18n,
}: {
  name: string;
  labelId: string | undefined;
  labelName: string | undefined;
  mutate: () => Promise<void>;
  refetchPremium: () => Promise<UserResponse | null | undefined>;
  emailAccountId: string;
  queueArchiveSenders: QueueArchiveSendersFn;
  i18n: I18n;
}) {
  await blockSender({
    sender: name,
    emailAccountId,
    labelId,
    labelName,
    queueArchiveSenders,
  });
  toastSuccess({ description: i18n._(msg`已启用自动归档！`) });
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
  const { i18n, t } = useLingui();
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
        i18n,
      });

      posthog.capture("Clicked Auto Archive");
    } catch (error) {
      captureException(error);
      toast.error(t`启用自动归档失败`);
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
    i18n,
    t,
  ]);

  const onDisableAutoArchive = useCallback(async () => {
    setAutoArchiveLoading(true);

    try {
      const statusResult = await setSenderStatusAction(emailAccountId, {
        senderEmail: item.name,
        status: null,
      });
      assertActionSucceeded(statusResult);
      toastSuccess({ description: t`已禁用自动归档！` });
      await mutate();
    } catch (error) {
      captureException(error);
      toast.error(t`禁用自动归档失败`);
    } finally {
      setAutoArchiveLoading(false);
    }
  }, [item.name, mutate, emailAccountId, t]);

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
          i18n,
        });
      } catch (error) {
        captureException(error);
        toast.error(t`启用自动归档失败`);
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
      i18n,
      t,
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
  mutate: swrMutate,
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
  const { i18n, t } = useLingui();
  const mutate = useMountedMutate(swrMutate);
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);

  const onBulkAutoArchive = useCallback(
    async (items: T[]) => {
      if (!hasUnsubscribeAccess) return;

      await executeBulkOperation({
        i18n,
        items,
        mutate,
        filter,
        onDeselectItem,
        newStatus: NewsletterStatus.AUTO_ARCHIVED,
        loadingMessage: (count) =>
          t`正在为 ${plural(count, {
            one: "# 个发件人",
            other: "# 个发件人",
          })}...`,
        successMessage: (count) =>
          t`${plural(count, {
            one: "# 个发件人已设为自动归档",
            other: "# 个发件人已设为自动归档",
          })}`,
        errorMessage: (count) =>
          t`为 ${plural(count, {
            one: "# 个发件人",
            other: "# 个发件人",
          })}`,
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
      i18n,
      t,
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
  const { t } = useLingui();
  const [optimisticStatus, setOptimisticStatus] = useState<
    NewsletterStatus | null | undefined
  >(undefined);

  // Reset optimistic state when item.status changes (after mutate)
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

    // Optimistically update the UI
    setOptimisticStatus(newStatus);

    // Optimistically update status and filter out items that no longer match the current view
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

    // 乐观地显示提示
    if (newStatus === NewsletterStatus.APPROVED) {
      toast.success(t`发件人已保留`, {
        description: item.name,
      });
    } else {
      toast.success(t`发件人已移至审核`, {
        description: item.name,
      });
    }

    // 立即开始乐观更新（不要 await：对 UI 而言发出即可）
    mutate(optimisticUpdate, { revalidate: false });

    posthog.capture("Clicked Approve Sender");

    try {
      // 同时移除该发件人已有的自动归档过滤器
      const result = await setSenderStatusAction(emailAccountId, {
        senderEmail: item.name,
        status: newStatus,
      });
      assertActionSucceeded(result);
      // 不要重新验证：乐观更新是正确的
    } catch (error) {
      // 出错时通过重新验证回滚
      setOptimisticStatus(previousStatus);
      await mutate();
      captureException(error);
      toast.error(t`更新发件人状态失败`);
    }
  };

  // Use optimistic status if set, otherwise use the actual item status
  const displayStatus =
    optimisticStatus !== undefined ? optimisticStatus : item.status;

  return {
    approveLoading: false,
    onApprove,
    isApproved: displayStatus === NewsletterStatus.APPROVED,
  };
}

export function useBulkApprove<T extends Row>({
  mutate: swrMutate,
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
  const { i18n, t } = useLingui();
  const mutate = useMountedMutate(swrMutate);
  const onBulkApprove = async (items: T[], unapprove?: boolean) => {
    posthog.capture(
      unapprove ? "Clicked Bulk Unapprove" : "Clicked Bulk Approve",
    );

    const newStatus = unapprove ? null : NewsletterStatus.APPROVED;
    const messages: BulkOperationMessages = unapprove
      ? {
          loadingMessage: (count) =>
            t`正在移至审核 ${plural(count, {
              one: "# 个发件人",
              other: "# 个发件人",
            })}...`,
          successMessage: (count) =>
            t`${plural(count, {
              one: "# 个发件人已移至审核",
              other: "# 个发件人已移至审核",
            })}`,
          errorMessage: (count) =>
            t`移至审核 ${plural(count, {
              one: "# 个发件人",
              other: "# 个发件人",
            })}`,
        }
      : {
          loadingMessage: (count) =>
            t`正在保留 ${plural(count, {
              one: "# 个发件人",
              other: "# 个发件人",
            })}...`,
          successMessage: (count) =>
            t`${plural(count, {
              one: "# 个发件人已保留",
              other: "# 个发件人已保留",
            })}`,
          errorMessage: (count) =>
            t`保留 ${plural(count, {
              one: "# 个发件人",
              other: "# 个发件人",
            })}`,
        };

    await executeBulkOperation({
      i18n,
      items,
      mutate,
      filter,
      onDeselectItem,
      newStatus,
      ...messages,
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
  const { t } = useLingui();
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
      loading: t`正在归档来自 ${displayNames} 的邮件...`,
      success: () => t`已归档来自 ${displayNames} 的邮件`,
      error: (error: unknown) =>
        getBulkActionErrorMessage(error, t`归档邮件时出错`),
    });
  };

  return { onBulkArchive, isBulkArchiving: isExecuting };
}

async function deleteAllFromSender({
  name,
  onFinish,
  emailAccountId,
  i18n,
}: {
  name: string;
  onFinish: () => void;
  emailAccountId: string;
  i18n: I18n;
}) {
  const deletion = (async () => {
    const { threads } = await fetchAllSenderThreads({
      sender: name,
      scope: "all",
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
    loading: i18n._(msg`正在删除来自 ${name} 的所有邮件`),
    success: (count: number) =>
      count
        ? i18n._(
            msg`Queued ${plural(count, {
              one: "# 封邮件",
              other: "# 封邮件",
            })} 来自 ${name}，已加入删除队列`,
          )
        : i18n._(msg`没有需要删除的来自 ${name} 的邮件`),
    error: i18n._(msg`删除来自 ${name} 的邮件时出错 :(`),
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
  const { i18n } = useLingui();
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);

  const onDeleteAll = async () => {
    setDeleteAllLoading(true);

    posthog.capture("Clicked Delete All");

    try {
      await deleteAllFromSender({
        name: item.name,
        onFinish: () => setDeleteAllLoading(false),
        emailAccountId,
        i18n,
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
  const { t } = useLingui();
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
      loading: t`正在删除来自 ${displayNames} 的邮件...`,
      success: t`已删除来自 ${displayNames} 的邮件`,
      error: (error: unknown) =>
        getBulkActionErrorMessage(error, t`将邮件移入垃圾箱时出错`),
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
  const { t } = useLingui();
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);
  const [archiveOnUnsubscribe] = useArchiveOnUnsubscribe();

  // 使用键盘快捷键执行操作
  // TODO 让命令-K 对话框也能使用这些操作
  useEffect(() => {
    const down = async (e: KeyboardEvent) => {
      try {
        const item = selectedRow;
        if (!item) return;

        // 防止在 Crisp 客服等输入框中输入时触发
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
          toastSuccess({ description: t`已启用自动归档！` });
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
              description: t`发件人已屏蔽。将来的邮件会被归档。`,
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
          // approve
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
    t,
  ]);
}

export function useArchiveOnUnsubscribe() {
  // Read after mount so a saved `false` doesn't mismatch the server render.
  return useLocalStorage("bulk-unsubscribe-archive-on-unsubscribe", true, {
    initializeWithValue: false,
  });
}

export function useNewsletterFilter() {
  const [filter, setFilter] = useState<NewsletterFilterType>("unhandled");

  // Convert single filter to array format for API compatibility
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

function getBulkUnsubscribeMessages<T extends Row>(
  items: T[],
  i18n: I18n,
): BulkOperationMessages {
  const hasAutomatic = items.some((item) =>
    getAutomaticUnsubscribeLink(item.unsubscribeLink),
  );
  const hasBlock = items.some(
    (item) => !getAutomaticUnsubscribeLink(item.unsubscribeLink),
  );

  if (hasAutomatic && hasBlock) {
    return {
      loadingMessage: (count) =>
        i18n._(
          msg`正在处理 ${plural(count, { one: "# 个发件人", other: "# 个发件人" })}...`,
        ),
      successMessage: (count) =>
        i18n._(
          msg`${plural(count, { one: "# 个发件人已处理", other: "# 个发件人已处理" })}`,
        ),
      errorMessage: (count) =>
        i18n._(
          msg`处理 ${plural(count, { one: "# 个发件人", other: "# 个发件人" })}失败`,
        ),
    };
  }
  if (hasBlock) {
    return {
      loadingMessage: (count) =>
        i18n._(
          msg`正在屏蔽 ${plural(count, { one: "# 个发件人", other: "# 个发件人" })}...`,
        ),
      successMessage: (count) =>
        i18n._(
          msg`${plural(count, { one: "# 个发件人已屏蔽", other: "# 个发件人已屏蔽" })}`,
        ),
      errorMessage: (count) =>
        i18n._(
          msg`屏蔽 ${plural(count, { one: "# 个发件人", other: "# 个发件人" })}失败`,
        ),
    };
  }
  return {
    loadingMessage: (count) =>
      i18n._(
        msg`正在退订 ${plural(count, { one: "# 个发件人", other: "# 个发件人" })}...`,
      ),
    successMessage: (count) =>
      i18n._(
        msg`${plural(count, { one: "# 个发件人已退订", other: "# 个发件人已退订" })}`,
      ),
    errorMessage: (count) =>
      i18n._(
        msg`退订 ${plural(count, { one: "# 个发件人", other: "# 个发件人" })}失败`,
      ),
  };
}

/**
 * 过期的 premium 计数只影响显示，因此刷新它绝不能把已经成功的操作变成失败提示。
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

// An expected outcome (the sender's endpoint rejected or needs a person), not
// a bug: the server logs the reason and the toast reports the failure count.
class AutomaticUnsubscribeFailedError extends Error {
  constructor() {
    super("自动退订未成功");
    this.name = "AutomaticUnsubscribeFailedError";
  }
}

// 批量操作会比页面导航存活更久，而 SWR 绑定的 mutate 在 SWRConfig 缓存
// provider 卸载后会抛错。缓存会在下次挂载时重新获取。
function useMountedMutate(mutate: MutateFn): MutateFn {
  const isMountedRef = useRef(true);

  // Layout effect：SWRConfig 在 layout effect 清理时才丢弃 provider，而被动的
  // 清理可能在待处理的 await 已经恢复之后才运行。
  useLayoutEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 原样转发参数：SWR 对 `mutate()` 和 `mutate(undefined)` 的处理不同。
  return useCallback(
    async (...args: Parameters<MutateFn>) => {
      if (isMountedRef.current) return mutate(...args);
    },
    [mutate],
  );
}
