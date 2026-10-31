import type { AppendNoteInput, EventEnvelope, Identity } from "@nexora/contracts";
import type { NexoraClient } from "@nexora/sdk-ts";

/**
 * Tier A adapter surface for EV (OpenCode).
 *
 * The actor is the identity bound to the client credential, so this class no
 * longer accepts an identity UUID. It cannot create tasks, decisions or
 * permissions through a raw event call: those are Core business operations and
 * emit their own events.
 *
 * There is no autonomous loop and no simulated behaviour. Every method performs
 * a real request and throws on failure.
 */
export class EvOpenCodeAdapter {
  private readonly client: NexoraClient;

  constructor(client: NexoraClient) {
    this.client = client;
  }

  /** The identity this adapter acts as, according to the server. */
  me(): Promise<Identity> {
    return this.client.whoami();
  }

  /** Record a non-domain note. Domain events are emitted by the Core API. */
  note(input: AppendNoteInput): Promise<EventEnvelope> {
    return this.client.events.note(input);
  }
}
