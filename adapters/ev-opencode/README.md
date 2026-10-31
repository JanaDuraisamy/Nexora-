# @nexora/adapter-ev-opencode

Tier A adapter surface for **EV** (OpenCode). EV is one of the two Phase 0
native integrations.

## Status

Skeleton. The package exposes typed calls that write to the real Core API. It
does not contain an autonomous agent loop and does not simulate success: every
method performs an HTTP request and throws `NexoraApiError` on failure.

## Actor identity

The adapter no longer takes an identity UUID. The actor is the identity bound to
the credential presented by the client, so a misconfigured integration cannot
claim to be somebody else. Domain events (`task.created`, `decision.decided`,
`permission.granted`, ...) are emitted by the Core API; the adapter can only
append non-domain notes.

## Wiring plan (not implemented yet)

EV runs inside OpenCode, so the intended integration point is an OpenCode
tool/plugin that:

1. Reads `NEXORA_API_URL` and a credential issued for the `ev` identity.
2. Calls `EvOpenCodeAdapter.note()` when a durable note is genuinely worth
   recording.
3. Never fabricates an event if the API is unreachable.

## Usage

```ts
import { NexoraClient } from "@nexora/sdk-ts";
import { EvOpenCodeAdapter } from "@nexora/adapter-ev-opencode";

const client = new NexoraClient({
  baseUrl: process.env.NEXORA_API_URL!,
  apiToken: process.env.NEXORA_API_TOKEN, // credential issued for `ev`
});

const adapter = new EvOpenCodeAdapter(client);

console.log(await adapter.me()); // { handle: "ev", ... }
await adapter.note({ message: "Phase 0 foundation scaffolded.", topic: "phase-0" });
```

## Open questions

- Should OpenCode events be emitted per tool call or batched per session?
- Which local events are worth persisting versus staying in session context?
  This needs an ADR before the integration is considered complete.
