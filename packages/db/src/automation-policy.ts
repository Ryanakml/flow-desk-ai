import type { DbClient } from "./auth.js";
import { recordAuditEvent } from "./audit.js";
import type { RoutingRule, RuleEvaluationTrace } from "@flowdesk/domain";

export interface DbAutomationPolicy {
  id: string;
  organizationId: string;
  version: number;
  status: "draft" | "published" | "archived";
  name: string;
  rules: RoutingRule[];
  metadata: Record<string, unknown>;
  createdByUserId: string | null;
  publishedByUserId: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePolicyDraftParams {
  organizationId: string;
  name?: string | undefined;
  rules?: RoutingRule[] | undefined;
  metadata?: Record<string, unknown> | undefined;
  userId?: string | null | undefined;
}

export interface UpdatePolicyDraftParams {
  organizationId: string;
  policyId: string;
  name?: string | undefined;
  rules?: RoutingRule[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface PublishPolicyParams {
  organizationId: string;
  policyId: string;
  userId?: string | null | undefined;
  notes?: string | undefined;
}

export interface RollbackPolicyParams {
  organizationId: string;
  targetPolicyId: string;
  userId?: string | null | undefined;
  notes?: string | undefined;
}

export interface DetailedRoutingLogRecord {
  id: string;
  organizationId: string;
  conversationId: string;
  matchedRuleId: string | null;
  matchedPolicyRuleId?: string | null | undefined;
  targetQueueId: string | null;
  targetTeamId: string | null;
  targetUserId: string | null;
  reason: string;
  routedAt: Date;
  policyId?: string | null | undefined;
  policyVersion?: number | null | undefined;
  decisionTrace?: RuleEvaluationTrace[] | undefined;
  inputsSnapshot?: Record<string, unknown> | undefined;
}

export interface CreateRoutingLogWithTraceParams {
  organizationId: string;
  conversationId: string;
  matchedRuleId?: string | null | undefined;
  matchedPolicyRuleId?: string | null | undefined;
  targetQueueId?: string | null | undefined;
  targetTeamId?: string | null | undefined;
  targetUserId?: string | null | undefined;
  reason: string;
  policyId?: string | null | undefined;
  policyVersion?: number | null | undefined;
  decisionTrace?: RuleEvaluationTrace[] | undefined;
  inputsSnapshot?: Record<string, unknown> | undefined;
}

interface AutomationPolicyDbRow {
  id: string;
  organization_id: string;
  version: number;
  status: "draft" | "published" | "archived";
  name: string;
  rules: RoutingRule[];
  metadata: Record<string, unknown>;
  created_by_user_id: string | null;
  published_by_user_id: string | null;
  published_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

interface DetailedRoutingLogDbRow {
  id: string;
  organization_id: string;
  conversation_id: string;
  matched_rule_id: string | null;
  matched_policy_rule_id?: string | null;
  target_queue_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  reason: string;
  routed_at: string | Date;
  policy_id: string | null;
  policy_version: number | null;
  decision_trace: RuleEvaluationTrace[] | null;
  inputs_snapshot: Record<string, unknown> | null;
}

function mapRowToPolicy(row: AutomationPolicyDbRow): DbAutomationPolicy {
  return {
    id: row.id,
    organizationId: row.organization_id,
    version: row.version,
    status: row.status,
    name: row.name,
    rules: Array.isArray(row.rules) ? row.rules : [],
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    createdByUserId: row.created_by_user_id ?? null,
    publishedByUserId: row.published_by_user_id ?? null,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  };
}

function mapRowToDetailedLog(row: DetailedRoutingLogDbRow): DetailedRoutingLogRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    matchedRuleId: row.matched_rule_id ?? null,
    matchedPolicyRuleId: row.matched_policy_rule_id ?? null,
    targetQueueId: row.target_queue_id ?? null,
    targetTeamId: row.target_team_id ?? null,
    targetUserId: row.target_user_id ?? null,
    reason: row.reason,
    routedAt: new Date(row.routed_at),
    policyId: row.policy_id ?? null,
    policyVersion: row.policy_version ?? null,
    decisionTrace: Array.isArray(row.decision_trace) ? row.decision_trace : [],
    inputsSnapshot:
      row.inputs_snapshot && typeof row.inputs_snapshot === "object" ? row.inputs_snapshot : {}
  };
}

/**
 * Creates a new draft automation policy version for the organization.
 */
export async function createPolicyDraft(
  db: DbClient,
  params: CreatePolicyDraftParams
): Promise<DbAutomationPolicy> {
  const versionResult = await db.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM flowdesk.automation_policies
     WHERE organization_id = $1`,
    [params.organizationId]
  );
  const nextVersion = Number(versionResult.rows[0]?.next_version ?? 1);

  const result = await db.query<AutomationPolicyDbRow>(
    `INSERT INTO flowdesk.automation_policies (
       organization_id, version, status, name, rules, metadata, created_by_user_id
     ) VALUES ($1, $2, 'draft', $3, $4, $5, $6)
     RETURNING *`,
    [
      params.organizationId,
      nextVersion,
      params.name ?? `Policy v${nextVersion}`,
      JSON.stringify(params.rules ?? []),
      JSON.stringify(params.metadata ?? {}),
      params.userId ?? null
    ]
  );

  const created = mapRowToPolicy(result.rows[0]!);

  await recordAuditEvent(db, {
    organizationId: params.organizationId,
    ...(params.userId ? { actorUserId: params.userId } : {}),
    action: "automation_policy:draft:created",
    targetType: "automation_policy",
    targetId: created.id,
    result: "allowed",
    metadata: { version: created.version, name: created.name }
  });

  return created;
}

/**
 * Updates an existing draft automation policy.
 * Only policies with status = 'draft' can be updated.
 */
export async function updatePolicyDraft(
  db: DbClient,
  params: UpdatePolicyDraftParams
): Promise<DbAutomationPolicy | null> {
  const check = await db.query<AutomationPolicyDbRow>(
    `SELECT * FROM flowdesk.automation_policies
     WHERE organization_id = $1 AND id = $2`,
    [params.organizationId, params.policyId]
  );
  const current = check.rows[0];
  if (!current) return null;
  if (current.status !== "draft") {
    throw new Error(
      `Cannot update policy with status '${current.status}'. Only drafts can be modified.`
    );
  }

  const result = await db.query<AutomationPolicyDbRow>(
    `UPDATE flowdesk.automation_policies
     SET name = COALESCE($3, name),
         rules = COALESCE($4, rules),
         metadata = COALESCE($5, metadata),
         updated_at = clock_timestamp()
     WHERE organization_id = $1 AND id = $2 AND status = 'draft'
     RETURNING *`,
    [
      params.organizationId,
      params.policyId,
      params.name ?? null,
      params.rules !== undefined ? JSON.stringify(params.rules) : null,
      params.metadata !== undefined ? JSON.stringify(params.metadata) : null
    ]
  );

  return result.rows[0] ? mapRowToPolicy(result.rows[0]) : null;
}

/**
 * Publishes a draft policy. Transactionally archives any currently active published policy
 * and activates the specified draft.
 */
export async function publishPolicyDraft(
  db: DbClient,
  params: PublishPolicyParams
): Promise<DbAutomationPolicy> {
  const check = await db.query<AutomationPolicyDbRow>(
    `SELECT * FROM flowdesk.automation_policies
     WHERE organization_id = $1 AND id = $2
     FOR UPDATE`,
    [params.organizationId, params.policyId]
  );
  const draft = check.rows[0];
  if (!draft) throw new Error("Policy not found");
  if (draft.status !== "draft") {
    throw new Error(
      `Cannot publish policy with status '${draft.status}'; must be in draft status.`
    );
  }

  // 1. Archive previous published policy
  await db.query(
    `UPDATE flowdesk.automation_policies
     SET status = 'archived', updated_at = clock_timestamp()
     WHERE organization_id = $1 AND status = 'published'`,
    [params.organizationId]
  );

  // 2. Activate draft to published
  const result = await db.query<AutomationPolicyDbRow>(
    `UPDATE flowdesk.automation_policies
     SET status = 'published',
         published_by_user_id = $3,
         published_at = clock_timestamp(),
         metadata = metadata || jsonb_build_object('publishNotes', $4::text),
         updated_at = clock_timestamp()
     WHERE organization_id = $1 AND id = $2
     RETURNING *`,
    [params.organizationId, params.policyId, params.userId ?? null, params.notes ?? ""]
  );

  const published = mapRowToPolicy(result.rows[0]!);

  await recordAuditEvent(db, {
    organizationId: params.organizationId,
    ...(params.userId ? { actorUserId: params.userId } : {}),
    action: "automation_policy:published",
    targetType: "automation_policy",
    targetId: published.id,
    result: "allowed",
    metadata: { version: published.version, notes: params.notes }
  });

  return published;
}

/**
 * Rollback to a previous policy version.
 * Creates a new published version with the rules from the target policy and audits the action.
 */
export async function rollbackPolicyVersion(
  db: DbClient,
  params: RollbackPolicyParams
): Promise<DbAutomationPolicy> {
  const targetCheck = await db.query<AutomationPolicyDbRow>(
    `SELECT * FROM flowdesk.automation_policies
     WHERE organization_id = $1 AND id = $2`,
    [params.organizationId, params.targetPolicyId]
  );
  const target = targetCheck.rows[0];
  if (!target) throw new Error("Target rollback policy not found");

  const versionResult = await db.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM flowdesk.automation_policies
     WHERE organization_id = $1`,
    [params.organizationId]
  );
  const nextVersion = Number(versionResult.rows[0]?.next_version ?? target.version + 1);

