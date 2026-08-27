export type ChannelStatus = "draft" | "connecting" | "active" | "degraded" | "disconnected";
export type ChannelType = "whatsapp";

export interface ChannelCredentials {
  accessToken: string;
  verifyToken: string;
  appSecret?: string | undefined;
}

const VALID_CHANNEL_TRANSITIONS: Record<ChannelStatus, readonly ChannelStatus[]> = {
  draft: ["connecting", "disconnected"],
  connecting: ["active", "draft", "disconnected", "degraded"],
  active: ["degraded", "disconnected", "connecting"],
  degraded: ["active", "disconnected", "connecting"],
  disconnected: ["connecting", "draft"]
};

export function canTransitionChannelStatus(current: ChannelStatus, target: ChannelStatus): boolean {
  if (current === target) return true;
  return VALID_CHANNEL_TRANSITIONS[current]?.includes(target) ?? false;
}

export function assertValidChannelStatusTransition(
  current: ChannelStatus,
  target: ChannelStatus
): void {
  if (!canTransitionChannelStatus(current, target)) {
    throw new Error(`Invalid channel status transition from '${current}' to '${target}'.`);
  }
}
