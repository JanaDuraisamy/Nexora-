import { describe, expect, it } from "vitest";
import {
  appendEventInputSchema,
  canTransitionTaskStatus,
  createIdentityInputSchema,
  createTaskInputSchema,
  decideDecisionInputSchema,
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
  it("defaults append input to schema version 1 and internal visibility", () => {
    const parsed = appendEventInputSchema.parse({
      type: "system.note",
      aggregateType: "system",
      actorId: IDENTITY_ID,
    });

    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.visibility).toBe("internal");
    expect(parsed.aggregateId).toBeNull();
    expect(parsed.payload).toEqual({});
  });

  it("rejects unknown event types", () => {
    const result = appendEventInputSchema.safeParse({
      type: "task.exploded",
      aggregateType: "task",
      actorId: IDENTITY_ID,
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed aggregate identifiers", () => {
    const result = appendEventInputSchema.safeParse({
      type: "task.created",
      aggregateType: "task",
      aggregateId: "not-a-uuid",
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
      createdBy: IDENTITY_ID,
    });

    expect(parsed.priority).toBe("normal");
    expect(parsed.assigneeId).toBeNull();
    expect(parsed.description).toBeNull();
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
    const input = {
      rationale: "Approved during Phase 0 review.",
      decidedBy: IDENTITY_ID,
    };

    expect(decideDecisionInputSchema.safeParse({ ...input, status: "approved" }).success).toBe(true);
    expect(decideDecisionInputSchema.safeParse({ ...input, status: "superseded" }).success).toBe(false);
  });
});
