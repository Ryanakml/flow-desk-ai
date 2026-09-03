import { Router, type Request, type Response } from "express";
import {
  type Problem,
  CreateRoutingRuleRequestSchema,
  UpdateRoutingRuleRequestSchema,
  CreateAutomationPolicyDraftSchema,
  UpdateAutomationPolicyDraftSchema,
  PublishAutomationPolicySchema,
  SimulatePolicyRequestSchema,
  type RoutingRuleResponse,
  type RoutingLogResponse,
  type AutomationPolicyResponse,
  type SimulatePolicyResponse
} from "@flowdesk/contracts";
import {
  createRoutingRule,
  listRoutingRules,
  getRoutingRuleById,
  updateRoutingRule,
  deleteRoutingRule,
  createPolicyDraft,
  updatePolicyDraft,
  publishPolicyDraft,
  rollbackPolicyVersion,
  getActivePublishedPolicy,
  getPolicyById,
  listPolicyVersions,
  listDetailedRoutingLogsForConversation,
  type DbClient,
  type DbRoutingRule,
  type RoutingLogRecord,
  type DbAutomationPolicy,
  type DetailedRoutingLogRecord
} from "@flowdesk/db";
import {
  detectPolicyConflicts,
  simulatePolicyEvaluation,
  type RoutingRule
} from "@flowdesk/domain";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface RoutingRouterOptions {
  db: DbClient;
}

function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const val = params[key];
  if (Array.isArray(val)) return val[0] ?? "";
  return typeof val === "string" ? val : "";
}

