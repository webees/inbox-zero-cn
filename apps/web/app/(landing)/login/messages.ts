import { BRAND_NAME, SUPPORT_EMAIL } from "@/utils/branding";

export function getRequiresReconsentDescription(options?: {
  includeSupportText?: boolean;
}) {
  const description = `请重新登录并批准每一项所请求的权限。如果你的 Microsoft 365 组织需要管理员审批，请先让你的管理员批准 ${BRAND_NAME}。`;

  if (!options?.includeSupportText) return description;

  return `${description} 如果此错误持续存在，请通过 ${SUPPORT_EMAIL} 联系支持`;
}

export function getEmailAlreadyLinkedDescription(options?: {
  includeSupportText?: boolean;
}) {
  const description = `此邮箱已连接到另一个 ${BRAND_NAME} 账号。要使用它，请用拥有此邮箱的原始账号登录，然后如需重新连接该邮箱，请从账号页面操作。如果你无法访问该账号，或认为这是重复账号，请联系支持，以便我们帮助你恢复或合并账号。`;

  if (!options?.includeSupportText) return description;

  return `${description} 你可以使用支持聊天，或通过 ${SUPPORT_EMAIL} 给我们发邮件。`;
}
