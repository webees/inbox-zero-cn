import { Suspense } from "react";
import { after } from "next/server";
import { redirect } from "next/navigation";
import {
  ConversionAnalyticsScript,
  ConversionQueryParamEvents,
} from "@/components/ConversionAnalytics";
import { PageHeading, TypographyP } from "@/components/Typography";
import { BasicLayout } from "@/components/layouts/BasicLayout";
import { CardBasic } from "@/components/ui/card";
import { getStripe } from "@/ee/billing/stripe";
import { syncStripeDataToDb } from "@/ee/billing/stripe/sync-stripe";
import {
  CONVERSION_EVENT_ID_PARAM,
  CONVERSION_EVENT_PARAM,
} from "@/utils/analytics/conversion-events";
import { createScopedLogger } from "@/utils/logger";
import { trackStripeCheckoutCompleted } from "@/utils/posthog";
import prisma from "@/utils/prisma";
import { buildRedirectUrl } from "@/utils/redirect";

const logger = createScopedLogger("checkout-complete");

// Checkouts started in the desktop app finish in the system browser, which is
// usually signed out. Stripe sends them here instead of the authenticated
// success route, and the app picks up the new plan on its own.
export default async function CheckoutCompletePage(props: {
  searchParams: Promise<{ session_id?: string; status?: string }>;
}) {
  const { session_id: sessionId, status } = await props.searchParams;

  if (sessionId) {
    const outcome = await syncCompletedCheckout(sessionId);
    redirect(
      buildRedirectUrl("/checkout-complete", {
        status: outcome,
        ...(outcome === "trial"
          ? {
              [CONVERSION_EVENT_PARAM]: "trial_started",
              [CONVERSION_EVENT_ID_PARAM]: sessionId,
            }
          : {}),
      }),
    );
  }

  const { title, description } = getCopy(status);

  return (
    <BasicLayout>
      <Suspense>
        <ConversionQueryParamEvents />
      </Suspense>
      <ConversionAnalyticsScript />
      <div className="px-4 pb-40 pt-40">
        <CardBasic className="mx-auto max-w-xl text-center">
          <PageHeading>{title}</PageHeading>
          <TypographyP className="mt-2">{description}</TypographyP>
        </CardBasic>
      </div>
    </BasicLayout>
  );
}

type CheckoutOutcome = "trial" | "subscribed" | "unconfirmed";

async function syncCompletedCheckout(
  sessionId: string,
): Promise<CheckoutOutcome> {
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });
    const customerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id;
    if (session.status !== "complete" || !customerId) return "unconfirmed";

    await syncStripeDataToDb({ customerId, logger });

    const user = await prisma.user.findFirst({
      where: { premium: { stripeCustomerId: customerId } },
      select: { email: true },
    });
    if (user) {
      after(() =>
        trackStripeCheckoutCompleted(user.email, {
          source: "desktop_checkout_complete",
        }),
      );
    }

    const subscription =
      typeof session.subscription === "object" ? session.subscription : null;
    return subscription?.status === "trialing" ? "trial" : "subscribed";
  } catch (error) {
    // Stripe webhook 仍会同步套餐，因此页面可以继续。
    logger.error("同步桌面端结账失败", { error });
    return "unconfirmed";
  }
}

function getCopy(status: string | undefined) {
  switch (status) {
    case "canceled":
      return {
        title: "结账已取消",
        description: "未产生任何费用。请切换回 Inbox Zero 应用选择套餐。",
      };
    case "trial":
      return {
        title: "一切就绪",
        description:
          "您的试用已开始。请切换回 Inbox Zero 应用，它将打开您的收件箱。",
      };
    case "subscribed":
      return {
        title: "一切就绪",
        description:
          "您的订阅已生效。请切换回 Inbox Zero 应用，它将打开您的收件箱。",
      };
    default:
      return {
        title: "切换回 Inbox Zero",
        description:
          "我们仍在确认您的结账。请切换回 Inbox Zero 应用，套餐生效后它将打开您的收件箱。",
      };
  }
}
