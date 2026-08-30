import { type Request, type Response, Router } from "express";
import {
  type DbClient,
  getAnalyticsOverview,
  getVolumeTimeSeries,
  recordAuditEvent
} from "@flowdesk/db";
import { createRequireAuthMiddleware } from "./auth.js";

export interface AnalyticsRouterOptions {
  db: DbClient;
}

function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const val = params[key];
  if (typeof val === "string") return val;
  if (Array.isArray(val) && typeof val[0] === "string") return val[0];
  return "";
}

function sendProblem(
  response: Response,
  status: number,
  title: string,
  detail: string,
  instance?: string
): Response {
  return response.status(status).json({
    type: `https://flowdesk.dev/errors/${status}`,
    title,
    status,
    detail,
    instance: instance ?? undefined
  });
}

export function createAnalyticsRouter(options: AnalyticsRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const requireAuth = createRequireAuthMiddleware(options.db);

  // GET /api/v1/organizations/:orgId/analytics/metrics
  router.get("/metrics", requireAuth, async (request: Request, response: Response) => {
    try {
      const orgId = getParam(request.params, "orgId");
      const daysParam = request.query["days"];
      const days = typeof daysParam === "string" ? parseInt(daysParam, 10) || 30 : 30;

      const overview = await getAnalyticsOverview(options.db, orgId, days);
      const volumeSeries = await getVolumeTimeSeries(options.db, orgId, Math.min(days, 30));

      return response.status(200).json({
        overview,
        volumeSeries
      });
    } catch (err) {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Failed to fetch analytics metrics",
        err instanceof Error ? err.message : "Internal error"
      );
    }
  });

  // POST /api/v1/organizations/:orgId/analytics/export
  router.post("/export", requireAuth, async (request: Request, response: Response) => {
    try {
      const orgId = getParam(request.params, "orgId");
      const overview = await getAnalyticsOverview(options.db, orgId, 30);
      const volumeSeries = await getVolumeTimeSeries(options.db, orgId, 30);

      await recordAuditEvent(options.db, {
        organizationId: orgId,
        actorUserId: request.user?.id ?? "unknown",
        action: "analytics.exported",
        targetType: "organization",
        targetId: orgId,
        result: "allowed",
        metadata: { exportFormat: "csv" }
      });

      const csvLines: string[] = [
        "Category,Metric,Value",
        `Conversations,Total,${overview.totalConversations}`,
        `Conversations,Open,${overview.openConversations}`,
        `Conversations,Assigned,${overview.assignedConversations}`,
        `Conversations,Resolved,${overview.resolvedConversations}`,
        `Messages,Total,${overview.totalMessages}`,
        `Messages,Inbound,${overview.inboundMessages}`,
        `Messages,Outbound,${overview.outboundMessages}`,
        `Messages,Bot,${overview.botMessages}`,
        `Messages,Human,${overview.humanMessages}`,
        `Automation,Bot Automation Rate (%),${overview.botAutomationRate}%`,
        `SLA,SLA Met Rate (%),${overview.slaMetPercentage}%`,
        `Performance,Avg First Response Time (s),${overview.avgFirstResponseTimeSeconds}`,
        `Performance,Avg Resolution Time (s),${overview.avgResolutionTimeSeconds}`,
        "",
        "Date,Inbound Messages,Outbound Messages,Bot Messages"
      ];

      for (const point of volumeSeries) {
        csvLines.push(`${point.date},${point.inbound},${point.outbound},${point.bot}`);
      }

      const csvContent = csvLines.join("\n");

      response.setHeader("Content-Type", "text/csv");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="flowdesk-analytics-${orgId}.csv"`
      );
      return response.status(200).send(csvContent);
    } catch (err) {
      return sendProblem(
        response,
        500,
        "INTERNAL_ERROR",
        "Failed to export compliance CSV report",
        err instanceof Error ? err.message : "Internal error"
      );
    }
  });

  return router;
}
