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

export interface TagRecord {
  id: string;
  organizationId: string;
  name: string;
  color: string;
}

export interface ConversationNoteRecord {
  id: string;
  authorUserId: string;
  body: string;
  createdAt: Date;
}

export interface SavedFilterRecord {
  id: string;
  name: string;
  definition: Record<string, unknown>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
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

export async function listTags(db: DbClient, organizationId: string): Promise<TagRecord[]> {
  const result = await db.query<TagRecord>(
    `SELECT id, organization_id AS "organizationId", name, color
     FROM flowdesk.tags WHERE organization_id = $1 ORDER BY name, id`,
    [organizationId]
  );
  return result.rows;
}

export async function listConversationNotes(
  db: DbClient,
  organizationId: string,
  conversationId: string
): Promise<ConversationNoteRecord[]> {
  const result = await db.query<ConversationNoteRecord>(
    `SELECT id, author_user_id AS "authorUserId", body, created_at AS "createdAt"
     FROM flowdesk.conversation_notes
     WHERE organization_id = $1 AND conversation_id = $2
     ORDER BY created_at, id`,
    [organizationId, conversationId]
  );
  return result.rows;
}

export async function listConversationTags(
  db: DbClient,
  organizationId: string,
  conversationId: string
): Promise<TagRecord[]> {
  const result = await db.query<TagRecord>(
    `SELECT tag.id, tag.organization_id AS "organizationId", tag.name, tag.color
     FROM flowdesk.tags AS tag
     JOIN flowdesk.conversation_tags AS applied
       ON applied.organization_id = tag.organization_id AND applied.tag_id = tag.id
     WHERE applied.organization_id = $1 AND applied.conversation_id = $2
     ORDER BY tag.name, tag.id`,
    [organizationId, conversationId]
  );
  return result.rows;
}

export async function listSavedFilters(
  db: DbClient,
  organizationId: string,
  userId: string
): Promise<SavedFilterRecord[]> {
  const result = await db.query<SavedFilterRecord>(
    `SELECT id, name, definition, is_default AS "isDefault",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM flowdesk.saved_filters
     WHERE organization_id = $1 AND user_id = $2
     ORDER BY is_default DESC, name, id`,
    [organizationId, userId]
  );
  return result.rows;
}

export async function createSavedFilter(
  db: DbClient,
  input: {
    organizationId: string;
    userId: string;
    name: string;
    definition: Record<string, unknown>;
    isDefault: boolean;
  }
): Promise<SavedFilterRecord> {
  if (input.isDefault) {
    await db.query(
      `UPDATE flowdesk.saved_filters SET is_default = false, updated_at = clock_timestamp()
       WHERE organization_id = $1 AND user_id = $2 AND is_default`,
      [input.organizationId, input.userId]
    );
  }
  const result = await db.query<SavedFilterRecord>(
    `INSERT INTO flowdesk.saved_filters
       (organization_id, user_id, name, definition, is_default)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, user_id, name)
     DO UPDATE SET definition = EXCLUDED.definition, is_default = EXCLUDED.is_default,
                   updated_at = clock_timestamp()
     RETURNING id, name, definition, is_default AS "isDefault",
               created_at AS "createdAt", updated_at AS "updatedAt"`,
    [
      input.organizationId,
      input.userId,
      input.name,
      JSON.stringify(input.definition),
      input.isDefault
    ]
  );
  return result.rows[0]!;
}

export async function deleteSavedFilter(
  db: DbClient,
  organizationId: string,
  userId: string,
  filterId: string
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM flowdesk.saved_filters
     WHERE organization_id = $1 AND user_id = $2 AND id = $3`,
    [organizationId, userId, filterId]
  );
  return (result.rowCount ?? 0) > 0;
}
