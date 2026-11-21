/**
 * Staging 是一个面向生产的 Vercel 项目，因此仅凭 VERCEL_ENV 无法
 * 将其排除。自托管安装仍可被索引。
 */
export function isIndexingAllowed(
  baseUrl: string,
  vercelEnv = process.env.VERCEL_ENV,
): boolean {
  if (vercelEnv === "preview") return false;

  try {
    return !new URL(baseUrl).hostname.toLowerCase().startsWith("staging.");
  } catch {
    return true;
  }
}
