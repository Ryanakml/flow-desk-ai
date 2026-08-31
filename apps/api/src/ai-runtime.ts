import type { AiRuntimeConfig } from "@flowdesk/config";
import { createAiProviderRuntime, type AiProviderRuntime } from "@flowdesk/providers";

export type AiRuntime = AiProviderRuntime;

export function createAiRuntime(config: AiRuntimeConfig): AiRuntime | undefined {
  return createAiProviderRuntime(config);
}
