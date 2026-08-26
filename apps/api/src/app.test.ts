import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApiApp } from "./app.js";

const app = createApiApp({
  service: "api",
  version: "test",
  gitSha: "test-sha",
  environment: "local"
});

describe("API foundation", () => {
  it("serves readiness and a request id", async () => {
    const response = await request(app).get("/readyz").expect(200);
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
    expect(response.body).toMatchObject({ status: "ready" });
  });

  it("uses the problem+json error envelope", async () => {
    const response = await request(app).get("/missing").expect(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.body).toMatchObject({ code: "RESOURCE_NOT_FOUND", status: 404 });
  });
});
