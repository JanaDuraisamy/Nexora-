import type { EventEnvelope } from "@nexora/contracts";
import type { NexoraClient } from "@nexora/sdk-ts";

/**
 * Tier C (human relay) bridge for RIN.
 *
 * EV has no direct access to RIN's context. Information attributed to RIN
 * reaches the hub only through a human. The event actor is the human bound to
 * the client credential — verified by the server — and the payload records the
 * assertion `originIdentity: "rin"` with `channel: "human_relay"`.
 *
 * The credential passed to the client must belong to the relaying human (Jana in
 * Phase 0). Origin attribution is an explicit, auditable claim; the actor is not.
 */
export interface RelayedNoteInput {
  message: string;
  topic?: string;
  correlationId?: string | null;
}

export class RinBridge {
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
        originIdentity: "rin",
        channel: "human_relay",
      },
      correlationId: input.correlationId ?? null,
    });
  }
}
