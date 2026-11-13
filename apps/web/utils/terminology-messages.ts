import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { isMicrosoftProvider } from "@/utils/email/provider-types";

// utils/terminology 中的英文术语也会用于服务端文本（聊天机器人、
// 示例提示词），因此界面在此保留可翻译副本。
const OUTLOOK_TERMINOLOGY = {
  label: {
    singular: msg`类别`,
    plural: msg`类别`,
    singularCapitalized: msg`类别`,
    pluralCapitalized: msg`类别`,
    action: msg({ message: "分类", context: "action" }),
  },
} satisfies EmailTerminologyMessages;

const GMAIL_TERMINOLOGY = {
  label: {
    singular: msg`标签`,
    plural: msg`标签`,
    singularCapitalized: msg`标签`,
    pluralCapitalized: msg`标签`,
    action: msg({ message: "打标签", context: "action" }),
  },
} satisfies EmailTerminologyMessages;

export function getEmailTerminologyMessages(
  provider: string,
): EmailTerminologyMessages {
  return isMicrosoftProvider(provider)
    ? OUTLOOK_TERMINOLOGY
    : GMAIL_TERMINOLOGY;
}

type EmailTerminologyMessages = {
  label: {
    singular: MessageDescriptor;
    plural: MessageDescriptor;
    singularCapitalized: MessageDescriptor;
    pluralCapitalized: MessageDescriptor;
    action: MessageDescriptor;
  };
};
