import prisma from "@/utils/prisma";
import {
  captureException,
  isKnownOutlookError,
  isOutlookMailboxFullError,
} from "@/utils/error";
import {
  addUserErrorMessage,
  mailboxFullErrorKey,
} from "@/utils/error-messages";
import type { EmailProvider } from "@/utils/email/types";
import { createEmailProvider } from "@/utils/email/provider";
import type { Logger } from "@/utils/logger";
import {
  parseSubscriptionHistory,
  cleanupOldHistoryEntries,
  addCurrentSubscriptionToHistory,
} from "@/utils/outlook/subscription-history";

const OUTLOOK_SUBSCRIPTION_RENEWAL_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const OUTLOOK_MAX_REUSE_AGE_MS = 24 * 60 * 60 * 1000;
const OUTLOOK_SUBSCRIPTION_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Manages Outlook subscriptions, ensuring only one active subscription per email account
 * by canceling old subscriptions before creating new ones.
 */
export class OutlookSubscriptionManager {
  private readonly client: EmailProvider;
  private readonly emailAccountId: string;
  private readonly logger: Logger;

  constructor(client: EmailProvider, emailAccountId: string, logger: Logger) {
    this.client = client;
    this.emailAccountId = emailAccountId;
    this.logger = logger.with({ emailAccountId });
  }

  async createSubscription(options?: { forceRefresh?: boolean }): Promise<{
    expirationDate: Date;
    subscriptionId?: string;
    changed: boolean;
    cancelledSubscriptionId?: string;
  } | null> {
    const forceRefresh = options?.forceRefresh === true;
    let cancelledSubscriptionId: string | undefined;
    try {
      const existing = await this.getExistingSubscription();

      if (existing?.subscriptionId && existing.expirationDate) {
        const now = new Date();
        const timeUntilExpiry =
          new Date(existing.expirationDate).getTime() - now.getTime();

        if (
          !forceRefresh &&
          timeUntilExpiry > OUTLOOK_SUBSCRIPTION_RENEWAL_THRESHOLD_MS &&
          !shouldRenewAgedSubscription(existing.expirationDate, now)
        ) {
          this.logger.info("Existing subscription is valid; reuse", {
            subscriptionId: existing.subscriptionId,
            expirationDate: existing.expirationDate,
          });
          return {
            expirationDate: new Date(existing.expirationDate),
            subscriptionId: existing.subscriptionId,
            changed: false,
          };
        }

        if (forceRefresh) {
          this.logger.info("Existing subscription explicitly refreshing", {
            subscriptionId: existing.subscriptionId,
            expirationDate: existing.expirationDate,
          });
        } else if (
          timeUntilExpiry <= OUTLOOK_SUBSCRIPTION_RENEWAL_THRESHOLD_MS
        ) {
          this.logger.info("Existing subscription near expiry; renewing", {
            subscriptionId: existing.subscriptionId,
            expirationDate: existing.expirationDate,
          });
        } else {
          this.logger.info("Existing subscription reached max age; renewing", {
            subscriptionId: existing.subscriptionId,
            expirationDate: existing.expirationDate,
          });
        }
      } else {
        this.logger.info("No existing subscription found; creating new");
      }

      // Graph rejects a second subscription for the same resource and change
      // types (409), so the old one has to go before the new one is created.
      if (await this.cancelSubscription(existing?.subscriptionId)) {
        cancelledSubscriptionId = existing?.subscriptionId ?? undefined;
      }

      const subscription = await this.client.watchEmails();

      if (!subscription?.subscriptionId) {
        this.logger.warn("Subscription creation returned no subscription");
        await this.markSubscriptionLapsed(cancelledSubscriptionId);
        return null;
      }

      this.logger.info("Successfully created new subscription", {
        subscriptionId: subscription.subscriptionId,
      });

      return {
        expirationDate: subscription.expirationDate,
        subscriptionId: subscription.subscriptionId,
        changed: true,
        cancelledSubscriptionId,
      };
    } catch (error) {
      if (isKnownOutlookError(error)) {
        this.logger.warn("Failed to create subscription", { error });
      } else {
        this.logger.error("Failed to create subscription", { error });
      }
      captureException(error, { emailAccountId: this.emailAccountId });
      await this.markSubscriptionLapsed(cancelledSubscriptionId);
      if (isOutlookMailboxFullError(error)) await this.showMailboxFullError();
      return null;
    }
  }

