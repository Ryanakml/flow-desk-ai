export function workerState() {
  return { status: "idle" as const, claimsJobs: false };
}
