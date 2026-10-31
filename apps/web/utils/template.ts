// 匹配 {{variable}} 这类模板变量的正则，包括多行
export const TEMPLATE_VARIABLE_PATTERN = "\\{\\{[\\s\\S]*?\\}\\}";

// 如果包含 "{{" 和 "}}" 则返回 true。
export const hasVariables = (text: string | undefined | null) =>
  text ? new RegExp(TEMPLATE_VARIABLE_PATTERN).test(text) : false;
