import type { DbClient } from "./auth.js";

export type QueueRoutingStrategy = "manual" | "round_robin" | "least_loaded";
export type QueueStatus = "active" | "paused" | "archived";

export interface TeamRecord {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  status: "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueRecord {
  id: string;
  organizationId: string;
  teamId: string | null;
  businessHoursPolicyId: string | null;
  slaPolicyId: string | null;
  name: string;
  slug: string;
  routingStrategy: QueueRoutingStrategy;
  status: QueueStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTeamInput {
  organizationId: string;
  name: string;
  slug: string;
}

export interface CreateQueueInput {
  organizationId: string;
  name: string;
  slug: string;
  teamId?: string | null;
  businessHoursPolicyId?: string | null;
  slaPolicyId?: string | null;
  routingStrategy?: QueueRoutingStrategy;
}

const queueProjection = `
  id, organization_id AS "organizationId", team_id AS "teamId",
  business_hours_policy_id AS "businessHoursPolicyId", sla_policy_id AS "slaPolicyId",
  name, slug, routing_strategy AS "routingStrategy", status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const aliasedQueueProjection = `
  queue.id, queue.organization_id AS "organizationId", queue.team_id AS "teamId",
  queue.business_hours_policy_id AS "businessHoursPolicyId",
  queue.sla_policy_id AS "slaPolicyId", queue.name, queue.slug,
  queue.routing_strategy AS "routingStrategy", queue.status,
  queue.created_at AS "createdAt", queue.updated_at AS "updatedAt"`;

export async function createTeam(db: DbClient, input: CreateTeamInput): Promise<TeamRecord> {
  const result = await db.query<TeamRecord>(
    `INSERT INTO flowdesk.teams (organization_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id, organization_id AS "organizationId", name, slug, status,
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [input.organizationId, input.name, input.slug]
  );
  return result.rows[0]!;
}

export async function addTeamMember(
  db: DbClient,
  input: { organizationId: string; teamId: string; userId: string; capacity?: number }
): Promise<void> {
  await db.query(
    `INSERT INTO flowdesk.team_memberships
       (organization_id, team_id, user_id, capacity, status, removed_at)
     VALUES ($1, $2, $3, $4, 'active', NULL)
     ON CONFLICT (organization_id, team_id, user_id)
     DO UPDATE SET capacity = EXCLUDED.capacity, status = 'active', removed_at = NULL,
                   updated_at = clock_timestamp()`,
    [input.organizationId, input.teamId, input.userId, input.capacity ?? 10]
  );
}

export async function createQueue(db: DbClient, input: CreateQueueInput): Promise<QueueRecord> {
  const result = await db.query<QueueRecord>(
    `INSERT INTO flowdesk.queues
       (organization_id, team_id, business_hours_policy_id, sla_policy_id,
        name, slug, routing_strategy)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${queueProjection}`,
    [
      input.organizationId,
      input.teamId ?? null,
      input.businessHoursPolicyId ?? null,
      input.slaPolicyId ?? null,
      input.name,
      input.slug,
      input.routingStrategy ?? "manual"
    ]
  );
  return result.rows[0]!;
}

export async function addQueueMember(
  db: DbClient,
  input: {
    organizationId: string;
    queueId: string;
    userId: string;
    role?: "agent" | "supervisor";
  }
): Promise<void> {
  await db.query(
    `INSERT INTO flowdesk.queue_memberships
       (organization_id, queue_id, user_id, role, status, removed_at)
     VALUES ($1, $2, $3, $4, 'active', NULL)
     ON CONFLICT (organization_id, queue_id, user_id)
     DO UPDATE SET role = EXCLUDED.role, status = 'active', removed_at = NULL,
                   updated_at = clock_timestamp()`,
    [input.organizationId, input.queueId, input.userId, input.role ?? "agent"]
  );
}

export async function removeQueueMember(
  db: DbClient,
  input: { organizationId: string; queueId: string; userId: string }
): Promise<boolean> {
  const result = await db.query(
    `UPDATE flowdesk.queue_memberships
     SET status = 'removed', removed_at = clock_timestamp(), updated_at = clock_timestamp()
     WHERE organization_id = $1 AND queue_id = $2 AND user_id = $3 AND status = 'active'`,
    [input.organizationId, input.queueId, input.userId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Returns only queues the active organization member can currently operate.
 * Organization-wide queue access is an explicit server-side RBAC decision.
 */
export async function listVisibleQueues(
  db: DbClient,
  input: { organizationId: string; userId: string; canManageAllQueues?: boolean }
): Promise<QueueRecord[]> {
  const result = await db.query<QueueRecord>(
    `SELECT ${aliasedQueueProjection}
     FROM flowdesk.queues AS queue
     JOIN flowdesk.memberships AS member
       ON member.organization_id = queue.organization_id
      AND member.user_id = $2
      AND member.status = 'active'
     WHERE queue.organization_id = $1
       AND queue.status != 'archived'
       AND (
         $3::boolean
         OR EXISTS (
           SELECT 1 FROM flowdesk.queue_memberships AS queue_member
           WHERE queue_member.organization_id = queue.organization_id
             AND queue_member.queue_id = queue.id
             AND queue_member.user_id = $2
             AND queue_member.status = 'active'
         )
       )
     ORDER BY queue.name, queue.id`,
    [input.organizationId, input.userId, input.canManageAllQueues ?? false]
  );
  return result.rows;
}
