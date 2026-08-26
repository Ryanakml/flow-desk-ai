export interface TenantContext {
  organizationId: string;
  actorId: string;
  correlationId: string;
}

export function requireTenantContext(context: Partial<TenantContext>): TenantContext {
  if (!context.organizationId || !context.actorId || !context.correlationId) {
    throw new Error("Complete tenant context is required");
  }
  return context as TenantContext;
}
