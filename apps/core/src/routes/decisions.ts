import {
  decideDecisionInputSchema,
  decisionListSchema,
  decisionSchema,
  listDecisionsQuerySchema,
  proposeDecisionInputSchema,
} from "@nexora/contracts";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { Database } from "../db.js";
import { requireActiveIdentity, requirePermission } from "../http/authorization.js";
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
  db: Database;
}

export const decisionRoutes: FastifyPluginAsync<DecisionRoutesOptions> = async (
  app,
  options,
) => {
  app.post("/decisions", async (request, reply) => {
    const input = parseInput(proposeDecisionInputSchema, request.body);

    const decision = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, input.proposedBy);
      await requirePermission(q, input.proposedBy, "decision", "write");

      const created = await insertDecision(q, input);
      await appendEvent(q, {
        type: "decision.proposed",
        aggregateType: "decision",
        aggregateId: created.id,
        actorId: input.proposedBy,
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
    const query = parseInput(listDecisionsQuerySchema, request.query);
    const items = await listDecisions(options.db, query);
    return decisionListSchema.parse({ items });
  });

  app.get("/decisions/:id", async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const decision = await findDecisionById(options.db, id);
    if (!decision) {
      throw notFound(`Decision ${id} was not found`);
    }

    return decisionSchema.parse(decision);
  });

  app.post("/decisions/:id/decide", async (request) => {
    const { id } = parseInput(idParamsSchema, request.params);
    const input = parseInput(decideDecisionInputSchema, request.body);

    const decision = await options.db.withTransaction(async (q) => {
      await requireActiveIdentity(q, input.decidedBy);
      await requirePermission(q, input.decidedBy, "decision", "approve", id);

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
        input.decidedBy,
        input.expectedVersion ?? null,
      );
      if (!updated) {
        throw conflict("Decision was modified concurrently; reload and retry");
      }

      await appendEvent(q, {
        type: "decision.decided",
        aggregateType: "decision",
        aggregateId: id,
        actorId: input.decidedBy,
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
