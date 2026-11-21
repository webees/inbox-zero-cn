import { env } from "@/env";
import { SafeError } from "@/utils/error";

export function assertCleanerApiEnabled() {
  if (process.env.VERCEL === "1") return;
  if (env.NEXT_PUBLIC_CLEANER_ENABLED) return;

  throw new SafeError("未启用清理功能", 404);
}
