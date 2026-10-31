import { describe, expect, it } from "vitest";
import {
  appendNoteInputSchema,
  assignTaskInputSchema,
  canTransitionTaskStatus,
  claimTaskInputSchema,
  createIdentityInputSchema,
  createTaskInputSchema,
  decideDecisionInputSchema,
  grantPermissionInputSchema,
  identitySchema,
  taskSchema,
} from "./index.js";

const IDENTITY_ID = "00000000-0000-4000-8000-000000000002";

describe("identity contracts", () => {
  it("applies defaults for identity creation", () => {
    const parsed = createIdentityInputSchema.parse({
      handle: "ev",
      displayName: "EV",
      kind: "ai_agent",
      tier: "tier_a",
    });

    expect(parsed.status).toBe("active");
    expect(parsed.adapterKey).toBeNull();
    expect(parsed.metadata).toEqual({});
  });

  it("rejects malformed handles", () => {
    const result = createIdentityInputSchema.safeParse({
      handle: "EV Agent",
      displayName: "EV",
      kind: "ai_agent",
      tier: "tier_a",
    });

    expect(result.success).toBe(false);
  });

  it("validates a persisted identity", () => {
    const parsed = identitySchema.parse({
      id: IDENTITY_ID,
      handle: "ev",
      displayName: "EV",
      kind: "ai_agent",
      tier: "tier_a",
      status: "active",
      adapterKey: "ev-opencode",
      metadata: {},
      createdAt: "2026-10-31T10:00:00.000Z",
      updatedAt: "2026-10-31T10:00:00.000Z",
    });

    expect(parsed.id).toBe(IDENTITY_ID);
  });
});

describe("event contracts", () => {
  it("defaults a note to internal visibility and a null topic", () => {
    const parsed = appendNoteInputSchema.parse({ message: "Reviewed the build" });

    expect(parsed.visibility).toBe("internal");
    expect(parsed.topic).toBeNull();
    expect(parsed.metadata).toEqual({});
  });

  it("has no actor field: identity is derived from the credential", () => {
    const result = appendNoteInputSchema.safeParse({
      message: "note",
      actorId: IDENTITY_ID,
    });

    expect(result.success).toBe(false);
  });
});

describe("task contracts", () => {
  it("enforces the task transition table", () => {
    expect(canTransitionTaskStatus("backlog", "ready")).toBe(true);
    expect(canTransitionTaskStatus("in_progress", "done")).toBe(true);
    expect(canTransitionTaskStatus("done", "in_progress")).toBe(false);
    expect(canTransitionTaskStatus("backlog", "done")).toBe(false);
  });

  it("defaults new task priority and status fields", () => {
    const parsed = createTaskInputSchema.parse({
      title: "Wire the health endpoint",
    });

    expect(parsed.priority).toBe("normal");
    expect(parsed.assigneeId).toBeNull();
    expect(parsed.description).toBeNull();
  });

  it("rejects a client-supplied creator", () => {
    const result = createTaskInputSchema.safeParse({
      title: "Task",
      createdBy: IDENTITY_ID,
    });

    expect(result.success).toBe(false);
  });

  it("requires an assignee field so release is explicit", () => {
    expect(
      assignTaskInputSchema.safeParse({ expectedVersion: 1 }).success,
    ).toBe(false);
    expect(
      assignTaskInputSchema.safeParse({ assigneeId: null, expectedVersion: 1 })
        .success,
    ).toBe(true);
  });

  it("validates claim input", () => {
    expect(claimTaskInputSchema.safeParse({ expectedVersion: 2 }).success).toBe(
      true,
    );
    expect(claimTaskInputSchema.safeParse({ expectedVersion: 0 }).success).toBe(
      false,
    );
  });

  it("keeps task versions positive", () => {
    const result = taskSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000010",
      title: "Task",
      description: null,
      status: "backlog",
      priority: "normal",
      createdBy: IDENTITY_ID,
      assigneeId: null,
      parentTaskId: null,
      dueAt: null,
      metadata: {},
      version: 0,
      createdAt: "2026-10-31T10:00:00.000Z",
      updatedAt: "2026-10-31T10:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("decision contracts", () => {
  it("only permits approve or reject decisions", () => {
    const input = { rationale: "Approved during Phase 0 review." };

    expect(
      decideDecisionInputSchema.safeParse({ ...input, status: "approved" })
        .success,
    ).toBe(true);
    expect(
      decideDecisionInputSchema.safeParse({ ...input, status: "superseded" })
        .success,
    ).toBe(false);
  });

  it("does not accept a decider in the body", () => {
    const result = decideDecisionInputSchema.safeParse({
      status: "approved",
      rationale: "Looks good",
      decidedBy: IDENTITY_ID,
    });

    expect(result.success).toBe(false);
  });
});

describe("permission contracts", () => {
  it("defaults a grant to global scope with no expiry", () => {
    const parsed = grantPermissionInputSchema.parse({
      identityId: IDENTITY_ID,
      resourceType: "task",
      action: "read",
    });

    expect(parsed.resourceId).toBeNull();
    expect(parsed.expiresAt).toBeNull();
  });

  it("requires a known resource and action", () => {
    const result = grantPermissionInputSchema.safeParse({
      identityId: IDENTITY_ID,
      resourceType: "database",
      action: "drop",
    });

    expect(result.success).toBe(false);
  });
});
