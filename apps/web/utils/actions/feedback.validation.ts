import { z } from "zod";

export const submitFeedbackBody = z.object({
  feedback: z
    .string()
    .trim()
    .min(1, "反馈内容为必填项")
    .max(5000, "反馈内容不得超过 5000 个字符"),
});
export type SubmitFeedbackBody = z.infer<typeof submitFeedbackBody>;
