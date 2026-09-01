import { createHash } from "node:crypto";
import {
  CreateKnowledgeSourceRequestSchema,
  type KnowledgeSourceResponse,
  type Problem
} from "@flowdesk/contracts";
import {
  createKnowledgeSource,
  enqueueKnowledgeIngestionJob,
  listKnowledgeSources,
  recordAuditEvent,
  runInTenantTransaction,
  updateKnowledgeSourceStatus,
  type DbClient,
  type KnowledgeSource,
  type KnowledgeSourceStatus
} from "@flowdesk/db";
import { SsrfProtectionError, validateUrlForIngestion } from "@flowdesk/security";
import { Router, type Request, type Response } from "express";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface KnowledgeRouterOptions {
  db: DbClient;
}

function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
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

function publicStatus(status: KnowledgeSourceStatus): KnowledgeSourceResponse["status"] {
  if (status === "pending") return "queued";
  if (status === "indexing") return "processing";
  if (status === "active") return "ready";
  return status;
}

function serializeSource(source: KnowledgeSource): KnowledgeSourceResponse {
  return {
    id: source.id,
    organizationId: source.organizationId,
    type: source.type,
    name: source.name,
    sourceUri: source.sourceUri,
    status: publicStatus(source.status),
    statusReason: source.statusReason,
    byteSize: source.byteSize,
    lastIndexedAt: source.lastIndexedAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString()
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createKnowledgeRouter(options: KnowledgeRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);
  const requireAdmin = createRequireOrgPermissionMiddleware(options.db, "automation:publish");

  router.get(
    "/sources",
    requireAuth,
    requireAdmin,
    async (request: Request, response: Response, next) => {
      try {
        const organizationId = getParam(request.params, "orgId");
        const sources = await runInTenantTransaction(options.db, { organizationId }, (db) =>
          listKnowledgeSources(db, organizationId)
        );
        return response.status(200).json({ sources: sources.map(serializeSource) });
      } catch (error) {
        return next(error);
      }
    }
  );

  router.post(
    "/sources",
    requireAuth,
    requireAdmin,
    async (request: Request, response: Response, next) => {
      const parsed = CreateKnowledgeSourceRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid knowledge source",
          parsed.error.issues[0]?.message ?? "Invalid request body"
        );
      }

      try {
        const organizationId = getParam(request.params, "orgId");
        const userId = request.user!.id;
        const sourceInput = parsed.data;
        const normalizedInput =
          sourceInput.type === "text"
            ? sourceInput.content.trim()
            : (await validateUrlForIngestion(sourceInput.url)).toString();
        const dedupeKey = sha256(`${sourceInput.type}:${normalizedInput}`);

        const result = await runInTenantTransaction(options.db, { organizationId }, async (db) => {
          const source = await createKnowledgeSource(db, {
            organizationId,
            type: sourceInput.type,
            name: sourceInput.name,
            ...(sourceInput.type === "url" ? { sourceUri: normalizedInput } : {}),
            dedupeKey,
            createdByUserId: userId
          });
          const job = await enqueueKnowledgeIngestionJob(db, {
            organizationId,
            sourceId: source.id,
            dedupeKey,
            ...(sourceInput.type === "text" ? { inputText: normalizedInput } : {})
          });
          if (source.status === "failed" && job.status === "queued") {
            await updateKnowledgeSourceStatus(db, source.id, "pending");
            source.status = "pending";
            source.statusReason = null;
          }
          await recordAuditEvent(db, {
            organizationId,
            actorUserId: userId,
            action: "knowledge:source:create",
            targetType: "knowledge_source",
            targetId: source.id,
            result: "allowed",
            metadata: { type: source.type, deduplicated: source.status !== "pending" }
          });
          return { source, job };
        });

        return response.status(result.source.status === "pending" ? 202 : 200).json({
          source: serializeSource(result.source),
          jobId: result.job.id
        });
      } catch (error) {
        if (error instanceof SsrfProtectionError) {
          return sendProblem(
            response,
            400,
            "KNOWLEDGE_URL_BLOCKED",
            "Knowledge URL blocked",
            "The URL is not allowed by the public-ingestion security policy."
          );
        }
        return next(error);
      }
    }
  );

  return router;
}
