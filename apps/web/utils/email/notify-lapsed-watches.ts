import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import {
  getPremiumUserFilter,
  getUserTier,
  hasAiAccess,
  premiumEntitlementSelect,
} from "@/utils/premium";
import {
  addUserErrorMessageWithNotification,
  ErrorType,
  watchLapsedErrorKey,
} from "@/utils/error-messages";

// 少量错过或失败的 cron 运行不应触发通知。
const MIN_LAPSE_MS = 24 * 60 * 60 * 1000;
// 不是回填：很久以前就已失效的账号绝不能收到此邮件。
const MAX_LAPSE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACCOUNTS_PER_RUN = 500;
const NOTIFY_CONCURRENCY = 10;

export async function notifyLapsedWatches({ logger }: { logger: Logger }) {
  const fetched = await getRecentlyLapsedEmailAccounts();

  if (!fetched.length) return { notified: 0 };

  const truncated = fetched.length > MAX_ACCOUNTS_PER_RUN;
  const emailAccounts = truncated
    ? fetched.slice(0, MAX_ACCOUNTS_PER_RUN)
    : fetched;

  logger.info("发现近期失效的 watch 账号", {
    count: emailAccounts.length,
    truncated,
  });

  let notified = 0;

  for (let i = 0; i < emailAccounts.length; i += NOTIFY_CONCURRENCY) {
    const batch = emailAccounts.slice(i, i + NOTIFY_CONCURRENCY);
    const results = await Promise.all(
      batch.map((emailAccount) => notifyIfEligible(emailAccount, logger)),
    );
    notified += results.filter(Boolean).length;
  }

  logger.info("已处理失效 watch 通知", { notified });

  return { notified };
}

async function notifyIfEligible(
  emailAccount: Awaited<
    ReturnType<typeof getRecentlyLapsedEmailAccounts>
  >[number],
  logger: Logger,
): Promise<boolean> {
  const { user } = emailAccount;

  const userHasAiAccess = hasAiAccess(
    getUserTier(user.premium),
    !!user.aiApiKey,
  );
  if (!userHasAiAccess) return false;

  await addUserErrorMessageWithNotification({
    userId: emailAccount.userId,
    userEmail: emailAccount.email,
    emailAccountId: emailAccount.id,
    errorType: ErrorType.EMAIL_WATCH_LAPSED,
    storageKey: watchLapsedErrorKey(emailAccount.id),
    errorMessage: `${emailAccount.email} 的邮件自动化已停止，请重新连接账号以恢复自动化。`,
    logger: logger.with({ emailAccountId: emailAccount.id }),
  });

  return true;
}

async function getRecentlyLapsedEmailAccounts() {
  const now = Date.now();

  return prisma.emailAccount.findMany({
    where: {
      ...getPremiumUserFilter(),
      account: { disconnectedAt: null },
      watchEmailsExpirationDate: {
        gte: new Date(now - MAX_LAPSE_MS),
        lt: new Date(now - MIN_LAPSE_MS),
      },
    },
    select: {
      id: true,
      email: true,
      userId: true,
      user: {
        select: {
          aiApiKey: true,
          premium: { select: premiumEntitlementSelect },
        },
      },
    },
    // 最先过期者优先，因此即使批次被限制在真实匹配数量之下，
    // 仍会通知最接近超出时间窗口的账号。
    orderBy: { watchEmailsExpirationDate: "asc" },
    take: MAX_ACCOUNTS_PER_RUN + 1,
  });
}
