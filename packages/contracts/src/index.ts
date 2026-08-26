import { z } from "zod";

export const BuildInfoSchema = z.object({
  service: z.string(),
  version: z.string(),
  gitSha: z.string(),
  environment: z.enum(["local", "preview", "staging", "production"])
});

export type BuildInfo = z.infer<typeof BuildInfoSchema>;

export const ProblemSchema = z.object({
  type: z.url(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  detail: z.string(),
  requestId: z.string()
});

export type Problem = z.infer<typeof ProblemSchema>;
