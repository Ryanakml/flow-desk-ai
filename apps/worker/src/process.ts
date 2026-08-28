export function workerState(active = true) {
  return { status: active ? ("running" as const) : ("idle" as const), claimsJobs: active };
}
