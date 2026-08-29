import { describe, expect, it } from "vitest";
import type { DbClient } from "./auth.js";
import {
  addQueueMember,
  addTeamMember,
  createQueue,
  createTeam,
  listVisibleQueues,
  listTags,
  listConversationNotes,
  listConversationTags,
  listSavedFilters,
  createSavedFilter,
  deleteSavedFilter,
  removeQueueMember,
  type QueueRecord,
  type TeamRecord
} from "./operational-inbox.js";

function result<T>(rows: T[], rowCount = rows.length) {
  return { rows, rowCount, command: "TEST", oid: 0, fields: [] };
}

function recordingDb(responses: unknown[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const db = {
    async query(sql: string, values: unknown[] = []) {
      await Promise.resolve();
      calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
      return responses.shift() ?? result([]);
    }
  } as DbClient;
  return { db, calls };
}

const team: TeamRecord = {
  id: "team-1",
  organizationId: "org-1",
  name: "Support",
  slug: "support",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z")
};

const queue: QueueRecord = {
  id: "queue-1",
  organizationId: "org-1",
  teamId: "team-1",
  businessHoursPolicyId: null,
  slaPolicyId: null,
  name: "Support",
  slug: "support",
  routingStrategy: "manual",
  status: "active",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z")
};

describe("operational inbox persistence", () => {
  it("creates teams and restores team membership with a default capacity", async () => {
    const { db, calls } = recordingDb([result([team]), result([])]);

    expect(
      await createTeam(db, { organizationId: "org-1", name: "Support", slug: "support" })
    ).toBe(team);
    await addTeamMember(db, { organizationId: "org-1", teamId: "team-1", userId: "user-1" });

    expect(calls[0]!.values).toEqual(["org-1", "Support", "support"]);
    expect(calls[1]!.values).toEqual(["org-1", "team-1", "user-1", 10]);
    expect(calls[1]!.sql).toContain("ON CONFLICT");
  });

  it("creates queues with explicit policy bindings and routing", async () => {
    const { db, calls } = recordingDb([result([queue])]);

    expect(
      await createQueue(db, {
        organizationId: "org-1",
        name: "Support",
        slug: "support",
        teamId: "team-1",
        businessHoursPolicyId: "hours-1",
        slaPolicyId: "sla-1",
        routingStrategy: "least_loaded"
      })
    ).toBe(queue);
    expect(calls[0]!.values).toEqual([
      "org-1",
      "team-1",
      "hours-1",
      "sla-1",
      "Support",
      "support",
      "least_loaded"
    ]);
  });

  it("defaults optional queue policy bindings and routing", async () => {
    const { db, calls } = recordingDb([result([queue])]);
    await createQueue(db, { organizationId: "org-1", name: "Support", slug: "support" });
    expect(calls[0]!.values).toEqual(["org-1", null, null, null, "Support", "support", "manual"]);
  });

  it("restores queue membership and removes active membership", async () => {
    const { db, calls } = recordingDb([result([]), result([], 1), result([], 0)]);

    await addQueueMember(db, {
      organizationId: "org-1",
      queueId: "queue-1",
      userId: "user-1"
    });
    expect(
      await removeQueueMember(db, {
        organizationId: "org-1",
        queueId: "queue-1",
        userId: "user-1"
      })
    ).toBe(true);
    expect(
      await removeQueueMember(db, {
        organizationId: "org-1",
        queueId: "queue-1",
        userId: "user-1"
      })
    ).toBe(false);

    expect(calls[0]!.values).toEqual(["org-1", "queue-1", "user-1", "agent"]);
    expect(calls[1]!.sql).toContain("status = 'active'");
  });

  it("lists only currently visible queues and keeps elevated access explicit", async () => {
    const { db, calls } = recordingDb([result([queue]), result([queue])]);

    expect(await listVisibleQueues(db, { organizationId: "org-1", userId: "user-1" })).toEqual([
      queue
    ]);
    await listVisibleQueues(db, {
      organizationId: "org-1",
      userId: "supervisor-1",
      canManageAllQueues: true
    });

    expect(calls[0]!.values).toEqual(["org-1", "user-1", false]);
    expect(calls[0]!.sql).toContain("queue_member.status = 'active'");
    expect(calls[1]!.values).toEqual(["org-1", "supervisor-1", true]);
  });

  it("reads private collaboration resources inside tenant-scoped queries", async () => {
    const tag = { id: "tag-1", organizationId: "org-1", name: "VIP", color: "#FF0000" };
    const note = { id: "note-1", authorUserId: "user-1", body: "Internal", createdAt: new Date() };
    const filter = {
      id: "filter-1",
      name: "Mine",
      definition: { assignedTo: "me" },
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const { db, calls } = recordingDb([
      result([tag]),
      result([note]),
      result([tag]),
      result([filter])
    ]);
    expect(await listTags(db, "org-1")).toEqual([tag]);
    expect(await listConversationNotes(db, "org-1", "conv-1")).toEqual([note]);
    expect(await listConversationTags(db, "org-1", "conv-1")).toEqual([tag]);
    expect(await listSavedFilters(db, "org-1", "user-1")).toEqual([filter]);
    expect(calls.every((call) => call.values[0] === "org-1")).toBe(true);
  });

  it("upserts and deletes only the active user's saved filters", async () => {
    const filter = {
      id: "filter-1",
      name: "Urgent",
      definition: { status: "open" },
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const { db, calls } = recordingDb([result([]), result([filter]), result([], 1)]);
    expect(
      await createSavedFilter(db, {
        organizationId: "org-1",
        userId: "user-1",
        name: "Urgent",
        definition: { status: "open" },
        isDefault: true
      })
    ).toBe(filter);
    expect(await deleteSavedFilter(db, "org-1", "user-1", "filter-1")).toBe(true);
    expect(calls[2]!.values).toEqual(["org-1", "user-1", "filter-1"]);
  });
});
