import { z } from "zod";
import { ObjectId } from "mongodb";

const PlanLimitsSchema = z.object({
  familyMembers: z.number().nullable(),
  reminders: z.number().nullable(),
  wiseAiPerMonth: z.number().nullable(),
  billScanPerMonth: z.number().nullable(),
  voiceReminderPerMonth: z.number().nullable(),
  bankPdfImportPerMonth: z.number().nullable(),
  noticeboardPostsPerMonth: z.number().nullable(),
});

const PlanFlagsSchema = z.object({
  pdfReports: z.boolean(),
  prioritySupport: z.boolean(),
  caregiverSharing: z.boolean(),
});

export const SubscriptionPlanSchema = z.object({
  name: z.string(),
  type: z.enum(["free", "starter", "family", "pro"]),
  price: z.number(),
  priceYearly: z.number().default(0),
  interval: z.enum(["month", "year"]),
  features: z.array(z.string()),
  limits: PlanLimitsSchema.optional(),
  flags: PlanFlagsSchema.optional(),
  productIdMonthly: z.string().nullable().default(null),
  productIdYearly: z.string().nullable().default(null),
  status: z.enum(["active", "inactive"]).default("active"),
  activeUsers: z.number().default(0),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const PromoCodeSchema = z.object({
  code: z.string().min(3),
  discountPercent: z.number().min(0).max(100),
  description: z.string().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
  redemptions: z.number().default(0),
  maxRedemptions: z.number().optional(),
  expiryDate: z.date().optional(),
  createdAt: z.date().default(() => new Date()),
});

export type SubscriptionPlan = z.infer<typeof SubscriptionPlanSchema> & { _id?: ObjectId };
export type PromoCode = z.infer<typeof PromoCodeSchema> & { _id?: ObjectId };
