import {
  decideDecisionInputSchema,
  decisionListSchema,
  decisionSchema,
  listDecisionsQuerySchema,
  proposeDecisionInputSchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { DatabasePort } from "../db.js";
import { currentActor } from "../http/actor.js";
import {
  requireActiveIdentity,
  requirePermission,
} from "../http/authorization.js";
import { conflict, notFound } from "../http/errors.js";
import { parseInput } from "../http/validation.js";
import {
  applyDecision,
  findDecisionById,
  insertDecision,
  listDecisions,
} from "../repositories/decisions.js";
import { appendEvent } from "../repositories/events.js";

const idParamsSchema = z.object({ id: z.uuid() });

export interface DecisionRoutesOptions {
  db: DatabasePort;
}

export const decisionRoutes: FastifyPluginAsync<DecisionRoutesOptions> = async (
  app,
  options,
) => {
  app.post("/decisions", async (request, reply) => {
    const actor = currentActor(request);
    const input = parseInput(proposeDecisionInputSchema, request.body);

    const decision = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "decision", "write");

      const created = await insertDecision(q, input, actor.id);
      await appendEvent(q, {
        type: "decision.proposed",
        aggregateType: "decision",
        aggregateId: created.id,
        actorId: actor.id,
        payload: {
          title: created.title,
          adrPath: created.adrPath,
          supersedesId: created.supersedesId,
        },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
      });

      return created;
    });

    reply.code(201);
    return decisionSchema.parse(decision);
  });

  app.get("/decisions", async (request) => {
    const actor = currentActor(request);
    const query = parseInput(listDecisionsQuerySchema, request.query);

    await requirePermission(options.db, actor.id, "decision", "read");
    const items = await listDecisions(options.db, query);
    return decisionListSchema.parse({ items });
  });

  app.get("/decisions/:id", async (request) => {
    const actor = currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);

    const decision = await findDecisionById(options.db, id);
    if (!decision) {
      throw notFound(`Decision ${id} was not found`);
    }

    // A proposer may always see their own decision, mirroring the RLS select
    // policy. Everyone else needs an explicit read grant.
    if (decision.proposedBy !== actor.id) {
      await requirePermission(options.db, actor.id, "decision", "read", id);
    }

    return decisionSchema.parse(decision);
  });

  /**
   * Approve or reject a decision.
   *
   * The deciding identity is the authenticated actor; the body cannot name a
   * different decider. Approval requires `decision:approve` on the decision.
   */
  app.post("/decisions/:id/decide", async (request) => {
    const actor = currentActor(request);
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(decideDecisionInputSchema, request.body);

    const decision = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, actor.id);
      await requirePermission(q, actor.id, "decision", "approve", id);

      const current = await findDecisionById(q, id);
      if (!current) {
        throw notFound(`Decision ${id} was not found`);
      }

      if (current.status !== "proposed") {
        throw conflict(`Decision ${id} is already ${current.status}`);
      }

      if (
        input.expectedVersion !== undefined &&
        current.version !== input.expectedVersion
      ) {
        throw conflict("Decision version mismatch", {
          expectedVersion: input.expectedVersion,
          actualVersion: current.version,
        });
      }

      const updated = await applyDecision(
        q,
        id,
        input.status,
        input.rationale,
        actor.id,
        input.expectedVersion ?? null,
      );
      if (!updated) {
        throw conflict("Decision was modified concurrently; reload and retry");
      }

      await appendEvent(q, {
        type: "decision.decided",
        aggregateType: "decision",
        aggregateId: id,
        actorId: actor.id,
        payload: {
          status: updated.status,
          resolution: updated.resolution,
          version: updated.version,
        },
        correlationId: null,
        causationId: null,
        schemaVersion: 1,
        visibility: "internal",
      });

      return updated;
    });

    return decisionSchema.parse(decision);
  });
};
