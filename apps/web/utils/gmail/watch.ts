import type { gmail_v1 } from "@googleapis/gmail";
import { GmailLabel } from "./label";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import {
  extractErrorInfo,
  isExistingGmailPushClientError,
  withGmailRetry,
} from "@/utils/gmail/retry";

export async function watchGmail(gmail: gmail_v1.Gmail, logger: Logger) {
  if (env.GOOGLE_PUBSUB_VERIFICATION_TOKEN == null) {
    throw new Error("监控 Gmail 需要 GOOGLE_PUBSUB_VERIFICATION_TOKEN");
  }

  try {
    return await startGmailWatch(gmail, logger);
  } catch (error) {
    if (!isExistingGmailPushClientError(extractErrorInfo(error))) throw error;

    logger.warn("在推送客户端冲突后重置 Gmail watch");
    await unwatchGmail(gmail);
    return await startGmailWatch(gmail, logger);
  }
}

export async function unwatchGmail(gmail: gmail_v1.Gmail) {
  await withGmailRetry(() => gmail.users.stop({ userId: "me" }));
}

async function startGmailWatch(gmail: gmail_v1.Gmail, logger: Logger) {
  const res = await withGmailRetry(() =>
    gmail.users.watch({
      userId: "me",
      requestBody: {
        labelIds: [GmailLabel.INBOX, GmailLabel.SENT],
        labelFilterBehavior: "include",
        topicName: env.GOOGLE_PUBSUB_TOPIC_NAME,
      },
    }),
  );

  logger.info("Gmail watch 已注册", {
    gmailHistoryId: res.data.historyId,
    expirationDate: res.data.expiration
      ? new Date(Number(res.data.expiration)).toISOString()
      : undefined,
    topic: env.GOOGLE_PUBSUB_TOPIC_NAME,
  });

  return res.data;
}
