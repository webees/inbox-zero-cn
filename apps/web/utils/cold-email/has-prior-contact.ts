import type { EmailProvider } from "@/utils/email/types";
import type { Logger } from "@/utils/logger";

/**
 * 用户此前是否与该发件人有过往来；在无法判断时一律视为是。
 * 无法判断时。
 *
 * 阻止某个发件人会产生连锁影响：它会打标签、归档，并在许多账号上
 * 向对方发邮件说明其邮件未经请求。放过一封冷邮件只会让收件箱
 * 多一封邮件。因此缺失日期、无法读取的邮件或服务商故障
 * 都应倾向于放过该发件人，而不是阻止他们。
 */
export async function hasPriorContactOrAssumeYes({
  provider,
  from,
  date,
  messageId,
  logger,
}: {
  provider: EmailProvider;
  from: string;
  date: Date | undefined;
  messageId: string | undefined;
  logger: Logger;
}): Promise<boolean> {
  if (
    !from.trim() ||
    !date ||
    Number.isNaN(date.getTime()) ||
    !messageId?.trim()
  ) {
    logger.warn("假定存在先前联系——邮件缺少发件人、日期或 id");
    return true;
  }

  try {
    return await provider.hasPreviousCommunicationsWithSenderOrDomain({
      from,
      date,
      messageId,
    });
  } catch (error) {
    logger.warn("假定存在先前联系——无法检查是否有先前邮件", {
      error,
    });
    return true;
  }
}
