import { msg } from "@lingui/core/macro";
import type { MessageDescriptor } from "@lingui/core";
import type {
  ApiKeyExpiryValue,
  ApiKeyScopeValue,
} from "@/utils/api-key-scopes";

// The English metadata in utils/api-key-scopes also feeds the public OpenAPI
// spec, so the UI keeps its translatable copies here.
export const API_KEY_SCOPE_MESSAGES: Record<
  ApiKeyScopeValue,
  { label: MessageDescriptor; description: MessageDescriptor }
> = {
  STATS_READ: {
    label: msg`Read stats`,
    description: msg`读取此收件箱的汇总统计数据。`,
  },
  RULES_READ: {
    label: msg`读取规则`,
    description: msg`列出并查看此收件箱的自动化规则。`,
  },
  RULES_WRITE: {
    label: msg`写入规则`,
    description: msg`为此收件箱创建、更新和删除自动化规则。`,
  },
  SETTINGS_READ: {
    label: msg`读取设置`,
    description: msg`读取此收件箱的收件箱设置。`,
  },
  SETTINGS_WRITE: {
    label: msg`写入设置`,
    description: msg`更新此收件箱的收件箱设置。`,
  },
  ASSISTANT_CHAT: {
    label: msg`助手对话`,
    description: msg`为此收件箱启动助手对话会话。`,
  },
  SENDERS_UNSUBSCRIBE: {
    label: msg`退订发件人`,
    description: msg`为此收件箱退订发件人的邮件。`,
  },
};

export const API_KEY_EXPIRY_MESSAGES: Record<
  ApiKeyExpiryValue,
  MessageDescriptor
> = {
  "30": msg`30 天`,
  "90": msg`90 天`,
  "365": msg`1 年`,
  never: msg`永不过期`,
};
