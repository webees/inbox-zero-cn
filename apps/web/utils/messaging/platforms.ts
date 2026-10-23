export type MessagingPlatform = "slack" | "teams" | "telegram";
export type MessagingProvider = "SLACK" | "TEAMS" | "TELEGRAM";

const PROVIDER_NAMES: Record<MessagingProvider, string> = {
  SLACK: "Slack",
  TEAMS: "Teams",
  TELEGRAM: "Telegram",
};

export function getMessagingProviderName(
  provider: MessagingProvider | MessagingPlatform,
): string {
  return PROVIDER_NAMES[provider.toUpperCase() as MessagingProvider];
}

export function getConnectAppLabel(
  providers: ReadonlyArray<MessagingProvider | MessagingPlatform>,
): string {
  const names = providers.map(getMessagingProviderName);
  if (names.length === 0) return "连接应用";
  if (names.length === 1) return `连接 ${names[0]}`;
  if (names.length === 2) return `连接 ${names[0]} 或 ${names[1]}`;
  return `连接 ${names.slice(0, -1).join("、")}，或 ${names.at(-1)}`;
}
