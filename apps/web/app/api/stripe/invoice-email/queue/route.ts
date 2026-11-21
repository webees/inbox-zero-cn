import { stripeInvoiceEmailBody } from "@/ee/billing/stripe/invoice-email";
import { createForwardingQueueHandler } from "@/utils/queue/create-forwarding-queue-handler";

export const maxDuration = 60;

export const POST = createForwardingQueueHandler({
  loggerScope: "stripe/invoice-email/queue",
  schema: stripeInvoiceEmailBody,
  path: "/api/stripe/invoice-email",
  invalidPayloadMessage: "无效的 Stripe 发票邮件队列负载",
  visibilityTimeoutSeconds: 55,
  getLoggerContext: ({ invoiceId }) => ({ invoiceId }),
});
