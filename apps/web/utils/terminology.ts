import { isMicrosoftProvider } from "@/utils/email/provider-types";

interface EmailTerminology {
  label: {
    singular: string;
    plural: string;
    singularCapitalized: string;
    pluralCapitalized: string;
    action: string;
  };
}

/**
 * 根据邮箱服务商获取邮件术语
 * Gmail 使用 "labels"，而 Outlook 使用 "categories"
 */
export function getEmailTerminology(provider: string): EmailTerminology {
  const isOutlook = isMicrosoftProvider(provider);

  if (isOutlook) {
    return {
      label: {
        singular: "分类",
        plural: "分类",
        singularCapitalized: "分类",
        pluralCapitalized: "分类",
        action: "归类",
      },
    };
  }

  // 默认为 Gmail 术语
  return {
    label: {
      singular: "标签",
      plural: "标签",
      singularCapitalized: "标签",
      pluralCapitalized: "标签",
      action: "打标签",
    },
  };
}
