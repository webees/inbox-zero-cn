import Stripe from "stripe";
import { env } from "@/env";
import type { Logger } from "@/utils/logger";

let stripe: Stripe | null = null;

export const getStripe = () => {
  if (!env.STRIPE_SECRET_KEY) throw new Error("未设置 STRIPE_SECRET_KEY");
  if (!stripe) {
    const apiBaseUrl = getEmulatorApiBaseUrl();

    stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      appInfo: {
        name: "Inbox Zero",
        version: "1.0.0",
        url: "https://www.getinboxzero.com",
      },
      typescript: true,
      ...(apiBaseUrl && {
        host: apiBaseUrl.hostname,
        port: apiBaseUrl.port,
        protocol: apiBaseUrl.protocol === "https:" ? "https" : "http",
      }),
    });
  }
  return stripe;
};

/**
 * 解析本地 Stripe 模拟器的覆盖地址。此客户端会在每个请求中携带
 * STRIPE_SECRET_KEY，因此覆盖地址仅限于回环地址：配置错误或被注入的
 * 值绝不能把真实密钥发送到其他主机。浏览器测试套件的生产运行也会设置
 * NODE_ENV=production，因此不能靠环境来区分。
 */
function getEmulatorApiBaseUrl() {
  if (!env.STRIPE_API_BASE_URL) return null;

  const url = new URL(env.STRIPE_API_BASE_URL);
  const isLoopbackHost =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]";
  const isHttpProtocol = url.protocol === "http:" || url.protocol === "https:";

  if (!isLoopbackHost || !isHttpProtocol) {
    throw new Error(
      "STRIPE_API_BASE_URL must be an http or https loopback address",
    );
  }

  return url;
}

export const updateStripeSubscriptionItemQuantity = async ({
  subscriptionItemId,
  quantity,
  logger,
}: {
  subscriptionItemId: string;
  quantity: number;
  logger: Logger;
}) => {
  const quantityToSet = Math.max(1, quantity);

  logger.info("Updating Stripe subscription item quantity", {
    subscriptionItemId,
    quantityAttempted: quantityToSet,
  });

  if (!subscriptionItemId) {
    logger.error("Missing subscriptionItemId for updating quantity");
    throw new Error("Subscription Item ID is required to update quantity.");
  }

  try {
    const stripe = getStripe();

    // First, get the current subscription item to check if quantity has changed
    const currentItem =
      await stripe.subscriptionItems.retrieve(subscriptionItemId);

    if (currentItem.quantity === quantityToSet) {
      logger.info("Quantity unchanged, skipping update", {
        subscriptionItemId,
        currentQuantity: currentItem.quantity,
        requestedQuantity: quantityToSet,
      });
      return currentItem;
    }

    logger.info("Quantity changed, updating Stripe", {
      subscriptionItemId,
      currentQuantity: currentItem.quantity,
      newQuantity: quantityToSet,
    });

    const updatedItem = await stripe.subscriptionItems.update(
      subscriptionItemId,
      {
        quantity: quantityToSet,
      },
    );

    return updatedItem;
  } catch (error) {
    // Our stored item can outlive its subscription (e.g. cancelled in Stripe);
    // there is nothing left to bill seats against.
    if (
      error instanceof Stripe.errors.StripeInvalidRequestError &&
      error.code === "resource_missing"
    ) {
      logger.warn("Stripe subscription not found, skipping quantity update", {
        subscriptionItemId,
        param: error.param,
      });
      return null;
    }

    logger.error("Failed to update Stripe subscription item quantity", {
      subscriptionItemId,
      quantityAttempted: quantityToSet,
      error,
    });
    throw error;
  }
};
