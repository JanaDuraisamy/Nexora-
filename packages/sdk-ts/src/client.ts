import {
  appendNoteInputSchema,
  assignTaskInputSchema,
  claimTaskInputSchema,
  createIdentityInputSchema,
  createTaskInputSchema,
  decideDecisionInputSchema,
  decisionListSchema,
  decisionSchema,
  eventEnvelopeSchema,
  eventListSchema,
  grantPermissionInputSchema,
  healthResponseSchema,
  identityListSchema,
  identitySchema,
  idempotencyKeySchema,
  listDecisionsQuerySchema,
  listEventsQuerySchema,
  listPermissionsQuerySchema,
  listTasksQuerySchema,
  permissionListSchema,
  permissionSchema,
  proposeDecisionInputSchema,
  readinessResponseSchema,
  taskListSchema,
  taskSchema,
  updateTaskStatusInputSchema,
  type AppendNoteInput,
  type AssignTaskInput,
  type ClaimTaskInput,
  type CreateIdentityInput,
  type CreateTaskInput,
  type DecideDecisionInput,
  type Decision,
  type DecisionList,
  type EventEnvelope,
  type EventList,
  type GrantPermissionInput,
  type HealthResponse,
  type Identity,
  type IdentityList,
  type ListDecisionsQuery,
  type ListEventsQuery,
  type ListTasksQuery,
  type Permission,
  type PermissionList,
  type ProposeDecisionInput,
  type ReadinessResponse,
  type Task,
  type TaskList,
  type UpdateTaskStatusInput,
} from "@nexora/contracts";
import type { ZodType } from "zod";
import { NexoraApiError, toNexoraApiError } from "./errors.js";

export interface NexoraClientOptions {
  /** Core API base URL, for example http://127.0.0.1:4000 */
  baseUrl: string;
  /**
   * Per-identity bearer credential. Each adapter and each deployment gets its
   * own; the server derives the actor from it. Never ship one to a browser.
   */
  apiToken?: string;
  /** Injectable fetch implementation, primarily for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Extra request headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>;
  /** Status codes whose response body is still contract-valid (e.g. readiness 503). */
  acceptedStatuses?: readonly number[];
}

export interface CreateTaskOptions {
  /** Replays return the original task instead of creating a duplicate. */
  idempotencyKey?: string;
}

