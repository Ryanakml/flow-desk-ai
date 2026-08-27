import type { AuthConfig } from "@flowdesk/config";
import type { Problem } from "@flowdesk/contracts";
import {
  type DbClient,
  createAuthSession,
  createOidcTransaction,
  consumeOidcTransaction,
  findOrCreateUserFromIdentity,
  getActiveSessionByTokenHash,
  revokeAuthSession
} from "@flowdesk/db";
import {
  type IdentityProvider,
  MockIdentityProvider,
  OidcIdentityProvider
} from "@flowdesk/providers";
import {
  createOidcAuthorizationRequest,
  createOpaqueToken,
  hashOidcSecret,
  hashSessionToken,
  parseSessionCookie,
  serializeExpiredSessionCookie,
  serializeSessionCookie
} from "@flowdesk/security";
import { type Request, type Response, type RequestHandler, Router } from "express";

export interface AuthRouterOptions {
  db: DbClient;
  config: AuthConfig;
  identityProvider?: IdentityProvider | undefined;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      sessionToken?: string;
    }
  }
}

function parseCookieByName(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
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

export function createRequireAuthMiddleware(db: DbClient): RequestHandler {
  return async (request, response, next) => {
    const cookieToken = parseSessionCookie(request.headers.cookie);
    if (!cookieToken) {
      return sendProblem(
        response,
        401,
        "UNAUTHORIZED",
        "Unauthorized",
        "Authentication session cookie is missing."
      );
    }

    try {
      const tokenHash = hashSessionToken(cookieToken);
      const session = await getActiveSessionByTokenHash(db, tokenHash);
      if (!session) {
        return sendProblem(
          response,
          401,
          "SESSION_EXPIRED",
          "Session Expired",
          "The authentication session has expired or was revoked."
        );
      }

      request.user = {
        id: session.userId,
        email: session.email,
        displayName: session.displayName
      };
      request.sessionToken = cookieToken;
      next();
    } catch (error) {
      return next(error);
    }
  };
}

export function createAuthRouter(options: AuthRouterOptions): Router {
  const router = Router();
  const identityProvider =
    options.identityProvider ??
    (options.config.AUTH_MOCK_ENABLED
      ? new MockIdentityProvider()
      : new OidcIdentityProvider({
          issuer: options.config.AUTH_OIDC_ISSUER,
          clientId: options.config.AUTH_OIDC_CLIENT_ID,
          clientSecret: options.config.AUTH_OIDC_CLIENT_SECRET
        }));

  // GET /api/v1/auth/login
  router.get("/login", async (request: Request, response: Response, next) => {
    try {
      const returnTo =
        typeof request.query["returnTo"] === "string" && request.query["returnTo"].startsWith("/")
          ? request.query["returnTo"]
          : "/";

      const authRequest = createOidcAuthorizationRequest({
        issuer: options.config.AUTH_OIDC_ISSUER,
        clientId: options.config.AUTH_OIDC_CLIENT_ID,
        redirectUri: options.config.AUTH_OIDC_REDIRECT_URI,
        returnTo
      });

      await createOidcTransaction(options.db, {
        stateHash: hashOidcSecret(authRequest.state),
        nonceHash: hashOidcSecret(authRequest.nonce),
        codeVerifierHash: hashOidcSecret(authRequest.codeVerifier),
        returnTo,
        expiresAt: authRequest.expiresAt
      });

      const secure = options.config.AUTH_COOKIE_SECURE;
      const pkceCookie = `flowdesk_pkce=${authRequest.codeVerifier}; Path=/api/v1/auth/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
      response.setHeader("Set-Cookie", pkceCookie);

      if (request.headers.accept?.includes("application/json")) {
        return response.status(200).json({
          authorizationUrl: authRequest.authorizationUrl.toString()
        });
      }

      return response.redirect(302, authRequest.authorizationUrl.toString());
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/v1/auth/callback
  router.get("/callback", async (request: Request, response: Response, next) => {
    try {
      const code = typeof request.query["code"] === "string" ? request.query["code"] : null;
      const state = typeof request.query["state"] === "string" ? request.query["state"] : null;

      if (!code || !state) {
        return sendProblem(
          response,
          400,
          "BAD_REQUEST",
          "Invalid Callback Request",
          "Missing authorization code or state parameter."
        );
      }

      const stateHash = hashOidcSecret(state);
      const transaction = await consumeOidcTransaction(options.db, stateHash);
      if (!transaction) {
        return sendProblem(
          response,
          400,
          "AUTH_STATE_INVALID",
          "Invalid Authorization State",
          "The authorization transaction is invalid, expired, or has already been used."
        );
      }

      const pkceVerifier =
        parseCookieByName(request.headers.cookie, "flowdesk_pkce") ||
        (options.config.AUTH_MOCK_ENABLED ? "mock-verifier" : "");

      if (!options.config.AUTH_MOCK_ENABLED) {
        if (!pkceVerifier || hashOidcSecret(pkceVerifier) !== transaction.codeVerifierHash) {
          return sendProblem(
            response,
            400,
            "PKCE_VERIFICATION_FAILED",
            "PKCE Verification Failed",
            "The PKCE code verifier is missing or does not match."
          );
        }
      }

      const claims = await identityProvider.exchangeAuthorizationCode({
        code,
        codeVerifier: pkceVerifier,
        redirectUri: options.config.AUTH_OIDC_REDIRECT_URI
      });

      const user = await findOrCreateUserFromIdentity(options.db, {
        provider: claims.provider,
        subject: claims.subject,
        email: claims.email,
        displayName: claims.displayName,
        emailVerifiedAt: claims.emailVerified ? new Date() : null
      });

      const sessionToken = createOpaqueToken();
      const tokenHash = hashSessionToken(sessionToken);
      const expiresAt = new Date(Date.now() + options.config.AUTH_SESSION_TTL_SECONDS * 1000);

      await createAuthSession(options.db, {
        userId: user.id,
        tokenHash,
        expiresAt
      });

      const secure = options.config.AUTH_COOKIE_SECURE;
      const sessionCookie = serializeSessionCookie(sessionToken, secure);
      const clearPkceCookie = `flowdesk_pkce=; Path=/api/v1/auth/callback; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure ? "; Secure" : ""}`;

      response.setHeader("Set-Cookie", [sessionCookie, clearPkceCookie]);

      if (request.headers.accept?.includes("application/json")) {
        return response.status(200).json({
          status: "ok",
          returnTo: transaction.returnTo,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName
          }
        });
      }

      return response.redirect(302, transaction.returnTo || "/");
    } catch (error) {
      return next(error);
    }
  });

  // POST /api/v1/auth/logout
  router.post("/logout", async (request: Request, response: Response, next) => {
    try {
      const sessionToken = parseSessionCookie(request.headers.cookie);
      if (sessionToken) {
        const tokenHash = hashSessionToken(sessionToken);
        await revokeAuthSession(options.db, tokenHash);
      }

      const secure = options.config.AUTH_COOKIE_SECURE;
      response.setHeader("Set-Cookie", serializeExpiredSessionCookie(secure));
      return response.status(200).json({ status: "ok" });
    } catch (error) {
      return next(error);
    }
  });

  // GET /api/v1/auth/session
  router.get(
    "/session",
    createRequireAuthMiddleware(options.db),
    (request: Request, response: Response) => {
      const user = request.user!;
      return response.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName
        }
      });
    }
  );

  return router;
}
