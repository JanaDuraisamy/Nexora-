import type { EventEnvelope } from "@nexora/contracts";
import type { NexoraClient } from "@nexora/sdk-ts";

/**
 * Tier C (human relay) bridge for RIN.
 *
 * EV has no direct access to RIN's context. Information attributed to RIN
 * reaches the hub only through Jana. The event actor is therefore the relaying
 * human, and the payload records `originIdentity: "rin"` with
 * `channel: "human_relay"`.
 */
export interface RinBridgeOptions {
  client: NexoraClient;
  /** UUID of the human identity relaying the message, normally Jana. */
  relayedByIdentityId: string;
}

export interface RelayedNoteInput {
  message: string;
  topic?: string;
  correlationId?: string | null;
}

export class RinBridge {
  readonly relayedByIdentityId: string;
  private readonly client: NexoraClient;

  constructor(options: RinBridgeOptions) {
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
        originIdentity: "rin",
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
