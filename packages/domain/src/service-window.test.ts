import { describe, expect, it } from "vitest";
import {
  calculateServiceWindow,
  isWithinServiceWindow,
  SERVICE_WINDOW_DURATION_MS
} from "./service-window.js";

describe("WhatsApp 24-Hour Service Window Policy (TPL-ELIG-001)", () => {
  const baseNow = new Date("2026-08-29T12:00:00.000Z");

  it("evaluates closed window when lastInboundAt is null or undefined", () => {
    const resNull = calculateServiceWindow(null, baseNow);
    expect(resNull.isOpen).toBe(false);
    expect(resNull.expiresAt).toBeNull();
    expect(resNull.remainingSeconds).toBeNull();
    expect(isWithinServiceWindow(null, baseNow)).toBe(false);

    const resUndefined = calculateServiceWindow(undefined, baseNow);
    expect(resUndefined.isOpen).toBe(false);
    expect(resUndefined.expiresAt).toBeNull();
    expect(resUndefined.remainingSeconds).toBeNull();
    expect(isWithinServiceWindow(undefined, baseNow)).toBe(false);
  });

  it("evaluates closed window when lastInboundAt is an invalid date", () => {
    const res = calculateServiceWindow("not-a-date", baseNow);
    expect(res.isOpen).toBe(false);
    expect(res.expiresAt).toBeNull();
    expect(res.remainingSeconds).toBeNull();
  });

  it("evaluates open window right after customer inbound message", () => {
    const lastInbound = new Date(baseNow.getTime() - 5 * 60 * 1000); // 5 minutes ago
    const res = calculateServiceWindow(lastInbound, baseNow);

    expect(res.isOpen).toBe(true);
    expect(res.expiresAt).toEqual(new Date(lastInbound.getTime() + SERVICE_WINDOW_DURATION_MS));
    expect(res.remainingSeconds).toBe(24 * 3600 - 5 * 60);
    expect(isWithinServiceWindow(lastInbound, baseNow)).toBe(true);
  });

  it("evaluates open window at boundary: 1 second before 24h expiration", () => {
    // 23h 59m 59s ago
    const elapsedMs = (23 * 3600 + 59 * 60 + 59) * 1000;
    const lastInbound = new Date(baseNow.getTime() - elapsedMs);
    const res = calculateServiceWindow(lastInbound, baseNow);

    expect(res.isOpen).toBe(true);
    expect(res.remainingSeconds).toBe(1);
    expect(isWithinServiceWindow(lastInbound, baseNow)).toBe(true);
  });

  it("evaluates closed window at exact 24h expiration boundary", () => {
    // Exactly 24 hours ago
    const lastInbound = new Date(baseNow.getTime() - SERVICE_WINDOW_DURATION_MS);
    const res = calculateServiceWindow(lastInbound, baseNow);

    expect(res.isOpen).toBe(false);
    expect(res.remainingSeconds).toBe(0);
    expect(isWithinServiceWindow(lastInbound, baseNow)).toBe(false);
  });

  it("evaluates closed window after 24h expiration", () => {
    // 24 hours and 1 second ago
    const lastInbound = new Date(baseNow.getTime() - SERVICE_WINDOW_DURATION_MS - 1000);
    const res = calculateServiceWindow(lastInbound, baseNow);

    expect(res.isOpen).toBe(false);
    expect(res.remainingSeconds).toBe(0);
    expect(isWithinServiceWindow(lastInbound, baseNow)).toBe(false);
  });

  it("accepts ISO string format for lastInboundAt", () => {
    const lastInboundIso = new Date(baseNow.getTime() - 2 * 3600 * 1000).toISOString();
    const res = calculateServiceWindow(lastInboundIso, baseNow);

    expect(res.isOpen).toBe(true);
    expect(res.remainingSeconds).toBe(22 * 3600);
    expect(isWithinServiceWindow(lastInboundIso, baseNow)).toBe(true);
  });
});
