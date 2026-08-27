import { describe, expect, it } from "vitest";
import {
  acquireIdempotencyKey,
  completeIdempotencyKey,
  releaseIdempotencyKey
} from "./idempotency.js";
import type { DbClient } from "./auth.js";

function createMockDb(): DbClient {
  interface Row {
    id: string;
    organization_id: string;
    actor_user_id: string;
    route: string;
    key: string;
    request_fingerprint: string;
    response_status: number | null;
    response_body: unknown;
    completed_at: Date | null;
    expires_at: Date;
  }

  const table = new Map<string, Row>();

  const makeRowKey = (orgId: string, actorId: string, route: string, key: string) =>
    `${orgId}:${actorId}:${route}:${key}`;

  return {
    async query(sqlText: string, values: unknown[] = []) {
      await Promise.resolve();
      const sql = sqlText.replace(/\s+/g, " ").trim();

      // SELECT
      if (sql.startsWith("SELECT") && sql.includes("FROM flowdesk.idempotency_keys")) {
        const [orgId, actorId, route, key] = values as [string, string, string, string];
        const row = table.get(makeRowKey(orgId, actorId, route, key));
        if (!row) {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: row.id,
              request_fingerprint: row.request_fingerprint,
              response_status: row.response_status,
              response_body: row.response_body,
              completed_at: row.completed_at,
              expires_at: row.expires_at
            }
          ]
        };
      }

      // INSERT
      if (sql.includes("INSERT INTO flowdesk.idempotency_keys")) {
        const [orgId, actorId, route, key, fingerprint, ttlHours] = values as [
          string,
          string,
          string,
          string,
          string,
          number
        ];
        const rowKey = makeRowKey(orgId, actorId, route, key);
        if (table.has(rowKey)) {
          const err = new Error("unique_violation") as Error & { code: string };
          err.code = "23505";
          throw err;
        }
        const expiresAt = new Date(Date.now() + (ttlHours || 24) * 3600000);
        table.set(rowKey, {
          id: `idemp-${table.size + 1}`,
          organization_id: orgId,
          actor_user_id: actorId,
          route,
          key,
          request_fingerprint: fingerprint,
          response_status: null,
          response_body: null,
          completed_at: null,
          expires_at: expiresAt
        });
        return { rowCount: 1 };
      }

      // UPDATE (complete)
      if (
        sql.includes("UPDATE flowdesk.idempotency_keys") &&
        sql.includes("completed_at = clock_timestamp()")
      ) {
        const [status, bodyJson, orgId, actorId, route, key] = values as [
          number,
          string,
          string,
          string,
          string,
          string
        ];
        const row = table.get(makeRowKey(orgId, actorId, route, key));
        if (row) {
          row.response_status = status;
          row.response_body = JSON.parse(bodyJson);
          row.completed_at = new Date();
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      // UPDATE (expired re-acquire)
      if (
        sql.includes("UPDATE flowdesk.idempotency_keys") &&
        sql.includes("response_status = NULL")
      ) {
        const [fingerprint, ttlHours, id] = values as [string, number, string];
        for (const row of table.values()) {
          if (row.id === id) {
            row.request_fingerprint = fingerprint;
            row.response_status = null;
            row.response_body = null;
            row.completed_at = null;
            row.expires_at = new Date(Date.now() + (ttlHours || 24) * 3600000);
            return { rowCount: 1 };
          }
        }
        return { rowCount: 0 };
      }

      // DELETE (release)
      if (sql.includes("DELETE FROM flowdesk.idempotency_keys")) {
        const [orgId, actorId, route, key] = values as [string, string, string, string];
        const rowKey = makeRowKey(orgId, actorId, route, key);
        const row = table.get(rowKey);
        if (row && row.completed_at === null) {
          table.delete(rowKey);
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      return { rows: [] };
    }
  } as unknown as DbClient;
}

describe("Idempotency DB Repository (M1-06)", () => {
  it("acquires new idempotency key", async () => {
    const db = createMockDb();
    const res = await acquireIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      requestFingerprint: "fp-1"
    });

    expect(res.status).toBe("acquired");
  });

  it("detects in-flight concurrent request", async () => {
    const db = createMockDb();
    await acquireIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      requestFingerprint: "fp-1"
    });

    // Second request with same key
    const res2 = await acquireIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      requestFingerprint: "fp-1"
    });

    expect(res2.status).toBe("in_flight");
    expect(res2.requestFingerprint).toBe("fp-1");
  });

  it("returns completed cached response on replay", async () => {
    const db = createMockDb();
    await acquireIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      requestFingerprint: "fp-1"
    });

    await completeIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      responseStatus: 201,
      responseBody: { invitationId: "inv-99" }
    });

    // Replay
    const res = await acquireIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      requestFingerprint: "fp-1"
    });

    expect(res.status).toBe("completed");
    expect(res.responseStatus).toBe(201);
    expect(res.responseBody).toEqual({ invitationId: "inv-99" });
    expect(res.requestFingerprint).toBe("fp-1");
  });

  it("releases in-flight key so caller can retry", async () => {
    const db = createMockDb();
    await acquireIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      requestFingerprint: "fp-1"
    });

    await releaseIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1"
    });

    // Can be acquired again
    const res = await acquireIdempotencyKey(db, {
      organizationId: "org-1",
      actorUserId: "user-1",
      route: "POST:/api/v1/invitations",
      key: "key-1",
      requestFingerprint: "fp-1"
    });

    expect(res.status).toBe("acquired");
  });
});
