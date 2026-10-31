import type { EventEnvelope } from "@nexora/contracts";
import type { NexoraClient } from "@nexora/sdk-ts";

/**
 * Tier C (human relay) adapter for ELIO.
 *
 * NEXORA has no direct channel to ELIO's runtime. A human — Jana — carries
 * ELIO's contribution into the hub. The event actor is the human bound to the
 * client credential, which the server verifies; the payload records the
 * assertion `originIdentity: "elio"` plus `channel: "human_relay"`.
 *
 * The credential passed to the client must belong to the relaying human.
 */
export interface RelayedNoteInput {
  message: string;
  topic?: string;
  correlationId?: string | null;
}

export class ElioRelayAdapter {
  private readonly client: NexoraClient;

  constructor(client: NexoraClient) {
    this.client = client;
  }

  submitNote(input: RelayedNoteInput): Promise<EventEnvelope> {
    const message = input.message.trim();
    if (message.length === 0) {
      throw new Error("A relayed message cannot be empty");
    }

    return this.client.events.note({
      message,
      topic: input.topic ?? null,
      metadata: {
        originIdentity: "elio",
        channel: "human_relay",
      },
      correlationId: input.correlationId ?? null,
    });
  }
}
