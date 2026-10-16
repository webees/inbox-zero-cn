import { extractEmailAddress } from "@/utils/email";
import { getSenders } from "./get-senders";
import prisma from "@/utils/prisma";
import type { Sender } from "@/utils/categorize/senders/batch-validation";

const MAX_ITERATIONS = 200;

export async function getUncategorizedSenders({
  emailAccountId,
  offset = 0,
  limit = 100,
}: {
  emailAccountId: string;
  offset?: number;
  limit?: number;
}) {
  let uncategorizedSenders: Sender[] = [];
  let currentOffset = offset;

  while (uncategorizedSenders.length === 0 && currentOffset < MAX_ITERATIONS) {
    const result = await getSenders({
      emailAccountId,
      limit,
      offset: currentOffset,
    });

    const senderMap = new Map<string, string | null>();
    for (const sender of result) {
      const extractedEmail = extractEmailAddress(sender.from);
      // 从邮件头无法解析的会提取为 ""，因而永远无法被分类
      if (!extractedEmail) continue;
      // 规范化，使同一地址的大小写变体去重为一条记录
      const email = extractedEmail.toLowerCase();
      // 仅当我们尚未有名称时才设置（保留第一个非空值）
      if (!senderMap.has(email) || (!senderMap.get(email) && sender.fromName)) {
        senderMap.set(email, sender.fromName);
      }
    }

    const allSenderEmails = Array.from(senderMap.keys());

    // 发件人记录存储规范化（小写）后的邮箱，而邮件正文
    // from headers keep their original casing — compare case-insensitively so
    // 已分类的发件人不会被永久重复入队。
    const existingSenders = await prisma.newsletter.findMany({
      where: {
        email: { in: allSenderEmails, mode: "insensitive" },
        emailAccountId,
        category: { isNot: null },
      },
      select: { email: true },
    });

    const existingSenderEmails = new Set(
      existingSenders.map((s) => s.email.toLowerCase()),
    );

    uncategorizedSenders = allSenderEmails
      .filter((email) => !existingSenderEmails.has(email))
      .map((email) => ({ email, name: senderMap.get(email) ?? null }));

    // 使用 result.length（原始查询计数），而非 allSenderEmails.length（去重后计数）
    // 以正确判断是否还有更多分页
    if (result.length < limit) {
      return { uncategorizedSenders };
    }

    currentOffset += limit;
  }

  // 仅在找到发件人时才返回 nextOffset（避免达到 MAX_ITERATIONS 时陷入死循环）
  if (uncategorizedSenders.length > 0) {
    return { uncategorizedSenders, nextOffset: currentOffset };
  }
  return { uncategorizedSenders };
}
