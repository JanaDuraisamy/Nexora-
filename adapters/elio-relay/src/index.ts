import type { EventEnvelope } from "@nexora/contracts";
import type { NexoraClient } from "@nexora/sdk-ts";

/**
 * Tier C (human relay) adapter for ELIO.
 *
 * NEXORA has no direct channel to ELIO's runtime. A human — Jana — carries
 * ELIO's contribution into the hub. Provenance is explicit: the event actor is
 * the relaying human (`relayedByIdentityId`, normally Jana) and the payload
 * records `originIdentity: "elio"` plus `channel: "human_relay"`.
 */
export interface ElioRelayAdapterOptions {
  client: NexoraClient;
  /** UUID of the human identity relaying the message, normally Jana. */
  relayedByIdentityId: string;
}

export interface RelayedNoteInput {
  message: string;
  topic?: string;
  correlationId?: string | null;
}

export class ElioRelayAdapter {
  readonly relayedByIdentityId: string;
  private readonly client: NexoraClient;

  constructor(options: ElioRelayAdapterOptions) {
    if (options.relayedByIdentityId.length === 0) {
      throw new Error("A relaying human identity is required");
    }

    this.relayedByIdentityId = options.relayedByIdentityId;
    this.client = options.client;
  }

  submitNote(input: RelayedNoteInput): Promise<EventEnvelope> {
    const message = input.message.trim();
    if (message.length === 0) {
      throw new Error("A relayed message cannot be empty");
    }

    return this.client.events.append({
      type: "system.note",
      aggregateType: "system",
      aggregateId: null,
      actorId: this.relayedByIdentityId,
      payload: {
        originIdentity: "elio",
        channel: "human_relay",
        message,
        ...(input.topic === undefined ? {} : { topic: input.topic }),
      },
      correlationId: input.correlationId ?? null,
      causationId: null,
      schemaVersion: 1,
      visibility: "internal",
    });
  }
}
