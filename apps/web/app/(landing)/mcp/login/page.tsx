import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { isMcpServerAvailable } from "@/utils/mcp/config";
import { buildLoginRedirectUrl, buildRedirectUrl } from "@/utils/redirect";

export default async function McpLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 在构建时禁用 MCP 开关的情况下，它仍可在运行时启用。
  await connection();
  if (!isMcpServerAvailable()) notFound();
  const params = await searchParams;
  // 在任何受支持的登录流程之后继续授权，而不强制进行第二次登录。
  const prompt =
    typeof params.prompt === "string"
      ? params.prompt
          .split(" ")
          .filter((value) => value !== "login")
          .join(" ")
      : undefined;
  redirect(
    buildLoginRedirectUrl(
      buildRedirectUrl("/api/auth/oauth2/authorize", {
        ...params,
        prompt: prompt || undefined,
      }),
    ),
  );
}
