import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loadAuthConfig } from "@flowdesk/config";
import type { DbClient } from "@flowdesk/db";
import { hashSessionToken, serializeSessionCookie } from "@flowdesk/security";
import { createApiApp } from "./app.js";

function createMockDb(): DbClient {
  const users = new Map<
    string,
    { id: string; email: string; displayName: string; status: string }
  >();
  const sessions = new Map<
    string,
    { id: string; userId: string; tokenHash: string; expiresAt: Date; revokedAt: Date | null }
  >();
  const orgs = new Map<string, { id: string; slug: string; name: string }>();
  const roles = new Map<string, { id: string; orgId: string; key: string; label: string }>();
  const memberships = new Map<
    string,
    { id: string; orgId: string; userId: string; roleId: string; status: string; createdAt: Date }
  >();
  interface MockBotConfigRow {
    id: string;
    organization_id: string;
    mode: "off" | "draft";
    name: string;
    instructions: string;
    tone: string;
    language: string;
    model: string;
    confidence_threshold: number;
    top_k: number;
    emergency_disabled: boolean;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }
  const botConfigs = new Map<string, MockBotConfigRow>();
  const botRuns = new Map<string, Record<string, unknown>>();
  const outboundMessages = new Map<string, Record<string, unknown>>();
  let conversationStatus: "open" | "closed" = "open";

  users.set("u1", {
    id: "u1",
    email: "admin@flowdesk.dev",
    displayName: "Admin",
    status: "active"
  });

  const rawToken = "bot-test-token-12345";
  const tokenHash = hashSessionToken(rawToken);
  sessions.set("s1", {
    id: "s1",
    userId: "u1",
    tokenHash,
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null
  });

  orgs.set("org1", { id: "org1", slug: "acme", name: "Acme Corp" });
  roles.set("r1", { id: "r1", orgId: "org1", key: "owner", label: "Owner" });
  memberships.set("m1", {
    id: "m1",
    orgId: "org1",
    userId: "u1",
    roleId: "r1",
    status: "active",
    createdAt: new Date()
  });

  const queryMock = async (sql: string, params?: unknown[]) => {
    await Promise.resolve();
    if (sql === "TEST_COMPLETE_BOT_RUN") {
      const run = botRuns.get(params?.[0] as string);
      if (run) {
        run["status"] = "completed";
        run["suggested_content"] = "Garansi resmi berlaku satu tahun.";
        run["confidence"] = 0.92;
        run["citations"] = [
          {
            chunkId: "chunk1",
            sourceTitle: "Policy Guide",
            snippet: "Garansi berlaku satu tahun.",
            score: 0.9
          }
        ];
      }
      return { rows: [] };
    }
    if (sql === "TEST_CLOSE_CONVERSATION") {
      conversationStatus = "closed";
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO flowdesk.bot_configs")) {
      const orgId = params?.[0] as string;
      const existing: MockBotConfigRow = botConfigs.get(orgId) || {
        id: randomUUID(),
        organization_id: orgId,
        name: "FlowDesk AI Assistant",
        instructions: "System support instructions",
        tone: "professional",
        language: "id",
        model: "gpt-4o-mini",
        confidence_threshold: 0.7,
        top_k: 5,
        mode: "draft" as const,
        emergency_disabled: false,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const updated: MockBotConfigRow = {
        ...existing,
        mode: (params?.[1] as "off" | "draft") ?? existing.mode,
        name: (params?.[2] as string) ?? existing.name,
        instructions: (params?.[3] as string) ?? existing.instructions,
        tone: (params?.[4] as string) ?? existing.tone,
        language: (params?.[5] as string) ?? existing.language,
        model: (params?.[6] as string) ?? existing.model,
        confidence_threshold: (params?.[7] as number) ?? existing.confidence_threshold,
        top_k: (params?.[8] as number) ?? existing.top_k,
        emergency_disabled: (params?.[9] as boolean) ?? existing.emergency_disabled,
        updated_at: new Date().toISOString()
      };
      botConfigs.set(orgId, updated);
      return { rows: [updated] };
    }

    if (sql.includes("FROM flowdesk.bot_configs")) {
      const orgId = params?.[0] as string;
      const found = botConfigs.get(orgId);
      if (found) {
        return { rows: [found] };
      }
      const defaultConfig: MockBotConfigRow = {
        id: randomUUID(),
        organization_id: orgId,
        name: "FlowDesk AI Assistant",
        instructions: "System support instructions",
        tone: "professional",
        language: "id",
        model: "gpt-4o-mini",
        confidence_threshold: 0.7,
        top_k: 5,
        mode: "draft" as const,
        emergency_disabled: false,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      botConfigs.set(orgId, defaultConfig);
      return { rows: [defaultConfig] };
    }

    if (sql.toLowerCase().includes("conversations")) {
      return {
        rows: [
          {
            id: "c1",
            organizationId: "org1",
            channelId: "ch1",
            customerPhone: "+628123456789",
            customerName: "Customer",
            status: conversationStatus,
            priority: "normal",
            assignedToUserId: null,
            queueId: null,
            teamId: null,
            botPaused: false,
            version: 1,
            lastMessageAt: new Date(),
            lastInboundAt: new Date(),
            metadata: {},
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ]
      };
    }

    if (sql.includes("metadata->>'aiBotRunId'")) {
      const found = [...outboundMessages.values()].find(
        (message) => (message["metadata"] as Record<string, unknown>)["aiBotRunId"] === params?.[1]
      );
      return { rows: found ? [found] : [] };
    }

    if (sql.includes("INSERT INTO flowdesk.messages")) {
      const id = randomUUID();
      const message = {
        id,
        organizationId: "00000000-0000-7000-8000-0000000000a1",
        conversationId: "00000000-0000-7000-8000-0000000000c1",
        channelId: "00000000-0000-7000-8000-0000000000b1",
        direction: params?.[3],
        senderType: params?.[4],
        senderUserId: "00000000-0000-7000-8000-0000000000e1",
        providerMessageId: params?.[6],
        content: params?.[7],
        status: params?.[8],
        errorDetail: null,
        metadata: JSON.parse(params?.[9] as string) as Record<string, unknown>,
        sentAt: params?.[10],
        deliveredAt: null,
        readAt: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      outboundMessages.set(id, message);
      return { rows: [message] };
    }

    if (sql.toLowerCase().includes("messages")) {
      return {
        rows: [
          {
            id: "msg1",
            organizationId: "org1",
            conversationId: "c1",
            channelId: "ch1",
            direction: "inbound",
            senderType: "customer",
            senderUserId: null,
            providerMessageId: "provider-msg1",
            content: "Apakah garansi produk berlaku 1 tahun?",
            status: "delivered",
            errorDetail: null,
            metadata: {},
            sentAt: new Date(),
            deliveredAt: new Date(),
            readAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ]
      };
    }

    if (sql.includes("document_chunks") || sql.includes("vector_cosine_ops")) {
      return {
        rows: [
          {
            id: "chunk1",
            content: "Garansi resmi produk FlowDesk berlaku selama 1 tahun sejak pembelian.",
            similarity: 0.88,
            metadata: { documentTitle: "Policy Guide" }
          }
        ]
      };
    }

    if (sql.includes("INSERT INTO flowdesk.audit_logs")) {
      return { rows: [{ id: randomUUID(), occurred_at: new Date() }] };
    }

    if (sql.includes("INSERT INTO flowdesk.bot_runs")) {
      const runId = randomUUID();
      const mockRun = {
        id: runId,
        organization_id: "org1",
        conversation_id: "c1",
        trigger_message_id: params?.[2] ?? null,
        bot_config_id: params?.[3] ?? null,
        knowledge_version_id: (params?.[4] as string | null) ?? null,
        mode: "draft",
        status: sql.includes("'queued'") ? "queued" : "off",
        suggested_content: null,
        confidence: null,
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        latency_ms: 50,
        cost_estimate_microcents: 5,
        citations: [],
        reasoning: null,
        error_code: null,
        error_detail: null,
        requested_by_user_id: "u1",
        model: "gpt-4o-mini",
        prompt_version: "m4-v1",
        config_snapshot: {},
        input_message_created_at: new Date(),
        attempts: 0,
        max_attempts: 3,
        available_at: new Date(),
        claimed_at: null,
        completed_at: null,
        metadata: {},
        operator_action: null,
        operator_action_at: null,
        operator_user_id: null,
        created_at: new Date(),
        updated_at: new Date()
      };
      botRuns.set(runId, mockRun);
      return { rows: [mockRun] };
    }

    if (sql.includes("SELECT * FROM flowdesk.bot_runs WHERE id")) {
      const run = botRuns.get(params?.[0] as string);
      return { rows: run ? [run] : [] };
    }

    if (sql.includes("FROM flowdesk.bot_runs") && sql.includes("ORDER BY created_at DESC")) {
      const run = [...botRuns.values()].at(-1);
      return { rows: run ? [run] : [] };
    }

    if (sql.includes("SET operator_action")) {
      const run = botRuns.get(params?.[2] as string);
      if (!run || run["status"] !== "completed" || run["operator_action"]) return { rows: [] };
      run["operator_action"] = params?.[0];
      run["operator_user_id"] = params?.[1];
      return { rows: [{ id: run["id"] }] };
    }

    if (sql.includes("SET status = 'stale'")) {
      const run = botRuns.get(params?.[0] as string);
      if (run) run["status"] = "stale";
      return { rows: run ? [{ id: run["id"] }] : [] };
    }

    if (sql.toLowerCase().includes("auth_sessions")) {
      const session = Array.from(sessions.values()).find((s) => s.tokenHash === params?.[0]);
      if (!session) return { rows: [] };
      return {
        rows: [
          {
            id: session.id,
            user_id: session.userId,
            token_hash: session.tokenHash,
            expires_at: session.expiresAt.toISOString(),
            revoked_at: session.revokedAt ? session.revokedAt.toISOString() : null,
            email: "admin@flowdesk.dev",
            display_name: "Admin",
            user_status: "active"
          }
        ]
      };
    }

    if (sql.toLowerCase().includes("memberships")) {
      return {
        rows: [
          {
            id: "m1",
            organization_id: "org1",
            user_id: "u1",
            role_key: "owner",
            role_label: "Owner",
            status: "active"
          }
        ]
      };
    }

    return { rows: [] };
  };

  return {
    query: queryMock,
    transaction: async (cb: (tx: { query: typeof queryMock }) => Promise<unknown>) =>
      cb({ query: queryMock })
  } as unknown as DbClient;
}

describe("Bot Configuration & AI Draft Generation API", () => {
  const config = loadAuthConfig({
    SESSION_SECRET: "test-secret-at-least-32-chars-long!!",
    APP_BASE_URL: "http://localhost:4000"
  });

  it("fetches default bot config for organization", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });

    const cookieHeader = serializeSessionCookie("bot-test-token-12345", false);

    const res = (await request(app)
      .get("/api/v1/organizations/org1/bot/config")
      .set("Cookie", cookieHeader)) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(200);
    const body = res.body as { mode: string; instructions: string };
    expect(body.mode).toBe("draft");
    expect(body.instructions).toContain("support");
  });

  it("updates bot config for organization", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });

    const cookieHeader = serializeSessionCookie("bot-test-token-12345", false);

    const res = (await request(app)
      .put("/api/v1/organizations/org1/bot/config")
      .set("Cookie", cookieHeader)
      .send({
        instructions: "Custom support agent guidelines",
        tone: "friendly",
        mode: "draft"
      })) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(200);
    const body = res.body as { instructions: string; tone: string };
    expect(body.instructions).toBe("Custom support agent guidelines");
    expect(body.tone).toBe("friendly");
  });

  it("queues a durable AI draft run without calling the provider in the request", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });

    const cookieHeader = serializeSessionCookie("bot-test-token-12345", false);

    const res = (await request(app)
      .post("/api/v1/organizations/org1/bot/draft/c1")
      .set("Cookie", cookieHeader)) as unknown as { status: number; body: unknown };

    expect(res.status).toBe(202);
    const body = res.body as {
      status: string;
      runId: string;
      sendable: boolean;
    };
    expect(body.status).toBe("queued");
    expect(body.runId).toBeDefined();
    expect(body.sendable).toBe(false);
  });

  it("can queue when the API process has no AI credential because only the worker calls AI", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });

    const res = (await request(app)
      .post("/api/v1/organizations/org1/bot/draft/c1")
      .set("Cookie", serializeSessionCookie("bot-test-token-12345", false))) as unknown as {
      status: number;
      body: { code?: string; detail?: string };
    };

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "queued", sendable: false });
  });

  it("restores a completed durable draft after refresh and approves it idempotently", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });
    const cookie = serializeSessionCookie("bot-test-token-12345", false);
    const queued = (await request(app)
      .post("/api/v1/organizations/org1/bot/draft/c1")
      .set("Cookie", cookie)) as unknown as {
      status: number;
      body: { runId: string };
    };
    await db.query("TEST_COMPLETE_BOT_RUN", [queued.body.runId]);

    const restored = (await request(app)
      .get("/api/v1/organizations/org1/bot/draft/c1/latest")
      .set("Cookie", cookie)) as unknown as {
      status: number;
      body: { runId: string; status: string; sendable: boolean };
    };
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({
      runId: queued.body.runId,
      status: "drafted",
      sendable: true
    });

    const firstApproval = (await request(app)
      .post(`/api/v1/organizations/org1/bot/draft-runs/${queued.body.runId}/action`)
      .set("Cookie", cookie)
      .send({ action: "approved" })) as unknown as {
      status: number;
      body: { message: { id: string; content: string } };
    };
    const replay = (await request(app)
      .post(`/api/v1/organizations/org1/bot/draft-runs/${queued.body.runId}/action`)
      .set("Cookie", cookie)
      .send({ action: "approved" })) as unknown as {
      status: number;
      body: { message: { id: string } };
    };
    expect(firstApproval.status).toBe(201);
    expect(firstApproval.body.message.content).toContain("Garansi resmi");
    expect(replay.status).toBe(201);
    expect(replay.body.message.id).toBe(firstApproval.body.message.id);
  });

  it("blocks approval when the conversation was closed after draft generation", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });
    const cookie = serializeSessionCookie("bot-test-token-12345", false);
    const queued = (await request(app)
      .post("/api/v1/organizations/org1/bot/draft/c1")
      .set("Cookie", cookie)) as unknown as { body: { runId: string } };
    await db.query("TEST_COMPLETE_BOT_RUN", [queued.body.runId]);
    await db.query("TEST_CLOSE_CONVERSATION");

    const approval = (await request(app)
      .post(`/api/v1/organizations/org1/bot/draft-runs/${queued.body.runId}/action`)
      .set("Cookie", cookie)
      .send({ action: "approved" })) as unknown as {
      status: number;
      body: { code: string };
    };
    expect(approval.status).toBe(409);
    expect(approval.body.code).toBe("CONVERSATION_CLOSED");
  });

  it("blocks approval when emergency stop activates after draft generation", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });
    const cookie = serializeSessionCookie("bot-test-token-12345", false);
    const queued = (await request(app)
      .post("/api/v1/organizations/org1/bot/draft/c1")
      .set("Cookie", cookie)) as unknown as { body: { runId: string } };
    await db.query("TEST_COMPLETE_BOT_RUN", [queued.body.runId]);
    await request(app)
      .post("/api/v1/organizations/org1/bot/emergency-stop")
      .set("Cookie", cookie)
      .send({ enabled: true });

    const approval = (await request(app)
      .post(`/api/v1/organizations/org1/bot/draft-runs/${queued.body.runId}/action`)
      .set("Cookie", cookie)
      .send({ action: "approved" })) as unknown as {
      status: number;
      body: { code: string };
    };
    expect(approval.status).toBe(409);
    expect(approval.body.code).toBe("BOT_DISABLED");
  });

  it("triggers emergency stop for organization bot", async () => {
    const db = createMockDb();
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config }
    });

    const cookieHeader = serializeSessionCookie("bot-test-token-12345", false);

    const res = (await request(app)
      .post("/api/v1/organizations/org1/bot/emergency-stop")
      .set("Cookie", cookieHeader)
      .send({ enabled: true, reason: "Security incident detected" })) as unknown as {
      status: number;
      body: unknown;
    };

    expect(res.status).toBe(200);
    const body = res.body as { organizationId: string; emergencyDisabled: boolean };
    expect(body.organizationId).toBe("org1");
    expect(body.emergencyDisabled).toBe(true);
  });

  it("logs structured error details when draft enqueue transaction fails", async () => {
    const db = createMockDb();
    const originalQuery = db.query.bind(db);
    db.query = (async (sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO flowdesk.bot_runs")) {
        const error = new Error("Database transaction constraint violation") as Error & {
          code: string;
          detail: string;
          constraint: string;
        };
        error.code = "23505";
        error.detail = "Key (organization_id, conversation_id)=(org1, c1) already exists.";
        error.constraint = "bot_runs_pkey";
        throw error;
      }
      return originalQuery(sql, params);
    }) as typeof db.query;

    const loggedErrors: Array<Record<string, unknown>> = [];
    const app = createApiApp({
      service: "api",
      version: "dev",
      gitSha: "dev",
      environment: "local",
      auth: { db, config },
      logError: (event) => {
        loggedErrors.push(event);
      }
    });

    const cookie = serializeSessionCookie("bot-test-token-12345", false);
    const res = (await request(app)
      .post("/api/v1/organizations/org1/bot/draft/c1")
      .set("Cookie", cookie)
      .set("x-request-id", "req-test-123")
      .set("x-correlation-id", "corr-test-456")) as unknown as {
      status: number;
      body: { code?: string; detail?: string };
    };

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      code: "INTERNAL_ERROR",
      detail: "Failed to queue the AI draft."
    });

    expect(loggedErrors.length).toBeGreaterThan(0);
    const logged = loggedErrors[0]!;
    expect(logged).toMatchObject({
      requestId: "req-test-123",
      correlationId: "corr-test-456",
      organizationId: "org1",
      conversationId: "c1",
      errorMessage: "Database transaction constraint violation",
      errorCode: "23505",
      errorConstraint: "bot_runs_pkey",
      errorDetail: "Key (organization_id, conversation_id)=(org1, c1) already exists."
    });
  });
});