  // 1. Archive current published policy
  await db.query(
    `UPDATE flowdesk.automation_policies
     SET status = 'archived', updated_at = clock_timestamp()
     WHERE organization_id = $1 AND status = 'published'`,
    [params.organizationId]
  );

  // 2. Insert new published policy with target's rules
  const result = await db.query<AutomationPolicyDbRow>(
    `INSERT INTO flowdesk.automation_policies (
       organization_id, version, status, name, rules, metadata,
       created_by_user_id, published_by_user_id, published_at
     ) VALUES ($1, $2, 'published', $3, $4, $5, $6, $6, clock_timestamp())
     RETURNING *`,
    [
      params.organizationId,
      nextVersion,
      `${target.name} (Rollback to v${target.version})`,
      JSON.stringify(target.rules),
      JSON.stringify({
        ...(target.metadata ?? {}),
        rolledBackFromVersion: target.version,
        rollbackNotes: params.notes ?? ""
      }),
      params.userId ?? null
    ]
  );

  const restored = mapRowToPolicy(result.rows[0]!);

  await recordAuditEvent(db, {
    organizationId: params.organizationId,
    ...(params.userId ? { actorUserId: params.userId } : {}),
    action: "automation_policy:rollback",
    targetType: "automation_policy",
    targetId: restored.id,
    result: "allowed",
    metadata: {
      newVersion: restored.version,
      rolledBackFromVersion: target.version,
      notes: params.notes
    }
  });

