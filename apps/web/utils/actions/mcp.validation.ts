import { z } from "zod";

export const disconnectMcpConnectionBody = z.object({
  connectionId: z.string(),
});
export type DisconnectMcpConnectionBody = z.infer<
  typeof disconnectMcpConnectionBody
>;

export const toggleMcpConnectionBody = z.object({
  connectionId: z.string(),
  isActive: z.boolean(),
});
export type ToggleMcpConnectionBody = z.infer<typeof toggleMcpConnectionBody>;

export const toggleMcpToolBody = z.object({
  toolId: z.string(),
  isEnabled: z.boolean(),
});
export type ToggleMcpToolBody = z.infer<typeof toggleMcpToolBody>;

export const createCustomMcpServerBody = z
  .object({
    displayName: z.string().trim().min(1, "名称为必填项").max(50),
    serverUrl: z.string().trim().url("请输入有效的 URL").max(2048),
    authType: z.enum(["oauth", "api-token", "none"]),
    apiKey: z.string().trim().max(4096).optional(),
  })
  .refine((data) => data.authType !== "api-token" || !!data.apiKey, {
    message: "API 密钥为必填项",
    path: ["apiKey"],
  });
export type CreateCustomMcpServerBody = z.infer<
  typeof createCustomMcpServerBody
>;

export const removeCustomMcpServerBody = z.object({
  name: z.string(),
});
