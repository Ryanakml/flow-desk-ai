import request from "supertest";
import { describe, expect, it } from "vitest";
import { createIngressApp } from "./app.js";

describe("ingress skeleton", () => {
  it("is healthy without accepting real webhooks", async () => {
    const response = await request(createIngressApp()).get("/readyz").expect(200);
    expect(response.body).toEqual({ status: "ready", acceptingWebhooks: false });
  });
});
