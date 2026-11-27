import { sso } from "@better-auth/sso";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import { isAdmin } from "@/utils/admin";

const managementPaths = new Set([
  "/sso/register",
  "/sso/providers",
  "/sso/get-provider",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
]);

export function adminSso(options: Parameters<typeof sso>[0]) {
  // SSO 声明省略了其运行时钩子；通过插件契约保留它们。
  const plugin: ReturnType<typeof sso> & Pick<BetterAuthPlugin, "hooks"> =
    sso(options);
  return {
    ...plugin,
    hooks: {
      ...plugin.hooks,
      before: [
        {
          matcher: (context: { path?: string }) =>
            managementPaths.has(context.path ?? ""),
          // 与路由中间件不同，插件钩子会同时保护 HTTP 和服务器 API 调用。
          handler: createAuthMiddleware(async (context) => {
            const session = await getSessionFromCtx(context);
            if (!session?.user) throw new APIError("UNAUTHORIZED");
            if (!isAdmin({ email: session.user.email })) {
              throw new APIError("FORBIDDEN");
            }
          }),
        },
        ...(plugin.hooks?.before ?? []),
      ],
    },
  };
}
