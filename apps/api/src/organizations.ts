import type { Problem } from "@flowdesk/contracts";
import {
  BootstrapOrganizationRequestSchema,
  CreateInvitationRequestSchema,
  AcceptInvitationRequestSchema,
  UpdateMembershipRoleRequestSchema
} from "@flowdesk/contracts";
import {
  type DbClient,
  bootstrapOrganization,
  createInvitation,
  consumeInvitation,
  revokeInvitation,
  listMemberships,
  getMemberRole,
  updateMembershipRole,
  revokeMembership,
  LastOwnerProtectionError
} from "@flowdesk/db";
import { type Permission, hasPermission } from "@flowdesk/domain";
import { createOpaqueToken, hashSessionToken } from "@flowdesk/security";
import { type Request, type Response, type RequestHandler, Router } from "express";
import { createRequireAuthMiddleware } from "./auth.js";

export interface OrganizationRouterOptions {
  db: DbClient;
}

export interface AuthenticatedMember {
  membershipId: string;
  roleKey: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      member?: AuthenticatedMember;
    }
  }
}

function sendProblem(
  response: Response,
  status: number,
  code: string,
  title: string,
  detail: string
) {
  const requestId = response.getHeader("x-request-id")?.toString() ?? "unknown";
  const problem: Problem = {
    type: `https://flowdesk.dev/problems/${code.toLowerCase().replace(/_/g, "-")}`,
    title,
    status,
    code,
    detail,
    requestId
  };
  return response.status(status).type("application/problem+json").json(problem);
}

function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const val = params[key];
  if (Array.isArray(val)) return val[0] ?? "";
  return typeof val === "string" ? val : "";
}

export function createRequireOrgPermissionMiddleware(
  db: DbClient,
  permission: Permission
): RequestHandler {
  return async (request: Request, response: Response, next) => {
    const user = request.user;
    if (!user) {
      return sendProblem(
        response,
        401,
        "UNAUTHORIZED",
        "Unauthorized",
        "Authentication is required."
      );
    }

    const orgId = getParam(request.params, "orgId");
    if (!orgId) {
      return sendProblem(
        response,
        400,
        "BAD_REQUEST",
        "Invalid Organization ID",
        "Organization ID parameter is missing."
      );
    }

    try {
      const membership = await getMemberRole(db, { organizationId: orgId, userId: user.id });
      if (!membership) {
        return sendProblem(
          response,
          403,
          "NOT_A_MEMBER",
          "Access Denied",
          "You are not an active member of this organization."
        );
      }

      if (!hasPermission(membership.roleKey, permission)) {
        return sendProblem(
          response,
          403,
          "FORBIDDEN",
          "Forbidden",
          `Role '${membership.roleKey}' does not have permission '${permission}'.`
        );
      }

      request.member = {
        membershipId: membership.membershipId,
        roleKey: membership.roleKey
      };
      next();
    } catch (error) {
      return next(error);
    }
  };
}

