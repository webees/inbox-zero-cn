"use client";

import { useState } from "react";
import Link from "next/link";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemActions,
} from "@/components/ui/item";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { deleteAccountAction } from "@/utils/actions/user";
import { logOut } from "@/utils/user";
import { useStatLoader } from "@/providers/StatLoaderProvider";
import { usePremium } from "@/hooks/usePremium";
import { hasActiveAppleSubscription } from "@/utils/premium";
import { useAccounts } from "@/hooks/useAccounts";
import { LoadingContent } from "@/components/LoadingContent";

export function DeleteSection() {
  const { i18n, t } = useLingui();
  const { onCancelLoadBatch } = useStatLoader();
  const { premium } = usePremium();
  const {
    data: accountsData,
    isLoading: isLoadingAccounts,
    error: accountsError,
  } = useAccounts();
  const connectedEmails =
    accountsData?.emailAccounts.map((account) => account.email) ?? [];
  const connectedEmailParts = new Intl.ListFormat(i18n.locale, {
    type: "conjunction",
  }).formatToParts(connectedEmails);
  const connectedEmailList = connectedEmailParts.map((part, index) =>
    part.type === "element" ? (
      <span key={index} className="font-medium text-foreground">
        {part.value}
      </span>
    ) : (
      part.value
    ),
  );
  const hasAppleSubscription = hasActiveAppleSubscription(
    premium?.appleExpiresAt || null,
    premium?.appleRevokedAt || null,
    premium?.appleSubscriptionStatus || null,
  );

  const hasSubscription =
    premium?.stripeSubscriptionId ||
    premium?.lemonSqueezySubscriptionId ||
    hasAppleSubscription;

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [hasConfirmedCancellation, setHasConfirmedCancellation] =
    useState(false);

  const { executeAsync: executeDeleteAccount } = useAction(
    deleteAccountAction.bind(null),
  );

  const handleDeleteAccount = async () => {
    onCancelLoadBatch();
    setIsDialogOpen(false);

    toast.promise(
      async () => {
        const result = await executeDeleteAccount();
        await logOut("/");
        if (result?.serverError) throw new Error(result.serverError);
      },
      {
        loading: t`正在删除账号…`,
        success: t`账号已删除！`,
        error: (err: unknown) => {
          const message = err instanceof Error ? err.message : t`未知错误`;
          return t`删除账号时出错：${message}`;
        },
      },
    );
  };

  const shouldBlockDeletion = hasSubscription && !hasConfirmedCancellation;

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>
          <Trans>删除账号</Trans>
        </ItemTitle>
        <ItemDescription>
          <Trans>删除你的 Inbox Zero 数据。不会影响你的邮件。</Trans>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructiveSoft" size="sm">
              <Trans>删除</Trans>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {shouldBlockDeletion
                  ? t`请先取消订阅`
                  : t`删除你的 Inbox Zero 账号？`}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  {shouldBlockDeletion ? (
                    <>
                      <p className="mb-3">
                        <Trans>请在删除账号前取消订阅。</Trans>
                      </p>
                      <p className="mb-3">
                        {hasAppleSubscription ? (
                          <Trans>
                            你可以在 iPhone 或 iPad 的订阅设置中管理订阅。
                          </Trans>
                        ) : (
                          <Trans>
                            你可以点击上方的“管理订阅”，或前往{" "}
                            <Link
                              href="/premium"
                              className="text-blue-600 underline hover:text-blue-800"
                              onClick={() => setIsDialogOpen(false)}
                            >
                              高级版页面
                            </Link>{" "}
                            并点击“管理订阅”。
                          </Trans>
                        )}
                      </p>
                      <p className="text-sm text-gray-600">
                        <Trans>已经取消订阅？点击下方按钮继续。</Trans>
                      </p>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <LoadingContent
                        loading={isLoadingAccounts}
                        error={accountsError}
                      >
                        <p>
                          <Trans>
                            这将永久删除你的 Inbox Zero 数据，并断开连接
                            {connectedEmailList}。不会影响你的邮件。
                          </Trans>
                        </p>
                      </LoadingContent>
                      {connectedEmails.length > 1 && (
                        <Link
                          href="/accounts"
                          className="text-foreground underline"
                          onClick={() => setIsDialogOpen(false)}
                        >
                          <Trans>改为仅移除一个账号</Trans>
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                <Trans>取消</Trans>
              </AlertDialogCancel>
              {shouldBlockDeletion ? (
                <AlertDialogAction
                  onClick={(event) => {
                    // Keep the dialog open so it advances to the delete confirmation
                    event.preventDefault();
                    setHasConfirmedCancellation(true);
                  }}
                >
                  <Trans>我已取消订阅</Trans>
                </AlertDialogAction>
              ) : (
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  disabled={!accountsData || Boolean(accountsError)}
                  onClick={handleDeleteAccount}
                >
                  <Trans>删除账号</Trans>
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
    </Item>
  );
}
