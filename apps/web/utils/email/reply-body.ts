import { env } from "@/env";
import prisma from "@/utils/prisma";
import { renderEmailTextWithSafeLinks } from "@/utils/email/render-safe-links";
import { getOrCreateReferralCode } from "@/utils/referral/referral-code";
import { generateReferralLink } from "@/utils/referral/referral-link";
import { renderReferralSignatureHtml } from "@/utils/referral/signature";

// 传给邮件服务商的回复正文是 HTML 安全的：不受信任的文本
// 在此处转义，之后仅追加受信任的签名 HTML。
export async function buildDraftReplyBody({
  text,
  emailAccountId,
  userId,
}: {
  text: string;
  emailAccountId: string;
  userId: string;
}): Promise<string> {
  const emailAccount = await prisma.emailAccount.findUnique({
    where: { id: emailAccountId },
    select: {
      allowHiddenAiDraftLinks: true,
      includeReferralSignature: true,
      signature: true,
    },
  });

  let body = renderEmailTextWithSafeLinks(text, {
    allowHiddenLinks: emailAccount?.allowHiddenAiDraftLinks ?? false,
  });

  if (emailAccount?.signature) {
    body = `${body}\n\n${emailAccount.signature}`;
  }

  if (
    !env.NEXT_PUBLIC_DISABLE_REFERRAL_SIGNATURE &&
    emailAccount?.includeReferralSignature
  ) {
    const referralCode = await getOrCreateReferralCode(userId);
    const referralLink = generateReferralLink(referralCode.code);
    body = `${body}\n\n${renderReferralSignatureHtml(referralLink)}`;
  }

  return body;
}
