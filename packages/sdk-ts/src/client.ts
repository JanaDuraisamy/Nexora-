import {
  appendEventInputSchema,
  createIdentityInputSchema,
  createTaskInputSchema,
  decideDecisionInputSchema,
  decisionListSchema,
  decisionSchema,
  eventEnvelopeSchema,
  eventListSchema,
  healthResponseSchema,
  identityListSchema,
  identitySchema,
  listDecisionsQuerySchema,
  listEventsQuerySchema,
  listPermissionsQuerySchema,
  listTasksQuerySchema,
  permissionListSchema,
  proposeDecisionInputSchema,
  readinessResponseSchema,
  taskListSchema,
  taskSchema,
  updateTaskStatusInputSchema,
  type AppendEventInput,
  type CreateIdentityInput,
  type CreateTaskInput,
  type DecideDecisionInput,
  type Decision,
  type DecisionList,
  type EventEnvelope,
  type EventList,
  type HealthResponse,
  type Identity,
  type IdentityList,
  type ListEventsQuery,
  type ListDecisionsQuery,
  type ListTasksQuery,
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
  /** Shared Phase 0 service token. Never ship this to a browser in production. */
  apiToken?: string;
  /** Injectable fetch implementation, primarily for tests. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Status codes whose response body is still contract-valid (e.g. readiness 503). */
  acceptedStatuses?: readonly number[];
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

  readonly identities = {
    list: (): Promise<IdentityList> =>
      this.request("v1/identities", identityListSchema),

    create: (input: CreateIdentityInput): Promise<Identity> =>
      this.request("v1/identities", identitySchema, {
        method: "POST",
        body: createIdentityInputSchema.parse(input),
      }),
  };

  readonly events = {
    append: (input: AppendEventInput): Promise<EventEnvelope> =>
      this.request("v1/events", eventEnvelopeSchema, {
        method: "POST",
        body: appendEventInputSchema.parse(input),
      }),

    list: (query: Partial<ListEventsQuery> = {}): Promise<EventList> =>
      this.request(
        withQuery("v1/events", listEventsQuerySchema.parse(query)),
        eventListSchema,
      ),
  };

  readonly tasks = {
    create: (input: CreateTaskInput): Promise<Task> =>
      this.request("v1/tasks", taskSchema, {
        method: "POST",
        body: createTaskInputSchema.parse(input),
      }),

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
    list: (identityId?: string): Promise<PermissionList> =>
      this.request(
        withQuery(
          "v1/permissions",
          listPermissionsQuerySchema.parse(
            identityId === undefined ? {} : { identityId },
          ),
        ),
        permissionListSchema,
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
  query: Record<string, string | number | undefined>,
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
