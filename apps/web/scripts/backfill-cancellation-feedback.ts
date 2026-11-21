// Copies Stripe customer portal cancellation survey answers onto Premium for
// answers given before the Stripe sync stored them. Safe to re-run.
//
// Run with: `pnpm --filter inbox-zero-ai exec tsx scripts/backfill-cancellation-feedback.ts`
// Apply changes with: `pnpm --filter inbox-zero-ai exec tsx scripts/backfill-cancellation-feedback.ts --apply`

import "dotenv/config";
import { getStripe } from "@/ee/billing/stripe";
import prisma from "@/utils/prisma";

async function main() {
  const apply = process.argv.includes("--apply");
  const stripe = getStripe();

  let matched = 0;
  let unmatched = 0;

  // 高级版只跟踪每位客户最新的订阅，因此旧订阅上的回答无处可去。
  for await (const subscription of stripe.subscriptions.list({
    status: "all",
    limit: 100,
  })) {
    const feedback = subscription.cancellation_details?.feedback ?? null;
    const comment = subscription.cancellation_details?.comment || null;
    if (!feedback && !comment) continue;

    const where = { stripeSubscriptionId: subscription.id };
    const count = apply
      ? (
          await prisma.premium.updateMany({
            where,
            data: {
              stripeCancellationFeedback: feedback,
              stripeCancellationComment: comment,
            },
          })
        ).count
      : await prisma.premium.count({ where });

    if (count) matched++;
    else unmatched++;
  }

  console.log(
    `${apply ? "已更新" : "将更新"} ${matched} 条高级版记录。有 ${unmatched} 条回答所在订阅未被任何高级版记录跟踪。`,
  );
  if (!apply) console.log("试运行。重新运行并加上 --apply 即可写入。");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
