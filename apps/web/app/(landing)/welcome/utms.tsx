import { after } from "next/server";
import prisma from "@/utils/prisma";
import { createScopedLogger } from "@/utils/logger";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import type { auth } from "@/utils/auth";

const logger = createScopedLogger("utms");

type UtmValues = {
  utmCampaign?: string;
  utmMedium?: string;
  utmSource?: string;
  utmTerm?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  gadCampaignId?: string;
  gadSource?: string;
  affiliate?: string;
  referralCode?: string;
};

export function registerUtmTracking({
  authPromise,
  cookieStore,
}: {
  authPromise: ReturnType<typeof auth>;
  cookieStore: ReadonlyRequestCookies;
}) {
  const utmValues = extractUtmValues(cookieStore);

  after(async () => {
    const user = await authPromise;
    if (!user?.user) return;
    await fetchUserAndStoreUtms(user.user.id, utmValues);
  });

  return utmValues;
}

// 在传给 after() 回调之前从 cookie 中提取 UTM 值
// 这是必需的，因为请求 API（cookies/headers）无法
// 在服务器组件的 after() 内使用——只能在服务器操作和路由处理器中使用
// 参见：https://nextjs.org/docs/app/api-reference/functions/after
export function extractUtmValues(cookies: ReadonlyRequestCookies): UtmValues {
  return {
    utmCampaign: decodeCookieValue(cookies.get("utm_campaign")?.value),
    utmMedium: decodeCookieValue(cookies.get("utm_medium")?.value),
    utmSource: decodeCookieValue(cookies.get("utm_source")?.value),
    utmTerm: decodeCookieValue(cookies.get("utm_term")?.value),
    gclid: decodeCookieValue(cookies.get("gclid")?.value),
    gbraid: decodeCookieValue(cookies.get("gbraid")?.value),
    wbraid: decodeCookieValue(cookies.get("wbraid")?.value),
    gadCampaignId: decodeCookieValue(cookies.get("gad_campaignid")?.value),
    gadSource: decodeCookieValue(cookies.get("gad_source")?.value),
    affiliate: decodeCookieValue(cookies.get("affiliate")?.value),
    referralCode: decodeCookieValue(cookies.get("referral_code")?.value),
  };
}

function decodeCookieValue(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function fetchUserAndStoreUtms(
  userId: string,
  utmValues: UtmValues,
) {
  if (!hasAttributionValue(utmValues)) return;

  const user = await prisma.user
    .findUnique({
      where: { id: userId },
      select: { utms: true },
    })
    .catch((error) => {
      logger.error("获取用户失败", { error, userId });
      return null;
    });

  if (user && !user.utms) {
    await storeUtms(userId, utmValues);
  }
}

function hasAttributionValue(utmValues: UtmValues) {
  return Object.values(utmValues).some(Boolean);
}

async function storeUtms(userId: string, utmValues: UtmValues) {
  logger.info("正在存储 utms", { userId });

  const utms = {
    utmCampaign: utmValues.utmCampaign,
    utmMedium: utmValues.utmMedium,
    utmSource: utmValues.utmSource,
    utmTerm: utmValues.utmTerm,
    gclid: utmValues.gclid,
    gbraid: utmValues.gbraid,
    wbraid: utmValues.wbraid,
    gadCampaignId: utmValues.gadCampaignId,
    gadSource: utmValues.gadSource,
    affiliate: utmValues.affiliate,
    referralCode: utmValues.referralCode,
  };

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { utms },
    });

    logger.info("已存储 utms", { utms, userId });
  } catch (error) {
    logger.error("存储 utms 失败", { error, userId });
  }
}
