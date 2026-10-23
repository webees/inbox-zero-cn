import prisma from "@/utils/prisma";
import { isDuplicateError } from "@/utils/prisma-helpers";
import { createScopedLogger } from "@/utils/logger";
import type { MicrosoftIdTokenClaims } from "@/utils/outlook/oauth";

const logger = createScopedLogger("auth/microsoft-account-subject");

/**
 * better-auth 在 v1.7 之前使用 id_token 的 `sub` 声明作为 Microsoft 账号的键，
 * 之后改用 `oid`。在该升级之前存储的账号仍保存着 `sub`，
 * 因此按 `oid` 查找会匹配不到，转而回退到按邮箱匹配，
 * 并以 `account_not_linked` 导致登录失败。
 *
 * 这两个声明必须来自同一个 id_token：唯有如此，被重新设置键的那一行
 * 才是刚刚通过认证的身份，而不是
 * Entra 允许租户自由设置的某个资料字段所匹配到的身份。
 */
export async function reconcileMicrosoftAccountSubject({
  oid,
  sub,
}: MicrosoftIdTokenClaims) {
  if (!oid || !sub || oid === sub) return;

  const legacyAccount = await findMicrosoftAccount(sub);
  if (!legacyAccount) return;

  // 当前键下已有记录，说明旧记录是重复项。
  // 合并二者属于面向用户的决策，因此保留两者。
  const currentAccount = await findMicrosoftAccount(oid);
  if (currentAccount) return;

  try {
    await prisma.account.update({
      where: { id: legacyAccount.id },
      data: { providerAccountId: oid },
    });
  } catch (error) {
    if (isDuplicateError(error)) return;
    throw error;
  }

  logger.info("已将 Microsoft 账号重新设置为 Entra 对象 id", {
    accountId: legacyAccount.id,
    userId: legacyAccount.userId,
  });
}

function findMicrosoftAccount(providerAccountId: string) {
  return prisma.account.findUnique({
    where: {
      provider_providerAccountId: { provider: "microsoft", providerAccountId },
    },
    select: { id: true, userId: true },
  });
}
