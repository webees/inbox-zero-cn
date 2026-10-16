import { z } from "zod";
import { SignupIntent } from "@/generated/prisma/enums";

export const saveOnboardingAnswersBody = z.object({
  surveyId: z.string().optional(),
  questions: z.any(),
  answers: z.any(),
});

export const stepWhoSchema = z.object({
  role: z.string().min(1, "请选择你的角色"),
});

export type StepWhoSchema = z.infer<typeof stepWhoSchema>;

export const saveOnboardingFeaturesSchema = z.object({
  features: z.array(z.string()),
});

export type SaveOnboardingFeaturesSchema = z.infer<
  typeof saveOnboardingFeaturesSchema
>;

export const saveSignupIntentSchema = z.object({
  intent: z.enum(SignupIntent),
});
