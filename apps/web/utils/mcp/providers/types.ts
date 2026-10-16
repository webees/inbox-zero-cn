// 服务商为我们托管第三方应用连接：它运行应用的 OAuth、
// 存储令牌，并将已连接的应用作为 MCP 服务器暴露。更换
// 某个应用背后的服务商只会改变该应用的注册表条目。
export type IntegrationProvider = {
  isConfigured(): boolean;
  getConnectUrl(
    args: ProviderAppArgs & { callbackUrl: string },
  ): Promise<string>;
  // Called when the user returns from the provider; keeps only the newest
  // 活跃连接，因此重新连接会替换旧账号
  completeConnection(args: ProviderAppArgs): Promise<boolean>;
  disconnect(args: ProviderAppArgs): Promise<void>;
  getMcpServer(
    args: ProviderAppArgs & { allowedTools: string[] },
  ): Promise<{ url: string; headers: Record<string, string> }>;
};

export type IntegrationProviderId = "composio";

type ProviderAppArgs = { app: string; emailAccountId: string };