  return restored;
}

/**
 * Gets the current active published automation policy for an organization.
 */
export async function getActivePublishedPolicy(
  db: DbClient,
  organizationId: string
): Promise<DbAutomationPolicy | null> {
  const result = await db.query<AutomationPolicyDbRow>(
    `SELECT * FROM flowdesk.automation_policies
     WHERE organization_id = $1 AND status = 'published'
     LIMIT 1`,
    [organizationId]
  );
  return result.rows[0] ? mapRowToPolicy(result.rows[0]) : null;
}

/**
 * Gets a policy by organization ID and policy ID.
 */
export async function getPolicyById(
  db: DbClient,
  organizationId: string,
  policyId: string
): Promise<DbAutomationPolicy | null> {
  const result = await db.query<AutomationPolicyDbRow>(
    `SELECT * FROM flowdesk.automation_policies
     WHERE organization_id = $1 AND id = $2`,
    [organizationId, policyId]
  );
  return result.rows[0] ? mapRowToPolicy(result.rows[0]) : null;
}

/**
 * Lists all policy versions for an organization, ordered by version descending.
 */
export async function listPolicyVersions(
  db: DbClient,
  organizationId: string
): Promise<DbAutomationPolicy[]> {
  const result = await db.query<AutomationPolicyDbRow>(
    `SELECT * FROM flowdesk.automation_policies
     WHERE organization_id = $1
     ORDER BY version DESC`,
    [organizationId]
  );
  return result.rows.map(mapRowToPolicy);
}

/**
 * Records a routing log entry with complete structured decision trace, version, and input snapshot.
 */
export async function recordRoutingLogWithTrace(
  db: DbClient,
  params: CreateRoutingLogWithTraceParams
): Promise<DetailedRoutingLogRecord> {
  const result = await db.query<DetailedRoutingLogDbRow>(
    `INSERT INTO flowdesk.routing_logs (
       organization_id, conversation_id, matched_rule_id, matched_policy_rule_id,
       target_queue_id, target_team_id, target_user_id, reason, policy_id, policy_version,
       decision_trace, inputs_snapshot
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      params.organizationId,
      params.conversationId,
      params.matchedRuleId ?? null,
      params.matchedPolicyRuleId ?? null,
      params.targetQueueId ?? null,
      params.targetTeamId ?? null,
      params.targetUserId ?? null,
      params.reason,
      params.policyId ?? null,
      params.policyVersion ?? null,
      JSON.stringify(params.decisionTrace ?? []),
      JSON.stringify(params.inputsSnapshot ?? {})
    ]
  );
  return mapRowToDetailedLog(result.rows[0]!);
}

/**
 * Lists routing logs with decision trace for a conversation.
 */
export async function listDetailedRoutingLogsForConversation(
  db: DbClient,
  organizationId: string,
  conversationId: string
): Promise<DetailedRoutingLogRecord[]> {
  const result = await db.query<DetailedRoutingLogDbRow>(
    `SELECT * FROM flowdesk.routing_logs
     WHERE organization_id = $1 AND conversation_id = $2
     ORDER BY routed_at DESC`,
    [organizationId, conversationId]
  );
  return result.rows.map(mapRowToDetailedLog);
}
