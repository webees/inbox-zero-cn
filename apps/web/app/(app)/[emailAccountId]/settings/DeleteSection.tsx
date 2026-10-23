"use client";

import { useState } from "react";
import Link from "next/link";
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
  const { onCancelLoadBatch } = useStatLoader();
  const { premium } = usePremium();
  const {
    data: accountsData,
    isLoading: isLoadingAccounts,
    error: accountsError,
  } = useAccounts();
  const connectedEmails =
    accountsData?.emailAccounts.map((account) => account.email) ?? [];
  const connectedEmailParts = new Intl.ListFormat("en", {
    type: "conjunction",
  }).formatToParts(connectedEmails);
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
        loading: "正在删除账号…",
        success: "账号已删除！",
        error: (err: unknown) =>
          `删除账号时出错：${err instanceof Error ? err.message : "未知错误"}`,
      },
    );
  };

  const shouldBlockDeletion = hasSubscription && !hasConfirmedCancellation;

  return (
    <Item size="sm">
      <ItemContent>
        <ItemTitle>删除账号</ItemTitle>
        <ItemDescription>
          删除你的 Inbox Zero 数据，不会影响你的邮件。
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructiveSoft" size="sm">
              删除
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {shouldBlockDeletion
                  ? "请先取消订阅"
                  : "要删除你的 Inbox Zero 账号吗？"}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>
                  {shouldBlockDeletion ? (
                    <>
                      <p className="mb-3">请在删除账号前取消你的订阅。</p>
                      <p className="mb-3">
                        {hasAppleSubscription ? (
                          <>
                            你可以在你的 iPhone 或 iPad 订阅设置中管理你的订阅。
                          </>
                        ) : (
                          <>
                            你可以点击上方的“管理订阅”，或前往{" "}
                            <Link
                              href="/premium"
                              className="text-blue-600 underline hover:text-blue-800"
                              onClick={() => setIsDialogOpen(false)}
                            >
                              高级版页面
                            </Link>{" "}
                            并点击“管理订阅”来管理你的订阅。
                          </>
                        )}
                      </p>
                      <p className="text-sm text-gray-600">
                        已经取消了订阅？点击下方按钮继续。
                      </p>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <LoadingContent
                        loading={isLoadingAccounts}
                        error={accountsError}
                      >
                        <p>
                          这将永久删除你的 Inbox Zero 数据，并断开{" "}
                          {connectedEmailParts.map((part, index) =>
                            part.type === "element" ? (
                              <span
                                key={index}
                                className="font-medium text-foreground"
                              >
                                {part.value}
                              </span>
                            ) : (
                              part.value
                            ),
                          )}
                          。不会影响你的邮件。
                        </p>
                      </LoadingContent>
                      {connectedEmails.length > 1 && (
                        <Link
                          href="/accounts"
                          className="text-foreground underline"
                          onClick={() => setIsDialogOpen(false)}
                        >
                          改为仅移除一个账号
                        </Link>
                      )}
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              {shouldBlockDeletion ? (
                <AlertDialogAction
                  onClick={(event) => {
                    // 保持对话框打开，以便继续进入删除确认
                    event.preventDefault();
                    setHasConfirmedCancellation(true);
                  }}
                >
                  我已取消订阅
                </AlertDialogAction>
              ) : (
                <AlertDialogAction
                  className={buttonVariants({ variant: "destructive" })}
                  disabled={!accountsData || Boolean(accountsError)}
                  onClick={handleDeleteAccount}
                >
                  删除账号
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ItemActions>
    </Item>
  );
}
