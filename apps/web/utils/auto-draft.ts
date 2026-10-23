import { env } from "@/env";
import type { Logger } from "@/utils/logger";

export function shouldSkipAutoDraft({
  logger,
  source,
}: {
  logger: Pick<Logger, "info">;
  source: string;
}) {
  if (!env.NEXT_PUBLIC_AUTO_DRAFT_DISABLED) return false;

  logger.info("跳过自动草稿，因为自动起草已禁用", {
    source,
  });
  return true;
}