export function createOrganizationsRouter(options: OrganizationRouterOptions): Router {
  const router = Router();
  const requireAuth = createRequireAuthMiddleware(options.db);

  // POST /api/v1/organizations - Bootstrap new organization
  router.post(["/", ""], requireAuth, async (request: Request, response: Response, next) => {
    try {
      const parseResult = BootstrapOrganizationRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          parseResult.error.issues.map((i) => i.message).join("; ")
        );
      }

      const user = request.user!;
      const result = await bootstrapOrganization(options.db, {
        name: parseResult.data.name,
        slug: parseResult.data.slug,
        userId: user.id
      });

      return response.status(201).json({
        organization: {
          id: result.organizationId,
          slug: result.slug,
          displayName: result.displayName,
          ownerRoleId: result.ownerRoleId,
          membershipId: result.membershipId
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/v1/invitations/accept - Accept invitation by token
  router.post(
    "/invitations/accept",
    requireAuth,
    async (request: Request, response: Response, next) => {
      try {
        const parseResult = AcceptInvitationRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "VALIDATION_ERROR",
            "Validation Error",
            "A valid invitation token is required."
          );
        }

        const tokenHash = hashSessionToken(parseResult.data.token);
        const user = request.user!;
        const consumed = await consumeInvitation(options.db, {
          tokenHash,
          userId: user.id
        });

        if (!consumed) {
          return sendProblem(
            response,
            400,
            "INVITATION_INVALID",
            "Invalid Invitation",
            "The invitation token is invalid, expired, or has already been accepted."
          );
        }

        return response.status(200).json({
          status: "ok",
          organizationId: consumed.organizationId,
          membershipId: consumed.membershipId
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  // GET /api/v1/organizations/:orgId/members - List members
  router.get(
    "/:orgId/members",
    requireAuth,
    createRequireOrgPermissionMiddleware(options.db, "membership:read"),
    async (request: Request, response: Response, next) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const members = await listMemberships(options.db, orgId);
        return response.status(200).json({
          members: members.map((m) => ({
            id: m.id,
            userId: m.userId,
            email: m.email,
            displayName: m.displayName,
            roleKey: m.roleKey,
            roleLabel: m.roleLabel,
            status: m.status,
            createdAt: m.createdAt.toISOString()
          }))
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  // POST /api/v1/organizations/:orgId/invitations - Create invitation
  router.post(
    "/:orgId/invitations",
    requireAuth,
    createRequireOrgPermissionMiddleware(options.db, "membership:invite"),
    async (request: Request, response: Response, next) => {
      try {
        const parseResult = CreateInvitationRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "VALIDATION_ERROR",
            "Validation Error",
            parseResult.error.issues.map((i) => i.message).join("; ")
          );
        }

        const orgId = getParam(request.params, "orgId");
        const user = request.user!;
        const inviteToken = createOpaqueToken();
        const tokenHash = hashSessionToken(inviteToken);

        const invite = await createInvitation(options.db, {
          organizationId: orgId,
          email: parseResult.data.email,
          roleKey: parseResult.data.role,
          tokenHash,
          invitedByUserId: user.id
        });

        return response.status(201).json({
          invitation: {
            id: invite.id,
            organizationId: invite.organizationId,
            email: invite.email,
            role: invite.roleKey,
            status: invite.status,
            expiresAt: invite.expiresAt.toISOString(),
            inviteToken
          }
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  // DELETE /api/v1/organizations/:orgId/invitations/:inviteId - Revoke invitation
  router.delete(
    "/:orgId/invitations/:inviteId",
    requireAuth,
    createRequireOrgPermissionMiddleware(options.db, "membership:revoke"),
    async (request: Request, response: Response, next) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const inviteId = getParam(request.params, "inviteId");
        const revoked = await revokeInvitation(options.db, {
          organizationId: orgId,
          invitationId: inviteId
        });

        if (!revoked) {
          return sendProblem(
            response,
            404,
            "INVITATION_NOT_FOUND",
            "Not Found",
            "The invitation was not found or is no longer pending."
          );
        }

        return response.status(200).json({ status: "ok" });
      } catch (error) {
        return next(error);
      }
    }
  );

  // PATCH /api/v1/organizations/:orgId/members/:memberId - Update member role
  router.patch(
    "/:orgId/members/:memberId",
    requireAuth,
    createRequireOrgPermissionMiddleware(options.db, "membership:modify"),
    async (request: Request, response: Response, next) => {
      try {
        const parseResult = UpdateMembershipRoleRequestSchema.safeParse(request.body);
        if (!parseResult.success) {
          return sendProblem(
            response,
            400,
            "VALIDATION_ERROR",
            "Validation Error",
            parseResult.error.issues.map((i) => i.message).join("; ")
          );
        }

        const orgId = getParam(request.params, "orgId");
        const memberId = getParam(request.params, "memberId");

        try {
          const updated = await updateMembershipRole(options.db, {
            organizationId: orgId,
            membershipId: memberId,
            newRoleKey: parseResult.data.role
          });

          return response.status(200).json({
            membershipId: updated.membershipId,
            role: updated.roleKey
          });
        } catch (err) {
          if (err instanceof LastOwnerProtectionError) {
            return sendProblem(
              response,
              400,
              "LAST_OWNER_PROTECTION_VIOLATION",
              "Last Owner Protection",
              err.message
            );
          }
          throw err;
        }
      } catch (error) {
        return next(error);
      }
    }
  );

  // DELETE /api/v1/organizations/:orgId/members/:memberId - Revoke member
  router.delete(
    "/:orgId/members/:memberId",
    requireAuth,
    createRequireOrgPermissionMiddleware(options.db, "membership:revoke"),
    async (request: Request, response: Response, next) => {
      try {
        const orgId = getParam(request.params, "orgId");
        const memberId = getParam(request.params, "memberId");

        try {
          const revoked = await revokeMembership(options.db, {
            organizationId: orgId,
            membershipId: memberId
          });

          if (!revoked) {
            return sendProblem(
              response,
              404,
              "MEMBERSHIP_NOT_FOUND",
              "Not Found",
              "The membership was not found or has already been revoked."
            );
          }

          return response.status(200).json({ status: "ok" });
        } catch (err) {
          if (err instanceof LastOwnerProtectionError) {
            return sendProblem(
              response,
              400,
              "LAST_OWNER_PROTECTION_VIOLATION",
              "Last Owner Protection",
              err.message
            );
          }
          throw err;
        }
      } catch (error) {
        return next(error);
      }
    }
  );

  return router;
}

export function createInvitationsRouter(options: OrganizationRouterOptions): Router {
  const router = Router();
  const requireAuth = createRequireAuthMiddleware(options.db);

  router.post("/accept", requireAuth, async (request: Request, response: Response, next) => {
    try {
      const parseResult = AcceptInvitationRequestSchema.safeParse(request.body);
      if (!parseResult.success) {
        return sendProblem(
          response,
          400,
          "VALIDATION_ERROR",
          "Validation Error",
          "A valid invitation token is required."
        );
      }

      const tokenHash = hashSessionToken(parseResult.data.token);
      const user = request.user!;
      const consumed = await consumeInvitation(options.db, {
        tokenHash,
        userId: user.id
      });

      if (!consumed) {
        return sendProblem(
          response,
          400,
          "INVITATION_INVALID",
          "Invalid Invitation",
          "The invitation token is invalid, expired, or has already been accepted."
        );
      }

      return response.status(200).json({
        status: "ok",
        organizationId: consumed.organizationId,
        membershipId: consumed.membershipId
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