function sendProblem(
  response: Response,
  status: number,
  code: string,
  title: string,
  detail: string
) {
  const problem: Problem = {
    type: `https://flowdesk.dev/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    code,
    detail,
    requestId: response.getHeader("x-request-id")?.toString() ?? "unknown"
  };
  return response.status(status).type("application/problem+json").json(problem);
}

function formatRuleResponse(rule: DbRoutingRule): RoutingRuleResponse {
  return {
    ...rule,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString()
  };
}

function formatLogResponse(log: RoutingLogRecord | DetailedRoutingLogRecord): RoutingLogResponse {
  const detailed = log as DetailedRoutingLogRecord;
  return {
    id: log.id,
    organizationId: log.organizationId,
    conversationId: log.conversationId,
    matchedRuleId: log.matchedRuleId,
    targetQueueId: log.targetQueueId,
    targetTeamId: log.targetTeamId,
    targetUserId: log.targetUserId,
    reason: log.reason,
    routedAt: log.routedAt.toISOString(),
    policyId: detailed.policyId ?? null,
    policyVersion: detailed.policyVersion ?? null,
    decisionTrace: detailed.decisionTrace
      ? detailed.decisionTrace.map((t) => ({
          ruleId: t.ruleId,
          ruleName: t.ruleName,
          priority: t.priority,
          matched: t.matched,
          reason: t.reason,
          conditionsEvaluated: Object.fromEntries(
            Object.entries(t.conditionsEvaluated).filter(([, v]) => v !== undefined)
          ) as Record<
            string,
            { passed: boolean; expected: unknown; actual: unknown; reason?: string }
          >
        }))
      : undefined,
    inputsSnapshot: detailed.inputsSnapshot
  };
}

function formatPolicyResponse(policy: DbAutomationPolicy): AutomationPolicyResponse {
  return {
    id: policy.id,
    organizationId: policy.organizationId,
    version: policy.version,
    status: policy.status,
    name: policy.name,
    rules: policy.rules.map((r) => ({
      id: r.id,
      name: r.name,
      priority: r.priority,
      conditions: r.conditions ?? {},
      targetQueueId: r.targetQueueId ?? null,
      targetTeamId: r.targetTeamId ?? null,
      targetUserId: r.targetUserId ?? null,
      action: r.action ?? "route",
      isActive: r.isActive ?? true
    })),
    metadata: policy.metadata ?? {},
    createdByUserId: policy.createdByUserId ?? null,
    publishedByUserId: policy.publishedByUserId ?? null,
    publishedAt: policy.publishedAt ? policy.publishedAt.toISOString() : null,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString()
  };
}

export function createRoutingRouter(options: RoutingRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);
  const requireViewPermission = createRequireOrgPermissionMiddleware(
    options.db,
    "conversation:read"
  );
  const requireManagePermission = createRequireOrgPermissionMiddleware(
    options.db,
    "automation:publish"
  );

  // ==========================================
  // M5 #180: Automation Policy Versioning & Simulator API
  // ==========================================

  // GET /api/v1/organizations/:orgId/routing/policies
  router.get(
    "/policies",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const policies = await listPolicyVersions(options.db, orgId);
        return response.status(200).json(policies.map(formatPolicyResponse));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to fetch policy versions"
        );
      }
    }
  );

  // GET /api/v1/organizations/:orgId/routing/policies/active
  router.get(
    "/policies/active",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const policy = await getActivePublishedPolicy(options.db, orgId);
        if (!policy) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            "No active published automation policy found"
          );
        }
        return response.status(200).json(formatPolicyResponse(policy));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to fetch active policy"
        );
      }
    }
  );

  // GET /api/v1/organizations/:orgId/routing/policies/:policyId
  router.get(
    "/policies/:policyId",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const policyId = getParam(request.params, "policyId");
        const policy = await getPolicyById(options.db, orgId, policyId);
        if (!policy) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            `Policy ${policyId} not found`
          );
        }
        return response.status(200).json(formatPolicyResponse(policy));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to fetch policy"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/routing/policies/draft
  router.post(
    "/policies/draft",
    requireAuth,
    requireManagePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const parseResult = CreateAutomationPolicyDraftSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "INVALID_REQUEST",
            "Validation error",
            parseResult.error.issues[0]?.message || "Invalid policy draft body"
          );
        }

        const actorUserId = request.user?.id ?? null;
        const draft = await createPolicyDraft(options.db, {
          organizationId: orgId,
          name: parseResult.data.name,
          rules: parseResult.data.rules as RoutingRule[],
          metadata: parseResult.data.metadata,
          userId: actorUserId
        });

        return response.status(201).json(formatPolicyResponse(draft));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to create policy draft"
        );
      }
    }
  );

  // PUT /api/v1/organizations/:orgId/routing/policies/draft/:policyId
  router.put(
    "/policies/draft/:policyId",
    requireAuth,
    requireManagePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const policyId = getParam(request.params, "policyId");
        const parseResult = UpdateAutomationPolicyDraftSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "INVALID_REQUEST",
            "Validation error",
            parseResult.error.issues[0]?.message || "Invalid policy draft update body"
          );
        }

        const updated = await updatePolicyDraft(options.db, {
          organizationId: orgId,
          policyId,
          name: parseResult.data.name,
          rules: parseResult.data.rules as RoutingRule[] | undefined,
          metadata: parseResult.data.metadata
        });

        if (!updated) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            `Policy draft ${policyId} not found`
          );
        }

        return response.status(200).json(formatPolicyResponse(updated));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to update policy draft"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/routing/policies/:policyId/publish
  router.post(
    "/policies/:policyId/publish",
    requireAuth,
    requireManagePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const policyId = getParam(request.params, "policyId");
        const parseResult = PublishAutomationPolicySchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "INVALID_REQUEST",
            "Validation error",
            parseResult.error.issues[0]?.message || "Invalid publish body"
          );
        }

        const draft = await getPolicyById(options.db, orgId, policyId);
        if (!draft) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            `Policy draft ${policyId} not found`
          );
        }

        const conflicts = detectPolicyConflicts(draft.rules);
        const fatalConflicts = conflicts.filter((c) => c.severity === "error");
        if (fatalConflicts.length > 0) {
          return sendProblem(
            response,
            409,
            "POLICY_CONFLICT",
            "Policy Conflict",
            `Cannot publish policy with fatal conflicts: ${fatalConflicts.map((c) => c.message).join("; ")}`
          );
        }

        const actorUserId = request.user?.id ?? null;
        const published = await publishPolicyDraft(options.db, {
          organizationId: orgId,
          policyId,
          userId: actorUserId,
          notes: parseResult.data.notes
        });

        return response.status(200).json(formatPolicyResponse(published));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to publish policy"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/routing/policies/:policyId/rollback
  router.post(
    "/policies/:policyId/rollback",
    requireAuth,
    requireManagePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const policyId = getParam(request.params, "policyId");
        const actorUserId = request.user?.id ?? null;

        const reqBody = (request.body && typeof request.body === "object" ? request.body : {}) as {
          notes?: unknown;
        };
        const notes = typeof reqBody.notes === "string" ? reqBody.notes : undefined;

        const restored = await rollbackPolicyVersion(options.db, {
          organizationId: orgId,
          targetPolicyId: policyId,
          userId: actorUserId,
          notes
        });

        return response.status(200).json(formatPolicyResponse(restored));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to rollback policy"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/routing/policies/simulate
  router.post(
    "/policies/simulate",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const parseResult = SimulatePolicyRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "INVALID_REQUEST",
            "Validation error",
            parseResult.error.issues[0]?.message || "Invalid simulation request"
          );
        }

        let rulesToEvaluate: RoutingRule[] = [];
        let policyVersion: number | undefined = parseResult.data.policyVersion;

        if (parseResult.data.rules && parseResult.data.rules.length > 0) {
          rulesToEvaluate = parseResult.data.rules as RoutingRule[];
        } else if (policyVersion !== undefined) {
          const versions = await listPolicyVersions(options.db, orgId);
          const matched = versions.find((v) => v.version === policyVersion);
          if (matched) {
            rulesToEvaluate = matched.rules;
          }
        } else {
          const activePolicy = await getActivePublishedPolicy(options.db, orgId);
          if (activePolicy) {
            rulesToEvaluate = activePolicy.rules;
            policyVersion = activePolicy.version;
          } else {
            const legacyRules = await listRoutingRules(options.db, orgId);
            rulesToEvaluate = legacyRules.map((r) => ({
              id: r.id,
              organizationId: r.organizationId,
              name: r.name,
              priority: r.priority,
              conditions: r.conditions,
              targetQueueId: r.targetQueueId,
              targetTeamId: r.targetTeamId,
              targetUserId: r.targetUserId,
              isActive: r.isActive
            }));
          }
        }

        const simulation = simulatePolicyEvaluation({
          rules: rulesToEvaluate,
          context: parseResult.data.context,
          policyVersion
        });

        const simulationResult: SimulatePolicyResponse = {
          matchedRule: simulation.matchedRule
            ? {
                id: simulation.matchedRule.id,
                name: simulation.matchedRule.name,
                priority: simulation.matchedRule.priority,
                conditions: simulation.matchedRule.conditions ?? {},
                targetQueueId: simulation.matchedRule.targetQueueId ?? null,
                targetTeamId: simulation.matchedRule.targetTeamId ?? null,
                targetUserId: simulation.matchedRule.targetUserId ?? null,
                action: simulation.matchedRule.action ?? "route",
                isActive: simulation.matchedRule.isActive ?? true
              }
            : null,
          targetQueueId: simulation.targetQueueId,
          targetTeamId: simulation.targetTeamId,
          targetUserId: simulation.targetUserId,
          action: simulation.action,
          reason: simulation.reason,
          decisionTrace: simulation.decisionTrace.map((t) => ({
            ...t,
            conditionsEvaluated: t.conditionsEvaluated as Record<
              string,
              { passed: boolean; expected: unknown; actual: unknown; reason?: string }
            >
          })),
          conflicts: simulation.conflicts,
          policyVersion: simulation.policyVersion
        };

        return response.status(200).json(simulationResult);
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to simulate policy"
        );
      }
    }
  );

  // ==========================================
  // Legacy / Direct Routing Rules & Logs Endpoints
  // ==========================================

  // GET /api/v1/organizations/:orgId/routing/rules
  router.get(
    "/rules",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const rules = await listRoutingRules(options.db, orgId);
        return response.status(200).json(rules.map(formatRuleResponse));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to fetch routing rules"
        );
      }
    }
  );

  // POST /api/v1/organizations/:orgId/routing/rules
  router.post(
    "/rules",
    requireAuth,
    requireManagePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const parseResult = CreateRoutingRuleRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "INVALID_REQUEST",
            "Validation error",
            parseResult.error.issues[0]?.message || "Invalid routing rule body"
          );
        }

        const created = await createRoutingRule(options.db, {
          organizationId: orgId,
          ...parseResult.data
        });

        return response.status(201).json(formatRuleResponse(created));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to create routing rule"
        );
      }
    }
  );

  // GET /api/v1/organizations/:orgId/routing/rules/:ruleId
  router.get(
    "/rules/:ruleId",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const ruleId = getParam(request.params, "ruleId");
        const rule = await getRoutingRuleById(options.db, orgId, ruleId);
        if (!rule) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            `Routing rule ${ruleId} not found`
          );
        }
        return response.status(200).json(formatRuleResponse(rule));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to fetch routing rule"
        );
      }
    }
  );

  // PUT /api/v1/organizations/:orgId/routing/rules/:ruleId
  router.put(
    "/rules/:ruleId",
    requireAuth,
    requireManagePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const ruleId = getParam(request.params, "ruleId");

        const parseResult = UpdateRoutingRuleRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "INVALID_REQUEST",
            "Validation error",
            parseResult.error.issues[0]?.message || "Invalid routing rule update body"
          );
        }

        const updated = await updateRoutingRule(options.db, orgId, ruleId, parseResult.data);
        if (!updated) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            `Routing rule ${ruleId} not found`
          );
        }

        return response.status(200).json(formatRuleResponse(updated));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to update routing rule"
        );
      }
    }
  );

  // DELETE /api/v1/organizations/:orgId/routing/rules/:ruleId
  router.delete(
    "/rules/:ruleId",
    requireAuth,
    requireManagePermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const ruleId = getParam(request.params, "ruleId");

        const deleted = await deleteRoutingRule(options.db, orgId, ruleId);
        if (!deleted) {
          return sendProblem(
            response,
            404,
            "RESOURCE_NOT_FOUND",
            "Resource not found",
            `Routing rule ${ruleId} not found`
          );
        }

        return response.status(204).send();
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to delete routing rule"
        );
      }
    }
  );

  // GET /api/v1/organizations/:orgId/routing/logs/:conversationId
  router.get(
    "/logs/:conversationId",
    requireAuth,
    requireViewPermission,
    async (request: Request, response: Response) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const conversationId = getParam(request.params, "conversationId");

        const logs = await listDetailedRoutingLogsForConversation(
          options.db,
          orgId,
          conversationId
        );
        return response.status(200).json(logs.map(formatLogResponse));
      } catch (err) {
        return sendProblem(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal error",
          err instanceof Error ? err.message : "Failed to fetch routing logs"
        );
      }
    }
  );

  return router;
}
