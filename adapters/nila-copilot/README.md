# @nexora/adapter-nila-copilot

Tier B, pull-only HTTP adapter for **NILA** (VS Code / GitHub Copilot).

## Implemented capability

The adapter uses `@nexora/sdk-ts` to call the real Core API. The host supplies
NILA's per-identity API credential at runtime; this package neither stores nor
logs it. Use HTTPS outside local development and load the credential from the
host's secret storage. Never put it in browser or extension-bundle source.

Supported pull operations:

- `listMyTasks()` — tasks assigned to the credential's identity.
- `getTask(id)`.
- `claimTask(id, expectedVersion)` — atomic claim of an unassigned task.
- `pollEvents(afterSeq, limit)` — resumable cursor over the durable event log.
- `updateStatus(id, input)` — explicit task status mutation.
- `note(input)` — non-domain note.

The server derives the actor from the NILA credential; callers do not configure
an identity UUID. Errors are returned to the caller. The adapter does not retry
automatically; callers may retry safe reads, and should recover a timed-out
claim by re-reading the task before retrying with its current version.

## Transport boundary and limitations

This package implements outbound HTTP calls only. It does not include a VS Code
extension, Copilot API integration, MCP server, push notifications, polling
worker, or remote-trigger mechanism. No unsupported VS Code/Copilot API is
assumed. A host must explicitly invoke these methods and provide the credential
from its local secret provider; editor-specific secret storage and command
registration require a separate transport implementation.

## Usage

```ts
import { NilaCopilotAdapter } from "@nexora/adapter-nila-copilot";

export async function pollNila(
  apiUrl: string,
  apiToken: string,
  savedCursor?: number,
) {
  const adapter = new NilaCopilotAdapter({ apiUrl, apiToken });

  const { items } = await adapter.listMyTasks();
  const eventPage = await adapter.pollEvents(savedCursor);
  return { items, eventPage };
}
```

The host passes the credential from its local secret provider; this library does
not implement editor-specific storage or command registration.