export class NexoraClient {
  private readonly baseUrl: string;
  private readonly apiToken: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: NexoraClientOptions) {
    const parsed = new URL(options.baseUrl);
    this.baseUrl = parsed.toString().endsWith("/")
      ? parsed.toString()
      : `${parsed.toString()}/`;
    this.apiToken = options.apiToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  health(): Promise<HealthResponse> {
    return this.request("health", healthResponseSchema);
  }

  readiness(): Promise<ReadinessResponse> {
    return this.request("health/ready", readinessResponseSchema, {
      acceptedStatuses: [503],
    });
  }

  /** The identity bound to this client's credential. */
  whoami(): Promise<Identity> {
    return this.request("v1/whoami", identitySchema);
  }

  readonly identities = {
    list: (): Promise<IdentityList> =>
      this.request("v1/identities", identityListSchema),

    get: (id: string): Promise<Identity> =>
      this.request(`v1/identities/${encodeURIComponent(id)}`, identitySchema),

    create: (input: CreateIdentityInput): Promise<Identity> =>
      this.request("v1/identities", identitySchema, {
        method: "POST",
        body: createIdentityInputSchema.parse(input),
      }),
  };

  readonly events = {
    /** Append a non-domain note. Domain events are emitted by the API itself. */
    note: (input: AppendNoteInput): Promise<EventEnvelope> =>
      this.request("v1/events", eventEnvelopeSchema, {
        method: "POST",
        body: appendNoteInputSchema.parse(input),
      }),

    list: (query: Partial<ListEventsQuery> = {}): Promise<EventList> =>
      this.request(
        withQuery("v1/events", listEventsQuerySchema.parse(query)),
        eventListSchema,
      ),
  };

  readonly tasks = {
    create: (
      input: CreateTaskInput,
      options: CreateTaskOptions = {},
    ): Promise<Task> => {
      const headers: Record<string, string> = {};
      if (options.idempotencyKey !== undefined) {
        headers["Idempotency-Key"] = idempotencyKeySchema.parse(
          options.idempotencyKey,
        );
      }

      return this.request("v1/tasks", taskSchema, {
        method: "POST",
        body: createTaskInputSchema.parse(input),
        headers,
      });
    },

    get: (id: string): Promise<Task> =>
      this.request(`v1/tasks/${encodeURIComponent(id)}`, taskSchema),

    list: (query: Partial<ListTasksQuery> = {}): Promise<TaskList> =>
      this.request(
        withQuery("v1/tasks", listTasksQuerySchema.parse(query)),
        taskListSchema,
      ),

    updateStatus: (id: string, input: UpdateTaskStatusInput): Promise<Task> =>
      this.request(`v1/tasks/${encodeURIComponent(id)}/status`, taskSchema, {
        method: "POST",
        body: updateTaskStatusInputSchema.parse(input),
      }),

    assign: (id: string, input: AssignTaskInput): Promise<Task> =>
      this.request(`v1/tasks/${encodeURIComponent(id)}/assign`, taskSchema, {
        method: "POST",
        body: assignTaskInputSchema.parse(input),
      }),

    claim: (id: string, input: ClaimTaskInput): Promise<Task> =>
      this.request(`v1/tasks/${encodeURIComponent(id)}/claim`, taskSchema, {
        method: "POST",
        body: claimTaskInputSchema.parse(input),
      }),
  };

  readonly decisions = {
    propose: (input: ProposeDecisionInput): Promise<Decision> =>
      this.request("v1/decisions", decisionSchema, {
        method: "POST",
        body: proposeDecisionInputSchema.parse(input),
      }),

    get: (id: string): Promise<Decision> =>
      this.request(`v1/decisions/${encodeURIComponent(id)}`, decisionSchema),

    list: (query: Partial<ListDecisionsQuery> = {}): Promise<DecisionList> =>
      this.request(
        withQuery("v1/decisions", listDecisionsQuerySchema.parse(query)),
        decisionListSchema,
      ),

    decide: (id: string, input: DecideDecisionInput): Promise<Decision> =>
      this.request(`v1/decisions/${encodeURIComponent(id)}/decide`, decisionSchema, {
        method: "POST",
        body: decideDecisionInputSchema.parse(input),
      }),
  };

  readonly permissions = {
    list: (
      query: Partial<{
        identityId: string;
        includeRevoked: boolean;
      }> = {},
    ): Promise<PermissionList> =>
      this.request(
        withQuery("v1/permissions", listPermissionsQuerySchema.parse(query)),
        permissionListSchema,
      ),

    grant: (input: GrantPermissionInput): Promise<Permission> =>
      this.request("v1/permissions", permissionSchema, {
        method: "POST",
        body: grantPermissionInputSchema.parse(input),
      }),

    revoke: (id: string): Promise<Permission> =>
      this.request(
        `v1/permissions/${encodeURIComponent(id)}/revoke`,
        permissionSchema,
        { method: "POST" },
      ),
  };

  private async request<T>(
    path: string,
    schema: ZodType<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = {
      accept: "application/json",
      ...options.headers,
    };

    if (this.apiToken !== undefined) {
      headers.authorization = `Bearer ${this.apiToken}`;
    }

    let body: string | undefined;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? "GET",
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new NexoraApiError(
          0,
          "timeout",
          `Request to ${url.pathname} timed out after ${this.timeoutMs}ms`,
        );
      }

      throw new NexoraApiError(
        0,
        "network_error",
        error instanceof Error ? error.message : "Network request failed",
      );
    }

    const text = await response.text();
    const payload: unknown = text.length > 0 ? safeJsonParse(text) : undefined;

    const accepted = options.acceptedStatuses?.includes(response.status) ?? false;
    if (!response.ok && !accepted) {
      throw toNexoraApiError(
        response.status,
        payload,
        `NEXORA request failed with status ${response.status}`,
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new NexoraApiError(
        response.status,
        "invalid_response",
        `Response from ${url.pathname} did not match the NEXORA contract`,
        parsed.error.issues,
      );
    }

    return parsed.data;
  }
}

function withQuery(
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `${path}?${serialized}` : path;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