  /**
   * Creates (or reuses) a subscription, persists it to the DB when changed,
   * and cleans up orphaned subscriptions on DB failure.
   */
  async createAndPersistSubscription(options?: {
    forceRefresh?: boolean;
  }): Promise<{ expirationDate: Date; subscriptionId: string } | null> {
    const result = await this.createSubscription(options);
    if (!result?.subscriptionId) return null;

    if (result.changed) {
      try {
        await this.updateSubscriptionInDatabase({
          expirationDate: result.expirationDate,
          subscriptionId: result.subscriptionId,
        });
      } catch (error) {
        this.logger.error("Failed to save subscription to database", {
          subscriptionId: result.subscriptionId,
          error,
        });

        let cancelledReplacement = false;
        try {
          await this.client.unwatchEmails(result.subscriptionId);
          cancelledReplacement = true;
          this.logger.info("Canceled orphaned subscription after DB failure", {
            subscriptionId: result.subscriptionId,
          });
        } catch (cancelError) {
          this.logger.error("Failed to cancel orphaned subscription", {
            subscriptionId: result.subscriptionId,
            error: cancelError,
          });
        }

        captureException(error, { emailAccountId: this.emailAccountId });
        await this.markSubscriptionLapsed(result.cancelledSubscriptionId);
        // The save can fail after writing the replacement (the concurrency
        // check reads again); if so and we cancelled it, it is dead too.
        if (cancelledReplacement) {
          await this.markSubscriptionLapsed(result.subscriptionId);
        }
        return null;
      }
    }

    return {
      expirationDate: result.expirationDate,
      subscriptionId: result.subscriptionId,
    };
  }

  /**
   * After the old subscription is cancelled but no replacement was saved, the
   * stored expiry still looks days away while nothing is delivering. Marking it
   * expired lets the renewal cron retry this account first and the lapse
   * notifier warn the user if it stays down.
   */
  private async markSubscriptionLapsed(cancelledSubscriptionId?: string) {
    if (!cancelledSubscriptionId) return;
    try {
      // 仅当该记录仍指向我们已取消的订阅时才标记，以免并发
      // 续订保存了替代订阅后，被误标为已失效。
      await prisma.emailAccount.updateMany({
        where: {
          id: this.emailAccountId,
          watchEmailsSubscriptionId: cancelledSubscriptionId,
        },
        data: { watchEmailsExpirationDate: new Date() },
      });
    } catch (error) {
      this.logger.error("无法将订阅标记为已失效", { error });
    }
  }

  // 用户释放空间后账号仍可正常使用，因此我们显示
  // 横幅而不是断开连接。监控定时任务会在恢复后清除它。
  private async showMailboxFullError() {
    try {
      const emailAccount = await prisma.emailAccount.findUnique({
        where: { id: this.emailAccountId },
        select: { email: true, userId: true },
      });
      if (!emailAccount) return;

      await addUserErrorMessage(
        emailAccount.userId,
        mailboxFullErrorKey(this.emailAccountId),
        `${emailAccount.email} 的邮箱已满或无法接受更改，因此 Inbox Zero 无法处理新邮件。请释放空间或在 Microsoft 365 中修复该邮箱。此消息会在邮箱恢复正常后自动清除。`,
        this.logger,
      );
    } catch (error) {
      this.logger.warn("无法保存邮箱已满错误", { error });
    }
  }

  private async cancelSubscription(
    subscriptionId: string | null | undefined,
  ): Promise<boolean> {
    if (!subscriptionId) return false;

    try {
      await this.client.unwatchEmails(subscriptionId);
      this.logger.info("已取消现有订阅", { subscriptionId });
      return true;
    } catch (error) {
      // The subscription might already be expired/invalid
      this.logger.warn("无法取消现有订阅（可能已过期）", {
        subscriptionId,
        error,
      });
      return false;
    }
  }

