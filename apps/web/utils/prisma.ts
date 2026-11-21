import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";
import { encryptedTokens } from "@/utils/prisma-extensions";
import { auditPrismaQueries } from "@/utils/audit/prisma-extension";

declare global {
  var prisma: PrismaClient | undefined;
}

// 创建带扩展的 Prisma 客户端，但为类型兼容性将其转换回 PrismaClient
const _prisma =
  global.prisma ||
  (new PrismaClient({
    adapter: new PrismaPg({
      connectionString: env.PREVIEW_DATABASE_URL ?? env.DATABASE_URL,
    }),
  })
    .$extends(encryptedTokens)
    .$extends(auditPrismaQueries) as unknown as PrismaClient);

if (env.NODE_ENV === "development") global.prisma = _prisma;

export default _prisma;
