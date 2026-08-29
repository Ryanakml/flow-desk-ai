import { randomUUID } from "node:crypto";
import {
  type Problem,
  CreateUploadSessionRequestSchema,
  CompleteUploadRequestSchema,
  AttachmentDetailResponseSchema
} from "@flowdesk/contracts";
import {
  type DbClient,
  createAttachmentUploadSession,
  getAttachmentById,
  completeAttachmentUploadSession,
  type AttachmentRecord
} from "@flowdesk/db";
import { ALLOWED_MIME_TYPES, getMediaSizeLimit } from "@flowdesk/domain";
import { type ObjectStore, InMemoryObjectStore } from "@flowdesk/providers";
import { type Request, type Response, Router } from "express";
import { createRequireAuthMiddleware } from "./auth.js";
import { createRequireOrgPermissionMiddleware } from "./organizations.js";

export interface AttachmentsRouterOptions {
  db: DbClient;
  storage?: ObjectStore | undefined;
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

function serializeAttachment(attachment: AttachmentRecord) {
  return AttachmentDetailResponseSchema.parse({
    id: attachment.id,
    organizationId: attachment.organizationId,
    uploaderUserId: attachment.uploaderUserId,
    fileName: attachment.fileName,
    contentType: attachment.contentType,
    detectedMimeType: attachment.detectedMimeType,
    byteSize: attachment.byteSize,
    sha256Checksum: attachment.sha256Checksum,
    status: attachment.status,
    quarantineReason: attachment.quarantineReason,
    scannedAt: attachment.scannedAt?.toISOString() ?? null,
    scannerName: attachment.scannerName,
    createdAt: attachment.createdAt.toISOString(),
    updatedAt: attachment.updatedAt.toISOString()
  });
}

export function createAttachmentsRouter(options: AttachmentsRouterOptions): Router {
  const router = Router({ mergeParams: true });
  const { db } = options;
  const storage = options.storage ?? new InMemoryObjectStore();

  const requireAuth = createRequireAuthMiddleware(db);
  const requireSendMessage = createRequireOrgPermissionMiddleware(db, "message:send");
  const requireReadConversation = createRequireOrgPermissionMiddleware(db, "conversation:read");

  // 1. POST /upload-session
  router.post(
    "/upload-session",
    requireAuth,
    requireSendMessage,
    async (request: Request, response: Response): Promise<void> => {
      const orgId = request.params["orgId"] as string;
      const parsedBody = CreateUploadSessionRequestSchema.safeParse(request.body);

      if (!parsedBody.success) {
        sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid upload session request",
          parsedBody.error.message
        );
        return;
      }

      const { fileName, contentType, byteSize, sha256Checksum } = parsedBody.data;
      const normMime = contentType.toLowerCase().trim();

      // Check MIME allowlist
      if (!ALLOWED_MIME_TYPES.has(normMime)) {
        sendProblem(
          response,
          422,
          "DISALLOWED_MIME_TYPE",
          "MIME type not allowed",
          `Content type '${contentType}' is not permitted in attachments.`
        );
        return;
      }

      // Check size limit
      const sizeLimit = getMediaSizeLimit(normMime);
      if (sizeLimit !== null && byteSize > sizeLimit) {
        sendProblem(
          response,
          422,
          "EXCEEDS_SIZE_LIMIT",
          "File exceeds size limit",
          `File size of ${byteSize} bytes exceeds the maximum permitted limit of ${sizeLimit} bytes for '${contentType}'.`
        );
        return;
      }

      try {
        const attachmentId = randomUUID();
        const unguessableToken = randomUUID();
        const storageKey = `org-${orgId}/quarantine/${attachmentId}/${unguessableToken}`;
        const expiresInSeconds = 900; // 15 minutes

        const presigned = await storage.createPresignedUploadUrl({
          key: storageKey,
          contentType: normMime,
          byteSize,
          expiresInSeconds
        });

        const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

        const result = await createAttachmentUploadSession(db, {
          organizationId: orgId,
          uploaderUserId: request.user?.id ?? null,
          fileName,
          contentType: normMime,
          byteSize,
          sha256Checksum: sha256Checksum ?? null,
          storageKey,
          uploadUrl: presigned.uploadUrl,
          expiresAt
        });

        response.status(201).json({
          attachmentId: result.attachment.id,
          uploadSessionId: result.uploadSession.id,
          uploadUrl: presigned.uploadUrl,
          headers: presigned.headers,
          expiresAt: expiresAt.toISOString()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        sendProblem(response, 500, "STORAGE_ERROR", "Upload session generation failed", message);
      }
    }
  );

  // 2. POST /:id/complete
  router.post(
    "/:id/complete",
    requireAuth,
    requireSendMessage,
    async (request: Request, response: Response): Promise<void> => {
      const orgId = request.params["orgId"] as string;
      const attachmentId = request.params["id"] as string;

      const parsedBody = CompleteUploadRequestSchema.safeParse(request.body);
      if (!parsedBody.success) {
        sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Invalid complete request",
          parsedBody.error.message
        );
        return;
      }

      const updated = await completeAttachmentUploadSession(
        db,
        orgId,
        attachmentId,
        parsedBody.data.sha256Checksum ?? null
      );

      if (!updated) {
        sendProblem(
          response,
          404,
          "ATTACHMENT_NOT_FOUND",
          "Attachment not found",
          `Attachment '${attachmentId}' was not found in organization '${orgId}'.`
        );
        return;
      }

      response.status(200).json(serializeAttachment(updated));
    }
  );

  // 3. GET /:id
  router.get(
    "/:id",
    requireAuth,
    requireReadConversation,
    async (request: Request, response: Response): Promise<void> => {
      const orgId = request.params["orgId"] as string;
      const attachmentId = request.params["id"] as string;

      const attachment = await getAttachmentById(db, orgId, attachmentId);
      if (!attachment) {
        sendProblem(
          response,
          404,
          "ATTACHMENT_NOT_FOUND",
          "Attachment not found",
          `Attachment '${attachmentId}' was not found in organization '${orgId}'.`
        );
        return;
      }

      response.status(200).json(serializeAttachment(attachment));
    }
  );

  return router;
}
