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
 * 解析本地 Stripe 模拟器覆盖配置。该客户端会在每个请求中携带
 * STRIPE_SECRET_KEY，因此覆盖配置被限制为回环地址：配置错误或被注入的值
 * 绝不能把线上密钥发送到其他主机。浏览器测试套件的生产运行也会设置
 * NODE_ENV=production，因此不能以环境作为这里的区分依据。
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
    logger.error("Failed to update Stripe subscription item quantity", {
      subscriptionItemId,
      quantityAttempted: quantityToSet,
      error,
    });
    throw error;
  }
};
