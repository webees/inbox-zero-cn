import type { gmail_v1 } from "@googleapis/gmail";
import { createScopedLogger } from "@/utils/logger";
import { withGmailRetry } from "@/utils/gmail/retry";

const logger = createScopedLogger("gmail-signature");

export interface GmailSignature {
  displayName?: string;
  email: string;
  isDefault: boolean;
  isPrimary: boolean;
  /** Gmail won't send from an alias whose ownership is still unconfirmed. */
  isVerified: boolean;
  signature: string;
}

/**
 * 使用 sendAs 设置 API 从 Gmail 获取所有签名
 * https://developers.google.com/gmail/api/reference/rest/v1/users.settings.sendAs
 */
export async function getGmailSignatures(
  gmail: gmail_v1.Gmail,
): Promise<GmailSignature[]> {
  try {
    const sendAsList = await withGmailRetry(() =>
      gmail.users.settings.sendAs.list({
        userId: "me",
      }),
    );

    if (!sendAsList.data.sendAs || sendAsList.data.sendAs.length === 0) {
      logger.warn("未找到 sendAs 设置");
      return [];
    }

    const signatures: GmailSignature[] = [];

    for (const sendAs of sendAsList.data.sendAs) {
      if (!sendAs.sendAsEmail) continue;

      signatures.push({
        email: sendAs.sendAsEmail,
        signature: sendAs.signature || "",
        isDefault: sendAs.isDefault ?? false,
        isPrimary: sendAs.isPrimary ?? false,
        isVerified: sendAs.verificationStatus !== "pending",
        displayName: sendAs.displayName || undefined,
      });
    }

    logger.info("已成功获取 Gmail 签名", {
      count: signatures.length,
    });

    return signatures;
  } catch (error) {
    logger.error("获取 Gmail 签名失败", { error });
    throw error;
  }
}
