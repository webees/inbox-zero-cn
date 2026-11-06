import { z } from "zod";

export const API_KEY_SCOPES = [
  "STATS_READ",
  "RULES_READ",
  "RULES_WRITE",
  "SETTINGS_READ",
  "SETTINGS_WRITE",
  "ASSISTANT_CHAT",
  "SENDERS_UNSUBSCRIBE",
] as const;

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);
export type ApiKeyScopeValue = z.infer<typeof apiKeyScopeSchema>;

const API_KEY_SCOPE_METADATA: Record<
  ApiKeyScopeValue,
  {
    label: string;
    description: string;
  }
> = {
  STATS_READ: {
    label: "读取统计",
    description: "读取此收件箱的汇总统计信息。",
  },
  RULES_READ: {
    label: "读取规则",
    description: "列出并查看此收件箱的自动化规则。",
  },
  RULES_WRITE: {
    label: "写入规则",
    description: "为此收件箱创建、更新和删除自动化规则。",
  },
  SETTINGS_READ: {
    label: "读取设置",
    description: "读取此收件箱的设置。",
  },
  SETTINGS_WRITE: {
    label: "写入设置",
    description: "更新此收件箱的设置。",
  },
  ASSISTANT_CHAT: {
    label: "助手对话",
    description: "为此收件箱启动助手对话会话。",
  },
  SENDERS_UNSUBSCRIBE: {
    label: "退订发件人",
    description: "为此收件箱退订发件人。",
  },
};

export const API_KEY_SCOPE_OPTIONS: Array<{
  value: ApiKeyScopeValue;
  label: string;
  description: string;
}> = [
  {
    value: "RULES_READ",
    ...API_KEY_SCOPE_METADATA.RULES_READ,
  },
  {
    value: "RULES_WRITE",
    ...API_KEY_SCOPE_METADATA.RULES_WRITE,
  },
  {
    value: "STATS_READ",
    ...API_KEY_SCOPE_METADATA.STATS_READ,
  },
  {
    value: "SENDERS_UNSUBSCRIBE",
    ...API_KEY_SCOPE_METADATA.SENDERS_UNSUBSCRIBE,
  },
];

// SENDERS_UNSUBSCRIBE 可选择但不会默认勾选：退订会代表用户向第三方发起请求，
// 且无法撤销。
export const DEFAULT_API_KEY_SCOPES: ApiKeyScopeValue[] = [
  "RULES_READ",
  "RULES_WRITE",
  "STATS_READ",
];

export const API_KEY_EXPIRY_OPTIONS = [
  { value: "30", label: "30 天" },
  { value: "90", label: "90 天" },
  { value: "365", label: "1 年" },
  { value: "never", label: "永不过期" },
] as const;

export const apiKeyExpirySchema = z.enum(
  API_KEY_EXPIRY_OPTIONS.map((option) => option.value) as [
    (typeof API_KEY_EXPIRY_OPTIONS)[number]["value"],
    ...(typeof API_KEY_EXPIRY_OPTIONS)[number]["value"][],
  ],
);

export type ApiKeyExpiryValue = z.infer<typeof apiKeyExpirySchema>;

export function formatApiKeyScope(scope: ApiKeyScopeValue): string {
  return API_KEY_SCOPE_METADATA[scope]?.label ?? scope;
}
