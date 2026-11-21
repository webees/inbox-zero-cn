import type Stripe from "stripe";
import { getStripe } from "@/ee/billing/stripe";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";

// Reasons where proof of an active, uncanceled subscription that the customer
// kept using is the evidence the issuer asks for.
const CONTESTABLE_REASONS = new Set([
  "subscription_canceled",
  "unrecognized",
  "general",
  "product_not_received",
  "fraudulent",
]);

export async function contestStripeDisputeIfClear({
  disputeId,
  logger: parentLogger,
}: {
  disputeId: string;
  logger: Logger;
}) {
  // Fetched fresh: a retried webhook still carries the original status.
  const dispute = await getStripe().disputes.retrieve(disputeId);
  const logger = parentLogger.with({
    disputeId: dispute.id,
    disputeReason: dispute.reason,
  });

  if (dispute.status !== "needs_response") {
    logger.info("Skipping dispute that does not need a response", {
      status: dispute.status,
    });
    return;
  }

  if (!CONTESTABLE_REASONS.has(dispute.reason)) {
    logger.info("Leaving dispute for manual review: reason not contested");
    return;
  }

  const facts = await getDisputeFacts(dispute);
  if (!facts) {
    logger.info(
      "Leaving dispute for manual review: charge is not a subscription payment",
    );
    return;
  }

  const decision = getDisputeDecision(facts);
  if (!decision.contest) {
    logger.warn("Leaving dispute for manual review", {
      why: decision.why,
      subscriptionId: facts.subscriptionId,
    });
    return;
  }

  await getStripe().disputes.update(dispute.id, {
    evidence: buildDisputeEvidence({ facts, reason: dispute.reason }),
    submit: true,
  });

  logger.info("Submitted dispute evidence", {
    subscriptionId: facts.subscriptionId,
  });
}

export type DisputeFacts = {
  chargedAt: Date;
  subscriptionId: string;
  servicePeriod: { start: Date; end: Date } | null;
  cancellationRequestedAt: Date | null;
  refunded: boolean;
  customerEmail: string | null;
  lastActiveAt: Date | null;
  assistantMessagesSinceCharge: number;
};

export function getDisputeDecision(
  facts: DisputeFacts,
): { contest: true } | { contest: false; why: string } {
  if (facts.refunded) {
    return { contest: false, why: "charge was already (partially) refunded" };
  }

  if (
    facts.cancellationRequestedAt &&
    facts.cancellationRequestedAt <= facts.chargedAt
  ) {
    return {
      contest: false,
      why: "cancellation was requested before the charge",
    };
  }

  const usedAfterCharge =
    (facts.lastActiveAt && facts.lastActiveAt > facts.chargedAt) ||
    facts.assistantMessagesSinceCharge > 0;
  if (!usedAfterCharge) {
    return { contest: false, why: "no product usage after the charge" };
  }

  return { contest: true };
}

export function buildDisputeEvidence({
  facts,
  reason,
}: {
  facts: DisputeFacts;
  reason: string;
}): Stripe.DisputeUpdateParams.Evidence {
  const baseUrl = env.NEXT_PUBLIC_BASE_URL;

  const cancellationLine = facts.cancellationRequestedAt
    ? `客户在本次扣款之后于 ${formatDate(facts.cancellationRequestedAt)} 请求取消订阅。`
    : "客户尚未请求取消订阅。";

  const usageLines = [
    facts.lastActiveAt && facts.lastActiveAt > facts.chargedAt
      ? `客户在本次扣款之后于 ${formatDate(facts.lastActiveAt)} 登录并使用过本应用。`
      : null,
    facts.assistantMessagesSinceCharge > 0
      ? `本次扣款后，客户向应用内 AI 助手发送了 ${facts.assistantMessagesSinceCharge} 条消息。`
      : null,
  ].filter(Boolean);

  const rebuttal = [
    `${formatDate(facts.chargedAt)} 的这笔扣款是客户当前 Inbox Zero 订阅（${facts.subscriptionId}）的续费。`,
    "续费时，该订阅尚未被取消。",
    cancellationLine,
    "客户在扣款后继续使用了该服务：",
    ...usageLines.map((line) => `- ${line}`),
  ].join("\n");

  return {
    product_description:
      "Inbox Zero 是一款订阅制网页应用（AI 邮件助手），可整理客户的邮件、添加标签并起草回复。在每个计费周期自动续费，直至取消。",
    customer_email_address: facts.customerEmail ?? undefined,
    service_date: facts.servicePeriod
      ? `${formatDate(facts.servicePeriod.start)} 至 ${formatDate(facts.servicePeriod.end)}`
      : undefined,
    access_activity_log: [
      `账号邮箱：${facts.customerEmail ?? "未知"}`,
      `扣款日期：${facts.chargedAt.toISOString()}`,
      `最近一次登录应用的时间：${facts.lastActiveAt?.toISOString() ?? "未知"}`,
      `扣款后发送的 AI 助手消息数：${facts.assistantMessagesSinceCharge}`,
    ].join("\n"),
    cancellation_policy_disclosure: `客户可随时在 ${baseUrl}/premium 的计费页面取消订阅，该页面提供 Stripe 计费门户链接。取消后将停止后续续费。`,
    ...(reason === "subscription_canceled"
      ? { cancellation_rebuttal: rebuttal }
      : { uncategorized_text: rebuttal }),
  };
}

