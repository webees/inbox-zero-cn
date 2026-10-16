import { PostHog } from "posthog-node";
import type { Properties } from "posthog-js";
import { env } from "@/env";
import { createScopedLogger } from "@/utils/logger";
import { hash } from "@/utils/hash";
import prisma from "@/utils/prisma";
import { redis } from "@/utils/redis";

const logger = createScopedLogger("posthog");
let posthogLlmClient: PostHog | undefined;

export function getPosthogLlmClient() {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return;

  if (!posthogLlmClient) {
    const host = env.NEXT_PUBLIC_POSTHOG_API_HOST?.startsWith("http")
      ? env.NEXT_PUBLIC_POSTHOG_API_HOST
      : undefined;

    posthogLlmClient = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
      ...(host ? { host } : {}),
      flushAt: 1,
      flushInterval: 0,
    });
  }

  return posthogLlmClient;
}

export function isPosthogLlmEvalApproved(email: string) {
  if (env.NODE_ENV !== "development") return false;

  const approvedEmails = getPosthogLlmEvalApprovedEmails();
  if (!approvedEmails.length) return false;

  return approvedEmails.includes(email.trim().toLowerCase());
}

async function getPosthogUserId(options: { email: string }) {
  const personsEndpoint = new URL(
    `https://app.posthog.com/api/projects/${env.POSTHOG_PROJECT_ID}/persons/`,
  );
  personsEndpoint.searchParams.set("distinct_id", options.email);

  // 1. find user id by distinct id
  const responseGet = await fetch(personsEndpoint.toString(), {
    headers: {
      Authorization: `Bearer ${env.POSTHOG_API_SECRET}`,
    },
  });

  const resGet: { results: { id: string; distinct_ids: string[] }[] } =
    await responseGet.json();

  if (!resGet.results?.[0]) {
    logger.error("未找到具有该 distinct id 的 Posthog 用户", {
      email: options.email,
    });
    return;
  }

  if (!resGet.results[0].distinct_ids?.includes(options.email)) {
    // 再次确认 distinct id
    throw new Error(
      `Distinct id ${resGet.results[0].distinct_ids} 不包含 ${options.email}`,
    );
  }

  const userId = resGet.results[0].id;

  return userId;
}

