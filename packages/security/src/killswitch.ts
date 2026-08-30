/**
 * M5-03: Multi-Level Emergency Killswitches & Instant Propagation
 */

export interface KillswitchState {
  globalDisabled: boolean;
  tenantDisabled?: boolean | undefined;
  conversationPaused?: boolean | undefined;
}

let globalKillswitchState = false;

export function setGlobalKillswitch(disabled: boolean): void {
  globalKillswitchState = disabled;
}

export function getGlobalKillswitch(): boolean {
  return globalKillswitchState || process.env["GLOBAL_AUTO_SEND_DISABLED"] === "true";
}

export function isAutoSendKillswitchActive(state: KillswitchState): boolean {
  return state.globalDisabled || Boolean(state.tenantDisabled) || Boolean(state.conversationPaused);
}
