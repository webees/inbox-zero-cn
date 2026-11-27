import { env } from "@/env";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import { renderSentWithFooterHtml } from "@/utils/email/sent-with-footer";
import { getOrCreateReferralCode } from "@/utils/referral/referral-code";
import { generateReferralLink } from "@/utils/referral/referral-link";

/**
 * 每个写信器都会添加到新邮件的签名和“Sent with”页脚，
 * 使网页端和移动应用发送相同的内容。
 */
export async function getComposeSignature({
  emailAccountId,
  userId,
}: {
  emailAccountId: string;
  userId: string;
}) {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: { signature: true, includeSentWithSignature: true },
  });
  if (!emailAccount) throw new SafeError("未找到邮箱账号");

  const includeFooter =
    !env.NEXT_PUBLIC_DISABLE_REFERRAL_SIGNATURE &&
    emailAccount.includeSentWithSignature;
  return {
    signatureHtml: emailAccount.signature ?? "",
    footerHtml: includeFooter
      ? renderSentWithFooterHtml(await getFooterLink(userId))
      : "",
  };
}

// 推荐查询失败仍会发送页脚，只是不带推荐链接。
async function getFooterLink(userId: string) {
  try {
    const { code } = await getOrCreateReferralCode(userId);
    return generateReferralLink(code);
  } catch {
    return env.NEXT_PUBLIC_BASE_URL;
  }
}
