# @nexora/adapter-elio-relay

Tier C **human-relay** adapter for **ELIO**.

## What this is

NEXORA does not have a direct runtime channel to ELIO. Jana relays ELIO's
architecture input into the hub. This package records that relay honestly:

- `actorId` is the **human** who relayed the message (normally Jana).
- `payload.originIdentity` is `"elio"`.
- `payload.channel` is `"human_relay"`.

No automated ELIO connection is implied or simulated.

## Usage

```ts
import { NexoraClient } from "@nexora/sdk-ts";
import { ElioRelayAdapter } from "@nexora/adapter-elio-relay";

const adapter = new ElioRelayAdapter({
  client: new NexoraClient({
    baseUrl: process.env.NEXORA_API_URL!,
    apiToken: process.env.NEXORA_API_TOKEN,
  }),
  relayedByIdentityId: process.env.NEXORA_JANA_IDENTITY_ID!,
});

await adapter.submitNote({
  message: "ELIO's review: keep Phase 0 to EV and NILA only.",
  topic: "architecture",
});
```

## Upgrade path

A future direct ELIO integration needs its own ADR covering transport,
authentication and permission scope. Until then, relay remains Tier C.
