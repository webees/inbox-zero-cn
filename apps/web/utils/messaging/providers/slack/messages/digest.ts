import type { KnownBlock, Block } from "@slack/types";
import {
  DIGEST_MAX_ITEMS_PER_RULE,
  formatDigestDate,
} from "@/utils/digest/format";
import { escapeSlackText } from "@/utils/messaging/providers/slack/format";

type DigestItem = {
  from: string;
  subject: string;
};

export type DigestBlocksParams = {
  date: Date;
  ruleNames: Record<string, string>;
  itemsByRule: Record<string, DigestItem[] | undefined>;
};

export function buildDigestBlocks({
  date,
  ruleNames,
  itemsByRule,
}: DigestBlocksParams): (KnownBlock | Block)[] {
  const blocks: (KnownBlock | Block)[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📋 你的 Inbox Zero 邮件摘要 — ${formatDigestDate(date)}`,
        emoji: true,
      },
    },
  ];

  const ruleKeys = Object.keys(itemsByRule).filter(
    (key) => (itemsByRule[key]?.length ?? 0) > 0,
  );

  for (const [index, ruleKey] of ruleKeys.entries()) {
    const items = itemsByRule[ruleKey] ?? [];
    const displayName = ruleNames[ruleKey] ?? ruleKey;
    const visible = items.slice(0, DIGEST_MAX_ITEMS_PER_RULE);
    const overflow = items.length - visible.length;

    const lines = visible.map(
      (item) =>
        `• _${escapeSlackText(item.from)}_ — ${escapeSlackText(item.subject)}`,
    );

    if (overflow > 0) {
      lines.push(`_+ 还有 ${overflow} 封_`);
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${escapeSlackText(displayName)}* (${items.length})\n${lines.join("\n")}`,
      },
    });

    if (index < ruleKeys.length - 1) {
      blocks.push({ type: "divider" });
    }
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "由 Inbox Zero 生成" }],
  });

  return blocks;
}