export async function deletePosthogUser(options: { email: string }) {
  if (!env.POSTHOG_API_SECRET || !env.POSTHOG_PROJECT_ID) {
    logger.warn("Posthog 环境变量未设置");
    return;
  }

  // 1. 通过 distinct id 查找用户 id
  const userId = await getPosthogUserId({ email: options.email });

  if (!userId) {
    logger.warn("未找到具有该 distinct id 的 Posthog 用户", {
      email: options.email,
    });
    return;
  }

  const personsEndpoint = `https://app.posthog.com/api/projects/${env.POSTHOG_PROJECT_ID}/persons/`;

  // 2. 通过 id 删除用户
  try {
    await fetch(`${personsEndpoint}${userId}/?delete_events=true`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${env.POSTHOG_API_SECRET}`,
      },
    });
  } catch (error) {
    logger.error("删除 Posthog 用户时出错", { error });
  }
}

export async function aliasPosthogUser({
  oldEmail,
  newEmail,
}: {
  oldEmail: string;
  newEmail: string;
}) {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    logger.warn("NEXT_PUBLIC_POSTHOG_KEY 未设置");
    return;
  }

  try {
    const client = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY);
    // Alias 将旧 distinct ID 关联到新 distinct ID
    // 这确保所有历史事件保持关联
    client.alias({ distinctId: newEmail, alias: oldEmail });
    await client.shutdown();
    logger.info("已为 PostHog 用户建立别名", {
      oldEmail: hash(oldEmail),
      newEmail: hash(newEmail),
    });
  } catch (error) {
    logger.error("为 PostHog 用户建立别名失败", { error });
  }
}

export async function posthogCaptureEvent(
  email: string,
  event: string,
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  properties?: Record<string, any>,
  sendFeatureFlags?: boolean,
  // 使用同一时间戳的稳定 uuid 可让 PostHog 丢弃重复投递。
  { uuid, timestamp }: { uuid?: string; timestamp?: Date } = {},
) {
  try {
    if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
      logger.warn("NEXT_PUBLIC_POSTHOG_KEY 未设置");
      return false;
    }

    const client = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY);
    client.capture({
      distinctId: email,
      event,
      properties,
      sendFeatureFlags,
      uuid,
      timestamp,
    });
    try {
      await client.flush();
      return true;
    } finally {
      try {
        Promise.resolve(client.shutdown()).catch((error) => {
          logger.error("关闭 PostHog 客户端失败", { error });
        });
      } catch (error) {
        logger.error("关闭 PostHog 客户端失败", { error });
      }
    }
  } catch (error) {
    logger.error("捕获 PostHog 事件失败", { error });
    return false;
  }
}

export async function trackUserSignedUp(email: string, createdAt: Date) {
  return posthogCaptureEvent(
    email,
    "User signed up",
    {
      $set_once: { createdAt },
    },
    true,
  );
}

export async function trackStripeCustomerCreated(
  email: string,
  stripeCustomerId: string,
) {
  return posthogCaptureEvent(
    email,
    "Stripe customer created",
    {
      $set_once: { stripeCustomerId },
    },
    true,
  );
}

export async function trackStripeCheckoutCreated(
  email: string,
  checkoutSessionId: string,
  properties?: Properties,
) {
  const checkoutProperties = {
    ...properties,
    checkoutSessionIdHash: getCheckoutSessionIdHash(checkoutSessionId),
  };
  const dedupeKey = `posthog:stripe-checkout-created:${checkoutSessionId}`;
  let firstCapture: string | null;

  try {
    firstCapture = await redis.set(dedupeKey, "1", {
      nx: true,
      ex: 172_800,
    });
  } catch (error) {
    logger.error("对 Stripe 结账创建事件去重失败", {
      error,
    });
    return posthogCaptureEvent(
      email,
      "Stripe checkout created",
      checkoutProperties,
    );
  }

  if (!firstCapture) return;

  const captured = await posthogCaptureEvent(
    email,
    "Stripe checkout created",
    checkoutProperties,
  );
  if (captured) return;

  try {
    await redis.del(dedupeKey);
  } catch (error) {
    logger.error("释放 Stripe 结账创建事件锁失败", {
      error,
    });
  }
}

export async function trackStripeCheckoutCompleted(
  email: string,
  properties?: Properties,
) {
  return posthogCaptureEvent(email, "Stripe checkout completed", properties);
}

export function getCheckoutSessionIdHash(checkoutSessionId: string) {
  return hash(checkoutSessionId);
}

export async function trackError({
  email,
  emailAccountId,
  errorType,
  type,
  url,
}: {
  email: string;
  emailAccountId: string;
  errorType: string;
  type: "api" | "action";
  url: string;
}) {
  return posthogCaptureEvent(email, errorType, {
    $set: { isError: true, type, url, emailAccountId },
  });
}

// biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
export async function trackTrialStarted(email: string, attributes: any) {
  return posthogCaptureEvent(email, "Premium trial started", {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: "on_trial",
    },
  });
}

// biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
export async function trackUpgradedToPremium(email: string, attributes: any) {
  return posthogCaptureEvent(email, "Upgraded to premium", {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: "active",
    },
  });
}

export async function trackSubscriptionTrialStarted(
  email: string,
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  attributes: any,
) {
  return posthogCaptureEvent(email, "Premium subscription trial started", {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: "on_trial",
    },
  });
}

export async function trackBillingTrialStarted(
  email: string,
  attributes: Properties,
) {
  return posthogCaptureEvent(email, "billing_trial_started", {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: "on_trial",
    },
  });
}

export async function trackBillingTrialConverted(
  email: string,
  attributes: Properties,
) {
  return posthogCaptureEvent(email, "billing_trial_converted", {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: "active",
    },
  });
}

export async function trackBillingCancellationInitiated(
  email: string,
  attributes: Properties,
) {
  return posthogCaptureEvent(
    email,
    "billing_cancellation_initiated",
    attributes,
  );
}

export async function trackSubscriptionCustom(
  email: string,
  status: string,
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  attributes: any,
) {
  const event = `Premium subscription ${status}`;

  return posthogCaptureEvent(email, event, {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: status,
    },
  });
}

export async function trackSubscriptionStatusChanged(
  email: string,
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  attributes: any,
) {
  return posthogCaptureEvent(email, "Subscription status changed", {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: attributes.status,
    },
  });
}

export async function trackSubscriptionCancelled(
  email: string,
  status: string,
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  attributes: any,
) {
  return posthogCaptureEvent(email, "Cancelled premium subscription", {
    ...attributes,
    $set: {
      premiumCancelled: true,
      premium: false,
      premiumStatus: status,
    },
  });
}

export async function trackSwitchedPremiumPlan(
  email: string,
  status: string,
  // biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
  attributes: any,
) {
  return posthogCaptureEvent(email, "Switched premium plan", {
    ...attributes,
    $set: {
      premium: true,
      premiumTier: "subscription",
      premiumStatus: status,
    },
  });
}

export async function trackPaymentSuccess({
  email,
  totalPaidUSD,
  lemonSqueezyId,
  lemonSqueezyType,
}: {
  email: string;
  totalPaidUSD: number | undefined;
  lemonSqueezyId: string;
  lemonSqueezyType: string;
}) {
  return posthogCaptureEvent(email, "Payment success", {
    totalPaidUSD,
    lemonSqueezyId,
    lemonSqueezyType,
  });
}

// biome-ignore lint/suspicious/noExplicitAny: existing loose external shape
export async function trackStripeEvent(email: string, data: any) {
  return posthogCaptureEvent(email, "Stripe event", data);
}

export async function trackUserDeletionRequested(userId: string) {
  return posthogCaptureEvent(
    "anonymous",
    "User deletion requested",
    { userId },
    false,
  );
}

export async function trackUserDeleted(userId: string) {
  return posthogCaptureEvent("anonymous", "User deleted", { userId }, false);
}

export const FIRST_TIME_EVENTS = {
  FIRST_AUTOMATED_RULE_RUN: "First automated rule run",
  FIRST_DRAFT_SENT: "First AI draft sent",
  FIRST_CHAT_MESSAGE: "First chat message",
} as const;

type FirstTimeEvent =
  (typeof FIRST_TIME_EVENTS)[keyof typeof FIRST_TIME_EVENTS];

const MAX_FIRST_TIME_EVENT_CACHE_SIZE = 1000;
const firedFirstTimeEvents = new Map<string, true>();

/**
 * 使用 User.email 作为 distinctId（而非 EmailAccount.email），
 * 以便事件与注册/账单事件关联到同一个 PostHog 用户。
 */
export async function trackFirstTimeEvent({
  emailAccountId,
  event,
  properties,
}: {
  emailAccountId: string;
  event: FirstTimeEvent;
  properties?: Record<string, unknown>;
}) {
  const key = `first-event:${emailAccountId}:${event}`;
  if (markFirstTimeEventCacheHit(key)) return;

  try {
    const firstTime = await redis.set(key, "1", { nx: true });
    addFirstTimeEventCacheKey(key);
    if (!firstTime) return;

    const emailAccount = await prisma.emailAccount.findUnique({
      where: { id: emailAccountId },
      select: { user: { select: { email: true } } },
    });
    const userEmail = emailAccount?.user?.email;
    if (!userEmail) return;

    await posthogCaptureEvent(userEmail, event, {
      emailAccountId,
      ...properties,
    });
  } catch (error) {
    logger.error("跟踪首次事件失败", { error, event });
  }
}

export async function trackSignupIntent(email: string, intent: string) {
  return posthogCaptureEvent(email, "Signup intent selected", {
    signupIntent: intent,
    $set: { signupIntent: intent },
  });
}

export async function trackOnboardingAnswer(
  email: string,
  answers: {
    surveyFeatures?: string[];
    surveyRole?: string;
    surveyGoal?: string;
    surveyCompanySize?: number;
    surveySource?: string;
    surveyImprovements?: string;
  },
) {
  return posthogCaptureEvent(email, "Onboarding answer submitted", {
    ...answers,
    $set: answers,
  });
}

export async function trackProductFeedback(email: string, feedback: string) {
  // 常规分析事件，因此即使问卷配额用尽，反馈仍可查询
  await posthogCaptureEvent(email, "Product feedback submitted", {
    feedback,
  });

  const surveyId = env.POSTHOG_FEEDBACK_SURVEY_ID;
  const questionId = env.POSTHOG_FEEDBACK_SURVEY_QUESTION_ID;
  if (!surveyId || !questionId) {
    logger.warn(
      "POSTHOG_FEEDBACK_SURVEY_ID 或 POSTHOG_FEEDBACK_SURVEY_QUESTION_ID 未设置",
    );
    return;
  }

  // Surveys API 事件 — 基于 ID 的响应键（PostHog 当前推荐做法）
  await posthogCaptureEvent(email, "survey sent", {
    $survey_id: surveyId,
    [`$survey_response_${questionId}`]: feedback,
    $survey_questions: [
      {
        id: questionId,
        question: "你的反馈是什么？",
      },
    ],
    $survey_completed: true,
  });
}

function getPosthogLlmEvalApprovedEmails() {
  return (
    env.POSTHOG_LLM_EVALS_APPROVED_EMAILS?.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean) ?? []
  );
}

function markFirstTimeEventCacheHit(key: string) {
  if (!firedFirstTimeEvents.has(key)) return false;

  firedFirstTimeEvents.delete(key);
  firedFirstTimeEvents.set(key, true);
  return true;
}

function addFirstTimeEventCacheKey(key: string) {
  firedFirstTimeEvents.delete(key);
  firedFirstTimeEvents.set(key, true);

  if (firedFirstTimeEvents.size <= MAX_FIRST_TIME_EVENT_CACHE_SIZE) return;

  const oldestKey = firedFirstTimeEvents.keys().next().value;
  if (oldestKey) firedFirstTimeEvents.delete(oldestKey);
}
