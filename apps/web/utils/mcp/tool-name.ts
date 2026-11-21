// 当任意工具名称超出此范围时，模型服务商会拒绝整个请求
const VALID_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidMcpToolName(name: string) {
  return VALID_TOOL_NAME.test(name);
}
