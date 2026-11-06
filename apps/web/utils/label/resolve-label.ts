import type { EmailProvider } from "@/utils/email/types";
import { createScopedLogger } from "@/utils/logger";
import { hasVariables } from "@/utils/template";

const logger = createScopedLogger("resolve-label");

/**
 * 为标签操作解析标签名称与 ID 的对应关系。
 * - 若只提供标签名称，则查找 labelId（未找到则创建）
 * - 若只提供 labelId，则查找标签名称
 * - 若两者都提供，则返回两者
 * - 若查找失败，则两者都返回 null
 * - Skips resolution for AI templates (strings containing {{...}})
 */
export async function resolveLabelNameAndId({
  emailProvider,
  label,
  labelId,
}: {
  emailProvider: EmailProvider;
  label?: string | null;
  labelId?: string | null;
}): Promise<{ label: string | null; labelId: string | null }> {
  // 若两者都有，直接返回
  if (label && labelId) {
    return { label, labelId };
  }

  // 若标签名称带有 AI 模板，则不解析它
  // 模板会在运行时由 AI 处理
  if (label && hasVariables(label)) {
    return { label, labelId: null };
  }

  // 若有标签名称，则查找 ID（未找到则创建）
  if (label) {
    try {
      const foundLabel = await emailProvider.getLabelByName(label);

      if (foundLabel) {
        return {
          label,
          labelId: foundLabel.id,
        };
      }

      logger.info("创建规则时未找到标签，正在创建", {
        labelName: label,
      });
      const createdLabel = await emailProvider.createLabel(label);
      return { label, labelId: createdLabel.id };
    } catch (error) {
      logger.error("解析标签出错", { labelName: label, error });
      return { label, labelId: null };
    }
  }

  // 若有 labelId，则查找名称
  if (labelId) {
    try {
      const foundLabel = await emailProvider.getLabelById(labelId);
      return {
        label: foundLabel?.name ?? null,
        labelId,
      };
    } catch {
      return { label: null, labelId };
    }
  }

  // 两者都未提供
  return { label: null, labelId: null };
}
