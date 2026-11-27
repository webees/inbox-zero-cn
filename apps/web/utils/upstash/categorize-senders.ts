import chunk from "lodash/chunk";
import { deleteQueue, listQueues, publishToQstashQueue } from "@/utils/upstash";
import type { AiCategorizeSenders } from "@/utils/categorize/senders/batch-validation";
import { createScopedLogger } from "@/utils/logger";

const logger = createScopedLogger("upstash");

const CATEGORIZE_SENDERS_PREFIX = "ai-categorize-senders";

const getCategorizeSendersQueueName = ({
  emailAccountId,
}: {
  emailAccountId: string;
}) => `${CATEGORIZE_SENDERS_PREFIX}-${emailAccountId}`;

/**
 * 分批将发件人分类任务发布到 QStash 队列
 * 将大量发件人数组拆分为 BATCH_SIZE 大小的分块，以避免系统过载
 */
export async function publishToAiCategorizeSendersQueue(
  body: AiCategorizeSenders,
) {
  // 将发件人拆分为更小的分块以便分批处理
  const BATCH_SIZE = 50;
  const chunks = chunk(body.senders, BATCH_SIZE);

  // 为每个用户创建新队列，以便并行处理多个用户
  const queueName = getCategorizeSendersQueueName({
    emailAccountId: body.emailAccountId,
  });

  logger.info("正在分批发布到 AI 发件人分类队列", {
    queueName,
    totalSenders: body.senders.length,
    numberOfChunks: chunks.length,
  });

  // 并行处理所有分块，每个分块作为单独的队列项
  await Promise.all(
    chunks.map((senderChunk) =>
      publishToQstashQueue({
        queueName,
        parallelism: 3, // Allow up to 3 concurrent jobs from this queue
        path: "/api/user/categorize/senders/batch",
        body: {
          emailAccountId: body.emailAccountId,
          senders: senderChunk,
        } satisfies AiCategorizeSenders,
      }),
    ),
  );
}

export async function deleteEmptyCategorizeSendersQueues({
  skipEmailAccountId,
}: {
  skipEmailAccountId: string;
}) {
  return deleteEmptyQueues({
    prefix: CATEGORIZE_SENDERS_PREFIX,
    skipEmailAccountId,
  });
}

async function deleteEmptyQueues({
  prefix,
  skipEmailAccountId,
}: {
  prefix: string;
  skipEmailAccountId: string;
}) {
  const queues = await listQueues();
  logger.info("Found queues", { count: queues.length });
  for (const queue of queues) {
    if (!queue.name.startsWith(prefix)) continue;
    if (
      skipEmailAccountId &&
      queue.name ===
        getCategorizeSendersQueueName({ emailAccountId: skipEmailAccountId })
    )
      continue;

    if (!queue.lag) {
      try {
        await deleteQueue(queue.name);
      } catch (error) {
        logger.error("删除队列失败", { queueName: queue.name, error });
      }
    }
  }
}
