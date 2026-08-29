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
            organization_id: "org1",
            channel_id: "ch1",
            contact_id: "cnt1",
            status: "open",
            priority: "normal",
            assigned_operator_user_id: null,
            assigned_queue_id: null,
            service_window_expires_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        ]
      };
    }

    if (sql.toLowerCase().includes("messages")) {
      return {
        rows: [
          {
            id: "msg1",
            organization_id: "org1",
            conversation_id: "c1",
            sender_type: "customer",
            sender_user_id: null,
            body_text: "Apakah garansi produk berlaku 1 tahun?",
            message_type: "text",
            status: "delivered",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
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

    if (sql.toLowerCase().includes("bot_runs")) {
      const runId = randomUUID();
      const mockRun = {
        id: runId,
        organization_id: "org1",
        conversation_id: "c1",
        trigger_message_id: null,
        bot_config_id: null,
        knowledge_version_id: null,
        mode: "draft",
        status: "drafted",
        suggested_content: "AI reply draft content",
        confidence_score: "0.85",
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
        latency_ms: 50,
        cost_estimate_microcents: 5,
        citations: [],
        reasoning: null,
        created_at: new Date()
      };
      botRuns.set(runId, mockRun);
      return { rows: [mockRun] };
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

  it("generates AI draft response with citations for a conversation", async () => {
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

    expect(res.status).toBe(200);
    const body = res.body as {
      status: string;
      runId: string;
      suggestedContent: string;
      citations: Array<{ documentTitle: string }>;
    };
    expect(body.status).toBe("drafted");
    expect(body.runId).toBeDefined();
    expect(body.suggestedContent).toBeDefined();
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0]?.documentTitle).toBe("Policy Guide");
  });
});
