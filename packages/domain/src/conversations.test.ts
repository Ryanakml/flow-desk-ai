import { describe, expect, it } from "vitest";
import {
  assertValidConversationStatusTransition,
  assertValidMessageStatusTransition,
  canTransitionConversationStatus,
  canTransitionMessageStatus
} from "./conversations.js";

describe("Conversation State Machine (M2-05)", () => {
  it("permits identical self transitions as no-op", () => {
    expect(canTransitionConversationStatus("new", "new")).toBe(true);
    expect(canTransitionConversationStatus("open", "open")).toBe(true);
    expect(canTransitionConversationStatus("closed", "closed")).toBe(true);
  });

  it("permits valid conversation status progressions", () => {
    // new -> open | closed
    expect(canTransitionConversationStatus("new", "open")).toBe(true);
    expect(canTransitionConversationStatus("new", "closed")).toBe(true);

    // open -> pending | resolved | closed
    expect(canTransitionConversationStatus("open", "pending")).toBe(true);
    expect(canTransitionConversationStatus("open", "resolved")).toBe(true);
    expect(canTransitionConversationStatus("open", "closed")).toBe(true);

    // pending -> open | resolved | closed
    expect(canTransitionConversationStatus("pending", "open")).toBe(true);
    expect(canTransitionConversationStatus("pending", "resolved")).toBe(true);
    expect(canTransitionConversationStatus("pending", "closed")).toBe(true);

    // resolved -> open | closed
    expect(canTransitionConversationStatus("resolved", "open")).toBe(true);
    expect(canTransitionConversationStatus("resolved", "closed")).toBe(true);

    // closed -> open (reopened upon customer reply)
    expect(canTransitionConversationStatus("closed", "open")).toBe(true);
  });

  it("denies and throws on illegal conversation status transitions", () => {
    // new cannot jump directly to resolved or pending
    expect(canTransitionConversationStatus("new", "resolved")).toBe(false);
    expect(canTransitionConversationStatus("new", "pending")).toBe(false);
    expect(() => assertValidConversationStatusTransition("new", "resolved")).toThrow(
      "Invalid conversation status transition from 'new' to 'resolved'."
    );

    // closed cannot jump to pending or resolved directly without opening
    expect(canTransitionConversationStatus("closed", "pending")).toBe(false);
    expect(canTransitionConversationStatus("closed", "resolved")).toBe(false);
    expect(() => assertValidConversationStatusTransition("closed", "pending")).toThrow(
      "Invalid conversation status transition from 'closed' to 'pending'."
    );
  });
});

describe("Message Status Progression (M2-05)", () => {
  it("permits standard forward lifecycle: queued -> sent -> delivered -> read", () => {
    expect(canTransitionMessageStatus("queued", "sent")).toBe(true);
    expect(canTransitionMessageStatus("sent", "delivered")).toBe(true);
    expect(canTransitionMessageStatus("delivered", "read")).toBe(true);
  });

  it("permits failure transitions and retry from failed back to queued", () => {
    expect(canTransitionMessageStatus("queued", "failed")).toBe(true);
    expect(canTransitionMessageStatus("sent", "failed")).toBe(true);
    expect(canTransitionMessageStatus("delivered", "failed")).toBe(true);
    expect(canTransitionMessageStatus("failed", "queued")).toBe(true);
  });

  it("denies invalid backward transitions from read or delivered", () => {
    expect(canTransitionMessageStatus("read", "sent")).toBe(false);
    expect(canTransitionMessageStatus("read", "queued")).toBe(false);
    expect(canTransitionMessageStatus("delivered", "sent")).toBe(false);
    expect(() => assertValidMessageStatusTransition("read", "sent")).toThrow(
      "Invalid message status transition from 'read' to 'sent'."
    );
  });
});
