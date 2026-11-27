import { z } from "zod";

export const ssoRegistrationBody = z.object({
  organizationName: z.string().min(1, "组织名称为必填项"),
  organizationId: z.string().trim().min(1).optional(),
  providerId: z.string().min(1, "服务商 ID 为必填项"),
  domain: z.string().min(1, "域名为必填项"),
  idpMetadata: z.string().min(1, "IDP 元数据为必填项"),
});
export type SsoRegistrationBody = z.infer<typeof ssoRegistrationBody>;
