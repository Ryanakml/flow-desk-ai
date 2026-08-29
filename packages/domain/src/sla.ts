export interface BusinessHoursInterval {
  start: string;
  end: string;
}

export type BusinessHoursSchedule = Partial<
  Record<
    "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday",
    BusinessHoursInterval[]
  >
>;

export interface BusinessHoursPolicy {
  timezone: string;
  weeklySchedule: BusinessHoursSchedule;
  holidayDates?: readonly string[];
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
] as const;

function parseTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid business-hours time '${value}'.`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid business-hours time '${value}'.`);
  return { hour, minute };
}

function zonedParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}

function zonedLocalToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timezone: string
): Date {
  const localEpoch = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  let guess = localEpoch;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    guess = localEpoch - (represented - guess);
  }
  return new Date(guess);
}

/** Adds working seconds across timezone-aware daily intervals and holiday closures. */
export function calculateBusinessDeadline(
  startedAt: Date,
  durationSeconds: number,
  policy?: BusinessHoursPolicy | null
): Date {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error("SLA duration must be a positive integer number of seconds.");
  }
  if (!policy) return new Date(startedAt.getTime() + durationSeconds * 1000);

  let remaining = durationSeconds;
  const cursor = new Date(startedAt);
  const holidays = new Set(policy.holidayDates ?? []);
  const initialLocal = zonedParts(cursor, policy.timezone);

  for (let dayOffset = 0; dayOffset < 370; dayOffset += 1) {
    const calendar = new Date(
      Date.UTC(initialLocal.year, initialLocal.month - 1, initialLocal.day + dayOffset)
    );
    const year = calendar.getUTCFullYear();
    const month = calendar.getUTCMonth() + 1;
    const day = calendar.getUTCDate();
    const dateKey = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (holidays.has(dateKey)) continue;
    const intervals = policy.weeklySchedule[WEEKDAYS[calendar.getUTCDay()]!] ?? [];
    for (const interval of intervals) {
      const start = parseTime(interval.start);
      const end = parseTime(interval.end);
      const intervalStart = zonedLocalToUtc({ year, month, day, ...start }, policy.timezone);
      const intervalEnd = zonedLocalToUtc({ year, month, day, ...end }, policy.timezone);
      if (intervalEnd <= intervalStart)
        throw new Error("Business-hours intervals must end after start.");
      const effectiveStart = cursor > intervalStart ? cursor : intervalStart;
      if (effectiveStart >= intervalEnd) continue;
      const available = Math.floor((intervalEnd.getTime() - effectiveStart.getTime()) / 1000);
      if (remaining <= available) return new Date(effectiveStart.getTime() + remaining * 1000);
      remaining -= available;
    }
  }
  throw new Error("SLA deadline exceeds the supported business-hours horizon.");
}
