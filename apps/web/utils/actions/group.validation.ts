import { z } from "zod";
import { GroupItemType } from "@/generated/prisma/enums";

export const createGroupBody = z.object({
  ruleId: z.string().min(1, "规则 ID 为必填项"),
});
export type CreateGroupBody = z.infer<typeof createGroupBody>;

export const addGroupItemBody = z.object({
  groupId: z.string(),
  type: z.enum([GroupItemType.FROM, GroupItemType.SUBJECT]),
  value: z.string().trim().min(1, "模式为必填项"),
  exclude: z.boolean().optional(),
});
export type AddGroupItemBody = z.infer<typeof addGroupItemBody>;