  private async getExistingSubscription() {
    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: this.emailAccountId },
      select: {
        watchEmailsSubscriptionId: true,
        watchEmailsExpirationDate: true,
        watchEmailsSubscriptionHistory: true,
        createdAt: true,
      },
    });

    if (!emailAccount) return null;

    return {
      subscriptionId: emailAccount.watchEmailsSubscriptionId || null,
      expirationDate: emailAccount.watchEmailsExpirationDate || null,
      subscriptionHistory: emailAccount.watchEmailsSubscriptionHistory,
      accountCreatedAt: emailAccount.createdAt,
    };
  }

  async updateSubscriptionInDatabase(subscription: {
    expirationDate: Date;
    subscriptionId: string;
  }): Promise<void> {
    const expirationDate = subscription.expirationDate;
    const now = new Date();

    this.logger.info("Updating subscription in database", {
      subscriptionId: subscription.subscriptionId,
      expirationDate,
    });

    const existing = await this.getExistingSubscription();

    let updatedHistory = parseSubscriptionHistory(
      existing?.subscriptionHistory,
      this.logger,
    );
    updatedHistory = cleanupOldHistoryEntries(updatedHistory);

    if (
      existing?.subscriptionId &&
      existing.subscriptionId !== subscription.subscriptionId
    ) {
      updatedHistory = addCurrentSubscriptionToHistory(
        updatedHistory,
        existing.subscriptionId,
        now,
        existing.accountCreatedAt,
        this.logger,
      );

      this.logger.info("Moving old subscription to history", {
        oldSubscriptionId: existing.subscriptionId,
        newSubscriptionId: subscription.subscriptionId,
        historyLength: updatedHistory.length,
      });
    }

    await prisma.emailAccount.update({
      where: { id: this.emailAccountId },
      data: {
        watchEmailsExpirationDate: expirationDate,
        watchEmailsSubscriptionId: subscription.subscriptionId,
        watchEmailsSubscriptionHistory: updatedHistory,
      },
    });

    this.logger.info("Updated subscription in database", {
      subscriptionId: subscription.subscriptionId,
      expirationDate,
      historyEntries: updatedHistory.length,
    });

    // Check if we were immediately overwritten by a concurrent call
    const current = await this.getExistingSubscription();
    if (current?.subscriptionId !== subscription.subscriptionId) {
      this.logger.warn(
        "Detected concurrent subscription update, ensuring our subscription is in history",
        {
          ourSubscriptionId: subscription.subscriptionId,
          currentSubscriptionId: current?.subscriptionId,
        },
      );
      await this.addSubscriptionToHistoryIfMissing(
        subscription.subscriptionId,
        now,
        existing?.accountCreatedAt || now,
      );
    }
  }

  /**
   * Atomically adds a subscription to the history array if it's not already the current one
   * and not already in the history. This handles the case where we were overwritten
   * by a concurrent call before we could finish our update.
   */
  private async addSubscriptionToHistoryIfMissing(
    subscriptionId: string,
    replacedAt: Date,
    accountCreatedAt: Date,
  ): Promise<void> {
    const historyEntry = {
      subscriptionId,
      createdAt: accountCreatedAt.toISOString(),
      replacedAt: replacedAt.toISOString(),
    };

    // Use a raw query to atomically append to the JSONB array only if the subscriptionId
    // isn't already the main one AND isn't already in the history array.
    await prisma.$executeRaw`
      UPDATE "EmailAccount"
      SET "watchEmailsSubscriptionHistory" = 
        COALESCE("watchEmailsSubscriptionHistory", '[]'::jsonb) || ${JSON.stringify([historyEntry])}::jsonb
      WHERE id = ${this.emailAccountId}
        AND "watchEmailsSubscriptionId" != ${subscriptionId}
        AND NOT (
          COALESCE("watchEmailsSubscriptionHistory", '[]'::jsonb) @> ${JSON.stringify([{ subscriptionId }])}::jsonb
        )
    `;
  }
}

function shouldRenewAgedSubscription(expirationDate: Date, now: Date) {
  const subscriptionStartedAt = new Date(
    expirationDate.getTime() - OUTLOOK_SUBSCRIPTION_LIFETIME_MS,
  );
  const subscriptionAgeMs = now.getTime() - subscriptionStartedAt.getTime();

  return subscriptionAgeMs >= OUTLOOK_MAX_REUSE_AGE_MS;
}

export async function createManagedOutlookSubscription({
  emailAccountId,
  logger,
  forceRefresh,
}: {
  emailAccountId: string;
  logger: Logger;
  forceRefresh?: boolean;
}): Promise<{ expirationDate: Date; subscriptionId: string } | null> {
  const provider = await createEmailProvider({
    emailAccountId,
    provider: "microsoft",
    logger,
  });
  const manager = new OutlookSubscriptionManager(
    provider,
    emailAccountId,
    logger,
  );

  return manager.createAndPersistSubscription({ forceRefresh });
}
