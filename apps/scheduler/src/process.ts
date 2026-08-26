export function schedulerState() {
  return { status: "idle" as const, schedulesJobs: false };
}
