import type {
  AppendEventInput,
  EventEnvelope,
  Task,
  TaskStatus,
} from "@nexora/contracts";
import type { NexoraClient } from "@nexora/sdk-ts";

/**
 * Adapter surface for NILA (VS Code / GitHub Copilot).
 *
 * NILA is the second Phase 0 integration. The transport from the editor to the
 * Core API is not decided yet, so this package only defines the typed calls a
 * future extension or CLI will make. Methods hit the real API and throw on
 * failure; nothing here reports success on its own.
 */
export interface NilaCopilotAdapterOptions {
  client: NexoraClient;
  /** UUID of the `nila` identity row. */
  identityId: string;
}

export type NilaEventDraft = Omit<AppendEventInput, "actorId">;

export class NilaCopilotAdapter {
  readonly identityId: string;
  private readonly client: NexoraClient;

  constructor(options: NilaCopilotAdapterOptions) {
    this.identityId = options.identityId;
    this.client = options.client;
  }

  emit(draft: NilaEventDraft): Promise<EventEnvelope> {
    return this.client.events.append({ ...draft, actorId: this.identityId });
  }

  reportTaskStatusChanged(
    task: Task,
    previousStatus: TaskStatus,
  ): Promise<EventEnvelope> {
    return this.emit({
      type: "task.status_changed",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        from: previousStatus,
        to: task.status,
        version: task.version,
        reportedBy: "nila-copilot",
      },
      correlationId: null,
      causationId: null,
      schemaVersion: 1,
      visibility: "internal",
    });
  }

  reportNote(message: string, topic?: string): Promise<EventEnvelope> {
    return this.emit({
      type: "system.note",
      aggregateType: "system",
      aggregateId: null,
      payload: {
        originIdentity: "nila",
        message,
        ...(topic === undefined ? {} : { topic }),
      },
      correlationId: null,
      causationId: null,
      schemaVersion: 1,
      visibility: "internal",
    });
  }
}
