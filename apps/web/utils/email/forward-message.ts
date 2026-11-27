import type { EmailProvider } from "@/utils/email/types";
import type { ParsedMessage } from "@/utils/types";
import { getFormattedSenderAddress } from "@/utils/email/get-formatted-sender-address";

/**
 * 转发现有邮件，重新获取其附件并从原始邮件
 * 构建转发的主题和引用正文。
 *
 * 解析账号自己的发件地址，使转发使用用户的显示名称和
 * send-as 别名发出，而不是原始账号地址。
 */
export async function forwardMessage({
  emailProvider,
  emailAccountId,
  message,
  to,
  cc,
  bcc,
  content,
}: {
  emailProvider: EmailProvider;
  emailAccountId: string;
  message: ParsedMessage;
  to: string;
  cc?: string | null;
  bcc?: string | null;
  content?: string | null;
}) {
  const from = await getFormattedSenderAddress({ emailAccountId });

  await emailProvider.forwardEmail(message, {
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    content: content || undefined,
    from: from || undefined,
  });
}
