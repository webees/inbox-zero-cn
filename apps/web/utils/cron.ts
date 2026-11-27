import { env } from "@/env";
import { secureCompare } from "@/utils/crypto-compare";
import { isValidInternalApiKey } from "@/utils/internal-api";
import type { RequestWithLogger } from "@/utils/middleware";

export function hasCronSecret(request: RequestWithLogger) {
  if (!env.CRON_SECRET) {
    request.logger.error("未设置 cron 密钥，未经授权的 cron 请求");
    return false;
  }

  const valid = isValidCronSecret(request);

  if (!valid)
    request.logger.error("未经授权的 cron 请求：", {
      authHeader: request.headers.get("authorization"),
    });

  return valid;
}

/**
 * 用于既可由 cron 访问、也可由内部队列转发访问的路由。cron 密钥会静默校验，
 * 因为队列请求只携带内部 API 密钥，而在校验该密钥之前就记录未授权
 * 会淹没错误日志。
 */
export function isAuthorizedCronOrInternalRequest(request: RequestWithLogger) {
  if (isValidCronSecret(request)) return true;
  return isValidInternalApiKey(request.headers, request.logger);
}

export async function hasPostCronSecret(request: RequestWithLogger) {
  if (!env.CRON_SECRET) {
    request.logger.error("未设置 cron 密钥，未经授权的 cron 请求");
    return false;
  }

  // 在消费请求体之前克隆请求
  const clonedRequest = request.clone();
  const body = await clonedRequest.json();
  const valid = secureCompare(body.CRON_SECRET, env.CRON_SECRET);

  if (!valid) request.logger.error("未经授权的 cron 请求：", { body });

  return valid;
}

export function getCronSecretHeader() {
  return new Headers({ authorization: `Bearer ${env.CRON_SECRET}` });
}

function isValidCronSecret(request: RequestWithLogger) {
  if (!env.CRON_SECRET) return false;
  return secureCompare(
    request.headers.get("authorization"),
    `Bearer ${env.CRON_SECRET}`,
  );
}
