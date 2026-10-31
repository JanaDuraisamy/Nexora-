# @nexora/adapter-nila-copilot

Adapter surface for **NILA** (VS Code / GitHub Copilot), the second Phase 0
integration.

## Status

Skeleton. It defines typed calls against the real Core API and performs no
simulated work.

## Wiring plan (not implemented yet)

The editor-to-hub transport is an open decision:

- Option A: a small VS Code extension command that calls the Core API.
- Option B: a local CLI that NILA invokes through the terminal.
- Option C: a Copilot MCP server exposing `nexora_*` tools.

Whichever transport is chosen must carry a bearer token from the user's local
environment and must never embed a service-role key in the extension bundle.

## Usage

```ts
import { NexoraClient } from "@nexora/sdk-ts";
import { NilaCopilotAdapter } from "@nexora/adapter-nila-copilot";

const client = new NexoraClient({
  baseUrl: process.env.NEXORA_API_URL!,
  apiToken: process.env.NEXORA_API_TOKEN,
});

const adapter = new NilaCopilotAdapter({
  client,
  identityId: process.env.NEXORA_NILA_IDENTITY_ID!,
});

await adapter.reportNote("Started task implementation.", "phase-0");
```
