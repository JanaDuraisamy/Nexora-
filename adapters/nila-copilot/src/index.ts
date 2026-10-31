import type {
  AppendNoteInput,
  EventEnvelope,
  Identity,
  ListEventsQuery,
  Task,
  TaskList,
  UpdateTaskStatusInput,
} from "@nexora/contracts";
import { NexoraClient } from "@nexora/sdk-ts";

/**
 * Tier B, pull-only HTTP adapter surface for NILA (VS Code / GitHub Copilot).
 *
 * NILA polls the Core API through the shared HTTP SDK. There is no push,
 * websocket, remote trigger, or editor integration in this package.
 *
 * The actor is the identity bound to the client credential. Domain mutations go
 * through task endpoints so the API can enforce transitions and emit events.
 */
export class NilaCopilotAdapter {
  private readonly client: NexoraClient;

  constructor(options: NilaCopilotAdapterOptions) {
    if (options.apiToken.trim().length === 0) {
      throw new Error("A NILA per-identity API credential is required");
    }

    const apiUrl = new URL(options.apiUrl);
    const isLoopback =
      apiUrl.hostname === "localhost" ||
      apiUrl.hostname === "127.0.0.1" ||
      apiUrl.hostname === "[::1]";
    if (
      apiUrl.protocol !== "https:" &&
      !(apiUrl.protocol === "http:" && isLoopback)
    ) {
      throw new Error("NILA API credentials require HTTPS outside loopback");
    }

    this.client = new NexoraClient({
      baseUrl: apiUrl.toString(),
      apiToken: options.apiToken,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  }

  me(): Promise<Identity> {
    return this.client.whoami();
  }

  /** Tasks assigned to this identity, newest first. */
  async listMyTasks(limit = 50): Promise<TaskList> {
    const me = await this.me();
    return this.client.tasks.list({ assigneeId: me.id, limit });
  }

  getTask(id: string): Promise<Task> {
    return this.client.tasks.get(id);
  }

  /** Atomically claim an unassigned task for this identity. */
  claimTask(id: string, expectedVersion: number): Promise<Task> {
    return this.client.tasks.claim(id, { expectedVersion });
  }

  updateStatus(id: string, input: UpdateTaskStatusInput): Promise<Task> {
    return this.client.tasks.updateStatus(id, input);
  }

  /**
   * Poll the durable event log after a cursor.
   *
   * Callers keep the returned `nextSeq` and pass it back to resume. This is the
   * only delivery mechanism available in Phase 0.
   */
  pollEvents(
    afterSeq?: number,
    limit?: number,
  ): Promise<{ items: EventEnvelope[]; nextSeq: number | null }> {
    const query: Partial<ListEventsQuery> = {};
    if (afterSeq !== undefined) {
      query.afterSeq = afterSeq;
    }
    if (limit !== undefined) {
      query.limit = limit;
    }

    return this.client.events.list(query);
  }

  note(input: AppendNoteInput): Promise<EventEnvelope> {
    return this.client.events.note(input);
  }
}

export interface NilaCopilotAdapterOptions {
  /** Core API URL; use HTTPS outside local development. */
  apiUrl: string;
  /** The per-identity credential issued for NILA, supplied by the host at runtime. */
  apiToken: string;
  /** Injectable transport for tests or a compatible host runtime. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}
