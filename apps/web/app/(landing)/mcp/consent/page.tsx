import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth, betterAuthConfig } from "@/utils/auth";
import { getMcpServerAccess } from "@/utils/mcp/access";
import { isMcpServerAvailable, MCP_SCOPES } from "@/utils/mcp/config";
import { buildLoginRedirectUrl, buildRedirectUrl } from "@/utils/redirect";
import { McpConsent } from "@/app/(landing)/mcp/consent/McpConsent";

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 在构建时禁用 MCP 开关的情况下，它仍可在运行时启用。
  await connection();
  if (!isMcpServerAvailable()) notFound();
  const params = await searchParams;
  const session = await auth();
  if (!session?.user)
    redirect(buildLoginRedirectUrl(buildRedirectUrl("/mcp/consent", params)));
  if (
    typeof params.client_id !== "string" ||
    typeof params.scope !== "string" ||
    typeof params.sig !== "string"
  )
    notFound();
  const scopes = params.scope.split(" ").filter(Boolean);
  if (scopes.some((scope) => !MCP_SCOPES.some((allowed) => allowed === scope)))
    notFound();
  // 每个授权端点都会拒绝邮箱验证码会话，因此此页面
  // 无法为其加载客户端或记录决定。
  if (session.session.emailOtp === true)
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-12">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>使用 Google 或 Microsoft 登录</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              邮箱验证码登录无法授权应用。
            </p>
            <Link
              href="/settings"
              className="text-sm text-muted-foreground underline"
            >
              设置
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  const requestHeaders = await headers();
  const [client, access] = await Promise.all([
    betterAuthConfig.api.getOAuthClientPublic({
      headers: requestHeaders,
      query: { client_id: params.client_id },
    }),
    getMcpServerAccess(session.user.id),
  ]);
  return (
    <McpConsent
      clientName={client.client_name || "MCP 应用"}
      scopes={scopes}
      enabled={access.enabled}
    />
  );
}
