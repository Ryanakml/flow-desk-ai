import { Router, type Request, type Response } from "express";
import {
  type Problem,
  CreateRoutingRuleRequestSchema,
  UpdateRoutingRuleRequestSchema,
  type RoutingRuleResponse,
  type RoutingLogResponse
} from "@flowdesk/contracts";
import {
  createRoutingRule,
  listRoutingRules,
  getRoutingRuleById,
  updateRoutingRule,
  deleteRoutingRule,
  listRoutingLogsForConversation,
  type DbClient,
  type DbRoutingRule,
  type RoutingLogRecord
} from "@flowdesk/db";
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

function formatLogResponse(log: RoutingLogRecord): RoutingLogResponse {
  return {
    ...log,
    routedAt: log.routedAt.toISOString()
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

        const logs = await listRoutingLogsForConversation(options.db, orgId, conversationId);
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