async function getDisputeFacts(
  dispute: Stripe.Dispute,
): Promise<DisputeFacts | null> {
  const stripe = getStripe();
  const chargeId = normalizeStripeId(dispute.charge);
  const paymentIntentId = normalizeStripeId(dispute.payment_intent);
  if (!chargeId || !paymentIntentId) return null;

  const [charge, invoicePayments] = await Promise.all([
    stripe.charges.retrieve(chargeId),
    stripe.invoicePayments.list({
      payment: { type: "payment_intent", payment_intent: paymentIntentId },
      limit: 1,
      expand: ["data.invoice"],
    }),
  ]);

  const invoice = invoicePayments.data[0]?.invoice;
  if (!invoice || typeof invoice === "string" || invoice.deleted) return null;

  // Initial and upgrade payments are left for manual review; the evidence
  // argues the charge was a scheduled renewal.
  if (invoice.billing_reason !== "subscription_cycle") return null;

  const subscriptionId = normalizeStripeId(
    invoice.parent?.subscription_details?.subscription ?? null,
  );
  const customerId = normalizeStripeId(charge.customer);
  if (!subscriptionId || !customerId) return null;

  const chargedAt = fromStripeTimestamp(charge.created);

  const [subscription, customer, premium] = await Promise.all([
    stripe.subscriptions.retrieve(subscriptionId),
    stripe.customers.retrieve(customerId),
    prisma.premium.findUnique({
      where: { stripeCustomerId: customerId },
      select: {
        stripeSubscriptionId: true,
        stripeCanceledAt: true,
        stripeCancellationInitiatedAt: true,
        users: { select: { id: true, email: true, lastLogin: true } },
      },
    }),
  ]);

  const customerEmail =
    charge.billing_details.email ??
    (customer.deleted ? null : customer.email) ??
    null;

  // Only the paying customer's own activity counts; on shared plans other
  // members may have joined after the charge.
  const payer = customerEmail
    ? premium?.users.find(
        (user) => user.email.toLowerCase() === customerEmail.toLowerCase(),
      )
    : undefined;

  const assistantMessagesSinceCharge = payer
    ? await prisma.chatMessage.count({
        where: {
          role: "user",
          createdAt: { gt: chargedAt },
          chat: { emailAccount: { userId: payer.id } },
        },
      })
    : 0;

  // Our cancellation timestamps describe whichever subscription is current.
  const premiumCancellation =
    premium?.stripeSubscriptionId === subscriptionId ? premium : null;

  const linePeriod = invoice.lines.data.find((line) => {
    const details = line.parent?.subscription_item_details;
    return details?.subscription === subscriptionId && !details.proration;
  })?.period;

  return {
    chargedAt,
    subscriptionId,
    servicePeriod: linePeriod
      ? {
          start: fromStripeTimestamp(linePeriod.start),
          end: fromStripeTimestamp(linePeriod.end),
        }
      : null,
    cancellationRequestedAt: earliestDate([
      premiumCancellation?.stripeCancellationInitiatedAt,
      premiumCancellation?.stripeCanceledAt,
      subscription.canceled_at
        ? fromStripeTimestamp(subscription.canceled_at)
        : null,
    ]),
    refunded: charge.amount_refunded > 0,
    customerEmail,
    lastActiveAt: payer?.lastLogin ?? null,
    assistantMessagesSinceCharge,
  };
}

function earliestDate(dates: Array<Date | null | undefined>) {
  const times = dates.filter((d): d is Date => !!d).map((d) => d.getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function fromStripeTimestamp(seconds: number) {
  return new Date(seconds * 1000);
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeStripeId(value: string | { id: string } | null | undefined) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}
