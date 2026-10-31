/**
 * 转义字符串值以安全用于 OData 过滤表达式。
 * OData 字符串字面量中的单引号必须通过加倍来转义。
 * 此外还处理可能导致过滤器问题的特殊字符。
 *
 * @param value The string value to escape
 * @returns The escaped string safe for OData filter interpolation
 *
 * @example
 * escapeODataString("O'Brien") // returns "O''Brien"
 * escapeODataString("test' or 1=1 --") // returns "test'' or 1=1 --"
 */
export function escapeODataString(value: string): string {
  if (typeof value !== "string") {
    return "";
  }
  // 将单引号替换为双写的单引号
  // 注意：等号和其他特殊字符在 OData 字符串字面量中是有效的
  return value.replace(/'/g, "''");
}
