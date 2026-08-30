import type { DbClient } from "./auth.js";
import type { RoutingCondition } from "@flowdesk/domain";

export interface DbRoutingRule {
  id: string;
  organizationId: string;
  name: string;
  priority: number;
  conditions: RoutingCondition;
  targetQueueId: string | null;
  targetTeamId: string | null;
  targetUserId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRoutingRuleParams {
  organizationId: string;
  name: string;
  priority?: number | undefined;
  conditions?: RoutingCondition | undefined;
  targetQueueId?: string | null | undefined;
  targetTeamId?: string | null | undefined;
  targetUserId?: string | null | undefined;
  isActive?: boolean | undefined;
}

export interface UpdateRoutingRuleParams {
  name?: string | undefined;
  priority?: number | undefined;
  conditions?: RoutingCondition | undefined;
  targetQueueId?: string | null | undefined;
  targetTeamId?: string | null | undefined;
  targetUserId?: string | null | undefined;
  isActive?: boolean | undefined;
}

export interface RoutingLogRecord {
  id: string;
  organizationId: string;
  conversationId: string;
  matchedRuleId: string | null;
  targetQueueId: string | null;
  targetTeamId: string | null;
  targetUserId: string | null;
  reason: string;
  routedAt: Date;
}

export interface CreateRoutingLogParams {
  organizationId: string;
  conversationId: string;
  matchedRuleId?: string | null;
  targetQueueId?: string | null;
  targetTeamId?: string | null;
  targetUserId?: string | null;
  reason: string;
}

interface RoutingRuleDbRow {
  id: string;
  organization_id: string;
  name: string;
  priority: number;
  conditions: RoutingCondition;
  target_queue_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

interface RoutingLogDbRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  matched_rule_id: string | null;
  target_queue_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  reason: string;
  routed_at: string | Date;
}

function mapRowToRoutingRule(row: RoutingRuleDbRow): DbRoutingRule {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    priority: row.priority,
    conditions: row.conditions ?? {},
    targetQueueId: row.target_queue_id ?? null,
    targetTeamId: row.target_team_id ?? null,
    targetUserId: row.target_user_id ?? null,
    isActive: row.is_active ?? true,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function mapRowToRoutingLog(row: RoutingLogDbRow): RoutingLogRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    matchedRuleId: row.matched_rule_id ?? null,
    targetQueueId: row.target_queue_id ?? null,
    targetTeamId: row.target_team_id ?? null,
    targetUserId: row.target_user_id ?? null,
    reason: row.reason,
    routedAt: new Date(row.routed_at)
  };
}

/**
 * M5-01: Automated Conversation Routing Rules & Logs Database Access Layer
 */
export async function createRoutingRule(
  db: DbClient,
  params: CreateRoutingRuleParams
): Promise<DbRoutingRule> {
  const result = await db.query<RoutingRuleDbRow>(
    `INSERT INTO flowdesk.routing_rules (
      organization_id, name, priority, conditions, target_queue_id, target_team_id, target_user_id, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *`,
    [
      params.organizationId,
      params.name,
      params.priority ?? 100,
      JSON.stringify(params.conditions ?? {}),
      params.targetQueueId ?? null,
      params.targetTeamId ?? null,
      params.targetUserId ?? null,
      params.isActive ?? true
    ]
  );
  if (!result.rows[0]) throw new Error("Failed to insert routing rule");
  return mapRowToRoutingRule(result.rows[0]);
}

export async function listRoutingRules(
  db: DbClient,
  organizationId: string
): Promise<DbRoutingRule[]> {
  const result = await db.query<RoutingRuleDbRow>(
    `SELECT * FROM flowdesk.routing_rules
     WHERE organization_id = $1
     ORDER BY priority ASC, created_at ASC`,
    [organizationId]
  );
  return result.rows.map(mapRowToRoutingRule);
}

export async function getRoutingRuleById(
  db: DbClient,
  organizationId: string,
  ruleId: string
): Promise<DbRoutingRule | null> {
  const result = await db.query<RoutingRuleDbRow>(
    `SELECT * FROM flowdesk.routing_rules
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, ruleId]
  );
  if (!result.rows[0]) return null;
  return mapRowToRoutingRule(result.rows[0]);
}

export async function updateRoutingRule(
  db: DbClient,
  organizationId: string,
  ruleId: string,
  params: UpdateRoutingRuleParams
): Promise<DbRoutingRule | null> {
  const existing = await getRoutingRuleById(db, organizationId, ruleId);
  if (!existing) return null;

  const name = params.name ?? existing.name;
  const priority = params.priority ?? existing.priority;
  const conditions = params.conditions ?? existing.conditions;
  const targetQueueId =
    params.targetQueueId !== undefined ? params.targetQueueId : existing.targetQueueId;
  const targetTeamId =
    params.targetTeamId !== undefined ? params.targetTeamId : existing.targetTeamId;
  const targetUserId =
    params.targetUserId !== undefined ? params.targetUserId : existing.targetUserId;
  const isActive = params.isActive !== undefined ? params.isActive : existing.isActive;

  const result = await db.query<RoutingRuleDbRow>(
    `UPDATE flowdesk.routing_rules
     SET name = $1, priority = $2, conditions = $3, target_queue_id = $4, target_team_id = $5, target_user_id = $6, is_active = $7, updated_at = clock_timestamp()
     WHERE organization_id = $8 AND id = $9
     RETURNING *`,
    [
      name,
      priority,
      JSON.stringify(conditions),
      targetQueueId,
      targetTeamId,
      targetUserId,
      isActive,
      organizationId,
      ruleId
    ]
  );

  if (!result.rows[0]) return null;
  return mapRowToRoutingRule(result.rows[0]);
}

export async function deleteRoutingRule(
  db: DbClient,
  organizationId: string,
  ruleId: string
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM flowdesk.routing_rules
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, ruleId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function recordRoutingLog(
  db: DbClient,
  params: CreateRoutingLogParams
): Promise<RoutingLogRecord> {
  const result = await db.query<RoutingLogDbRow>(
    `INSERT INTO flowdesk.routing_logs (
      organization_id, conversation_id, matched_rule_id, target_queue_id, target_team_id, target_user_id, reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *`,
    [
      params.organizationId,
      params.conversationId,
      params.matchedRuleId ?? null,
      params.targetQueueId ?? null,
      params.targetTeamId ?? null,
      params.targetUserId ?? null,
      params.reason
    ]
  );
  if (!result.rows[0]) throw new Error("Failed to insert routing log");
  return mapRowToRoutingLog(result.rows[0]);
}

export async function listRoutingLogsForConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string
): Promise<RoutingLogRecord[]> {
  const result = await db.query<RoutingLogDbRow>(
    `SELECT * FROM flowdesk.routing_logs
     WHERE organization_id = $1 AND conversation_id = $2
     ORDER BY routed_at DESC`,
    [organizationId, conversationId]
  );
  return result.rows.map(mapRowToRoutingLog);
}
