import { describe, expect, it, vi } from "vitest";
import { getBuildInfo } from "./api.js";

describe("typed API client", () => {
  it("validates build information", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ service: "api", version: "test", gitSha: "abc", environment: "local" }),
          { status: 200 }
        )
      );
    await expect(getBuildInfo(fetcher)).resolves.toMatchObject({ service: "api", gitSha: "abc" });
  });
});
