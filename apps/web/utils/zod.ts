import { z } from "zod";

// 解析布尔型环境变量："false" → false，其他任何值 → true，未设置 → 使用 .default()
export const booleanString = z.preprocess((val) => {
  if (!val) return;
  if (String(val).toLowerCase() === "false") return false;
  return true;
}, z.boolean().optional());

/**
 * 用于 Zod schema 的预处理器，优雅地处理表示布尔值的字符串输入
 * （例如 "true"、"yes"、"false"、"no"）。
 * 在校验之前将这些字符串转换为布尔值。
 * 对其他实际布尔值或其他类型原样透传，交由 Zod 的默认处理。
 */
export const preprocessBooleanLike = (val: unknown): unknown => {
  if (typeof val === "string") {
    const lowerVal = val.toLowerCase().trim();
    if (lowerVal === "true" || lowerVal === "yes") return true;
    if (lowerVal === "false" || lowerVal === "no") return false;
  }
  return val;
};
