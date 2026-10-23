"use server";

import { createScopedLogger } from "@/utils/logger";
import { sleep } from "@/utils/sleep";

const logger = createScopedLogger("testAction");

// server-action-export: allow - 有意暴露一个非变更性的测试操作。
export async function testAction() {
  logger.info("testAction 已开始");

  await sleep(5000);

  logger.info("testAction 已完成");

  return "操作已完成";
}
