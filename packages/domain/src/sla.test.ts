import { describe, expect, it } from "vitest";
import { calculateBusinessDeadline } from "./sla.js";

const jakartaPolicy = {
  timezone: "Asia/Jakarta",
  weeklySchedule: {
    monday: [{ start: "09:00", end: "17:00" }],
    tuesday: [{ start: "09:00", end: "17:00" }]
  },
  holidayDates: []
};

describe("SLA business-hours deadline", () => {
  it("uses elapsed seconds when no business-hours policy is configured", () => {
    expect(calculateBusinessDeadline(new Date("2026-08-31T00:00:00Z"), 90).toISOString()).toBe(
      "2026-08-31T00:01:30.000Z"
    );
  });

  it("carries remaining time into the next business interval", () => {
    expect(
      calculateBusinessDeadline(
        new Date("2026-08-31T09:30:00Z"),
        2 * 60 * 60,
        jakartaPolicy
      ).toISOString()
    ).toBe("2026-09-01T03:30:00.000Z");
  });

  it("skips configured holidays and validates malformed policies", () => {
    expect(
      calculateBusinessDeadline(new Date("2026-08-31T01:00:00Z"), 60 * 60, {
        ...jakartaPolicy,
        holidayDates: ["2026-08-31"]
      }).toISOString()
    ).toBe("2026-09-01T03:00:00.000Z");
    expect(() =>
      calculateBusinessDeadline(new Date(), 60, {
        timezone: "UTC",
        weeklySchedule: { monday: [{ start: "17:00", end: "09:00" }] }
      })
    ).toThrow("end after start");
    expect(() => calculateBusinessDeadline(new Date(), 0)).toThrow("positive integer");
  });
});
