import type {
  AppendEventInput,
  EventEnvelope,
  Task,
  TaskStatus,
} from "@nexora/contracts";
import type { NexoraClient } from "@nexora/sdk-ts";

/**
 * Tier A adapter surface for EV (OpenCode).
 *
 * This package deliberately contains no autonomous loop and no simulated
 * behaviour. Callers (an OpenCode tool/plugin, or EV during a session) invoke
 * these methods, which write to the real Core API and throw on failure.
 */
export interface EvOpenCodeAdapterOptions {
  client: NexoraClient;
  /** UUID of the `ev` identity row. */
  identityId: string;
}

export type EvEventDraft = Omit<AppendEventInput, "actorId">;

export class EvOpenCodeAdapter {
  readonly identityId: string;
  private readonly client: NexoraClient;

  constructor(options: EvOpenCodeAdapterOptions) {
    this.identityId = options.identityId;
    this.client = options.client;
  }

  emit(draft: EvEventDraft): Promise<EventEnvelope> {
    return this.client.events.append({ ...draft, actorId: this.identityId });
  }

  reportTaskCreated(task: Task): Promise<EventEnvelope> {
    return this.emit({
      type: "task.created",
      aggregateType: "task",
      aggregateId: task.id,
      payload: {
        title: task.title,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assigneeId,
        reportedBy: "ev-opencode",
      },
      correlationId: null,
      causationId: null,
      schemaVersion: 1,
      visibility: "internal",
    });
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
        reportedBy: "ev-opencode",
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
        originIdentity: "ev",
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
