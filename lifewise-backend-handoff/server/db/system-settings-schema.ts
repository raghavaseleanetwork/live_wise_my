import { z } from "zod";

export const SystemSettingsSchema = z.object({
  maintenanceMode: z.boolean().default(false),
  forceUpdate: z.boolean().default(false),
  minAppVersion: z.string().default("1.0.0"),
  supportEmail: z.string().email().default("support@lifewise.app"),
  updatedAt: z.date().default(() => new Date()),
});

export type SystemSettings = z.infer<typeof SystemSettingsSchema>;
