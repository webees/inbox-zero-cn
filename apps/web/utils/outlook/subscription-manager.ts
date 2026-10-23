import prisma from "@/utils/prisma";
import { captureException } from "@/utils/error";
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
 * 管理 Outlook 订阅，通过在创建新订阅之前取消旧订阅，
 * 确保每个邮箱账号只有一个活动订阅。
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
  } | null> {
    const forceRefresh = options?.forceRefresh === true;
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
          this.logger.info("现有订阅有效；复用", {
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
          this.logger.info("现有订阅显式刷新", {
            subscriptionId: existing.subscriptionId,
            expirationDate: existing.expirationDate,
          });
        } else if (
          timeUntilExpiry <= OUTLOOK_SUBSCRIPTION_RENEWAL_THRESHOLD_MS
        ) {
          this.logger.info("现有订阅临近过期；续订", {
            subscriptionId: existing.subscriptionId,
            expirationDate: existing.expirationDate,
          });
        } else {
          this.logger.info("现有订阅达到最大时长；续订", {
            subscriptionId: existing.subscriptionId,
            expirationDate: existing.expirationDate,
          });
        }
      } else {
        this.logger.info("未找到现有订阅；创建新的");
      }

      await this.cancelSubscription(existing?.subscriptionId);

      const subscription = await this.client.watchEmails();

      this.logger.info("成功创建新订阅", {
        subscriptionId: subscription?.subscriptionId,
      });

      return subscription
        ? {
            expirationDate: subscription.expirationDate,
            subscriptionId: subscription.subscriptionId,
            changed: true,
          }
        : null;
    } catch (error) {
      this.logger.error("创建订阅失败", { error });
      captureException(error, { emailAccountId: this.emailAccountId });
      return null;
    }
  }

  /**
   * 创建（或复用）订阅，在变更时将其持久化到数据库，
   * 并在数据库失败时清理孤立的订阅。
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
        this.logger.error("将订阅保存到数据库失败", {
          subscriptionId: result.subscriptionId,
          error,
        });

        try {
          await this.client.unwatchEmails(result.subscriptionId);
          this.logger.info("数据库失败后取消了孤立订阅", {
            subscriptionId: result.subscriptionId,
          });
        } catch (cancelError) {
          this.logger.error("取消孤立订阅失败", {
            subscriptionId: result.subscriptionId,
            error: cancelError,
          });
        }

        captureException(error, { emailAccountId: this.emailAccountId });
        return null;
      }
    }

    return {
      expirationDate: result.expirationDate,
      subscriptionId: result.subscriptionId,
    };
  }

  private async cancelSubscription(subscriptionId: string | null | undefined) {
    if (!subscriptionId) return;

    try {
      await this.client.unwatchEmails(subscriptionId);
      this.logger.info("已取消现有订阅", { subscriptionId });
    } catch (error) {
      // 该订阅可能已经过期/无效
      this.logger.warn("取消现有订阅失败（可能已过期）", {
        subscriptionId,
        error,
      });
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

    this.logger.info("正在数据库中更新订阅", {
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

      this.logger.info("正在将旧订阅移入历史", {
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

    this.logger.info("已在数据库中更新订阅", {
      subscriptionId: subscription.subscriptionId,
      expirationDate,
      historyEntries: updatedHistory.length,
    });

    // 检查我们是否立即被并发调用覆盖
    const current = await this.getExistingSubscription();
    if (current?.subscriptionId !== subscription.subscriptionId) {
      this.logger.warn("检测到并发的订阅更新，正在确保我们的订阅在历史记录中", {
        ourSubscriptionId: subscription.subscriptionId,
        currentSubscriptionId: current?.subscriptionId,
      });
      await this.addSubscriptionToHistoryIfMissing(
        subscription.subscriptionId,
        now,
        existing?.accountCreatedAt || now,
      );
    }
  }

  /**
   * 原子地将订阅添加到历史数组（如果它尚不是当前订阅
   * 且尚未在历史中）。这处理了我们在完成更新之前
   * 被并发调用覆盖的情况。
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

    // 使用原始查询原子地追加到 JSONB 数组，仅当 subscriptionId
    // 尚不是主订阅且尚未在历史数组中时。
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
