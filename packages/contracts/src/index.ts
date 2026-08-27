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

export const SessionUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1)
});

export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionStateSchema = z.object({
  user: SessionUserSchema,
  expiresAt: z.string().datetime()
});

export type SessionState = z.infer<typeof SessionStateSchema>;

export const AuthAuthorizeUrlResponseSchema = z.object({
  authorizationUrl: z.string()
});

export type AuthAuthorizeUrlResponse = z.infer<typeof AuthAuthorizeUrlResponseSchema>;

export const AuthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export type AuthCallbackQuery = z.infer<typeof AuthCallbackQuerySchema>;

export const LogoutResponseSchema = z.object({
  status: z.literal("ok")
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
