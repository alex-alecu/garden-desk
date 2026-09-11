import { z } from "zod";

export const CommandSummarySchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
    .max(64),
  description: z.string().min(1).max(256),
});

export type CommandSummary = z.infer<typeof CommandSummarySchema>;
