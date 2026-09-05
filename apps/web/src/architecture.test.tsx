// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { queryClient } from "./lib/query-client.js";
import { ApiError } from "./api.js";
import { conversationsKeys } from "./features/inbox/query-keys.js";
import { developerKeys } from "./features/developer/query-keys.js";
import { channelsKeys } from "./features/channels/query-keys.js";
import { teamKeys } from "./features/team/query-keys.js";
import { analyticsKeys } from "./features/analytics/query-keys.js";
import { knowledgeKeys } from "./features/knowledge/query-keys.js";
import { workspaceKeys } from "./features/workspace/query-keys.js";
import { handleRealtimeHint, handleRealtimeReconciliation } from "./lib/realtime-adapter.js";
import type { RealtimeHint } from "@flowdesk/contracts";

describe("Architecture Modernization (UI-02 / Issue #216)", () => {
  describe("Query Client Policies", () => {
    it("configures non-aggressive retry logic respecting 401, 403, and 404", () => {
      const defaultOptions = queryClient.getDefaultOptions();
      const retryFn = defaultOptions.queries?.retry as (
        failureCount: number,
        error: unknown
      ) => boolean;
      expect(retryFn).toBeDefined();

      // Should not retry on ApiError with 401, 403, 404
      expect(retryFn(0, new ApiError("unauthorized", 401))).toBe(false);
      expect(retryFn(0, new ApiError("forbidden", 403))).toBe(false);
      expect(retryFn(0, new ApiError("not found", 404))).toBe(false);

      // Should retry network or other errors up to 2 times
      expect(retryFn(0, new Error("network error"))).toBe(true);
      expect(retryFn(1, new Error("network error"))).toBe(true);
      expect(retryFn(2, new Error("network error"))).toBe(false);
    });

    it("has refetchOnWindowFocus disabled globally", () => {
      const defaultOptions = queryClient.getDefaultOptions();
      expect(defaultOptions.queries?.refetchOnWindowFocus).toBe(false);
    });

    it("has refetchOnReconnect enabled globally", () => {
      const defaultOptions = queryClient.getDefaultOptions();
      expect(defaultOptions.queries?.refetchOnReconnect).toBe(true);
    });
  });

  describe("Centralized Query Key Factories & Tenant Isolation", () => {
    const orgA = "org-alpha-1111";
    const orgB = "org-bravo-2222";

    it("enforces tenant boundary isolation across query keys", () => {
      expect(conversationsKeys.all(orgA)).not.toEqual(conversationsKeys.all(orgB));
      expect(conversationsKeys.list(orgA, { status: "open" })).not.toEqual(
        conversationsKeys.list(orgB, { status: "open" })
      );
      expect(developerKeys.apiKeys(orgA)).not.toEqual(developerKeys.apiKeys(orgB));
      expect(teamKeys.members(orgA)).not.toEqual(teamKeys.members(orgB));
      expect(analyticsKeys.metrics(orgA, 14)).not.toEqual(analyticsKeys.metrics(orgB, 14));
      expect(knowledgeKeys.sources(orgA)).not.toEqual(knowledgeKeys.sources(orgB));
      expect(workspaceKeys.details(orgA)).not.toEqual(workspaceKeys.details(orgB));
      expect(channelsKeys.list(orgA)).not.toEqual(channelsKeys.list(orgB));
    });

    it("produces deterministic query key tuples", () => {
      const listKey1 = conversationsKeys.list(orgA, { status: "pending", queueId: "q-1" });
      const listKey2 = conversationsKeys.list(orgA, { status: "pending", queueId: "q-1" });
      expect(listKey1).toEqual(listKey2);

      const detailKey = conversationsKeys.detail(orgA, "conv-123");
      expect(detailKey).toEqual(["organizations", orgA, "conversations", "detail", "conv-123"]);

      const webhookDeliveriesKey = developerKeys.webhookDeliveries(orgA, "sub-456");
      expect(webhookDeliveriesKey).toEqual([
        "organizations",
        orgA,
        "developer",
        "webhooks",
        "sub-456",
        "deliveries"
      ]);
    });
  });

  describe("Realtime Hint Invalidation Adapter", () => {
    it("invalidates conversation and message queries on conversation hints", () => {
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      const hint: RealtimeHint = {
        schemaVersion: 1,
        organizationId: "b0000000-0000-4000-8000-000000000001",
        resourceType: "conversation",
        resourceId: "c0000000-0000-4000-8000-000000000001",
        version: 1
      };

      handleRealtimeHint(queryClient, hint);

      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: conversationsKeys.detail(
            "b0000000-0000-4000-8000-000000000001",
            "c0000000-0000-4000-8000-000000000001"
          )
        })
      );
      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: conversationsKeys.lists("b0000000-0000-4000-8000-000000000001")
        })
      );

      invalidateQueriesSpy.mockRestore();
    });

    it("invalidates team queries on team hint", () => {
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      const hint: RealtimeHint = {
        schemaVersion: 1,
        organizationId: "b0000000-0000-4000-8000-000000000001",
        resourceType: "team",
        resourceId: "d0000000-0000-4000-8000-000000000001",
        version: 1
      };

      handleRealtimeHint(queryClient, hint);

      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: teamKeys.members("b0000000-0000-4000-8000-000000000001")
        })
      );

      invalidateQueriesSpy.mockRestore();
    });

    it("invalidates tenant conversations upon reconnect reconciliation", () => {
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      handleRealtimeReconciliation(queryClient, "org-reconcile");

      expect(invalidateQueriesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: conversationsKeys.all("org-reconcile")
        })
      );

      invalidateQueriesSpy.mockRestore();
    });
  });
});
