/**
 * Gmail 标签校验
 *
 * 该模块对 Gmail 标签名称进行校验，以防止在通过 Gmail API
 * 创建标签时出错。
 *
 * 来源：
 * - https://developers.google.com/workspace/gmail/api/guides/labels
 * - Observed errors in production (e.g., reserved system labels)
 */

/**
 * Gmail 保留的系统标签
 *
 * 这些是 Gmail 内置的系统标签，不能用作自定义标签名称。
 * 尝试使用这些名称中的任何一个创建标签都会导致 "Invalid label name" 错误。
 *
 * 注意：Gmail 文档指出该列表“并非详尽”——可能还有此处
 * 未记录的保留标签。
 */
const GMAIL_RESERVED_LABELS = [
  // 标准系统标签（已记录）
  "INBOX",
  "SPAM",
  "TRASH",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "ALL_MAIL",
  "ALLMAIL",

  // 类别标签
  "PERSONAL",
  "SOCIAL",
  "PROMOTIONS",
  "UPDATES",
  "FORUMS",

  // 额外保留标签（未记录但保留）
  "TRAVEL",
  "FINANCE",
  "CHAT",
  "VOICEMAIL",
  "SCHEDULED",
  "MUTED",
] as const;

/**
 * Gmail 标签名称的最大长度
 */
const GMAIL_LABEL_MAX_LENGTH = 225;

/**
 * 标签校验的结果
 */
type LabelValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * 校验标签名称的基本要求
 *
 * @param name - 要校验的标签名称
 * @returns 一个包含 `valid` 布尔值和可选 `error` 消息的对象
 */
export function validateLabelNameBasic(name: string): LabelValidationResult {
  // 检查是否为空
  if (!name?.trim()) {
    return { valid: false, error: "标签名称不能为空" };
  }

  const trimmedName = name.trim();

  if (trimmedName.length > GMAIL_LABEL_MAX_LENGTH) {
    return {
      valid: false,
      error: `标签名称不能超过 ${GMAIL_LABEL_MAX_LENGTH} 个字符`,
    };
  }

  // 检查首尾空格
  if (name !== trimmedName) {
    return {
      valid: false,
      error: "标签名称不能有前导或尾随空格",
    };
  }

  // 检查连续双空格
  if (name.includes("  ")) {
    return { valid: false, error: "标签名称不能包含连续双空格" };
  }

  return { valid: true };
}

/**
 * 校验 Gmail 标签名称（Gmail 专属校验）
 * 除基本校验外，还包括对保留系统标签的检查
 *
 * @param name - 要校验的标签名称
 * @returns 一个包含 `valid` 布尔值和可选 `error` 消息的对象
 *
 * @example
 * ```ts
 * const result = validateGmailLabelName("Work");
 * if (!result.valid) {
 *   console.error(result.error);
 * }
 * ```
 */
export function validateGmailLabelName(name: string): LabelValidationResult {
  // 首先检查基本校验
  const basicValidation = validateLabelNameBasic(name);
  if (!basicValidation.valid) {
    return basicValidation;
  }

  // 检查保留系统标签（不区分大小写）
  const upperName = name.toUpperCase();
  if (GMAIL_RESERVED_LABELS.some((reserved) => upperName === reserved)) {
    return {
      valid: false,
      error: `"${name}" is a reserved Gmail system label and cannot be used`,
    };
  }

  return { valid: true };
}
