# @nexora/adapter-rin-bridge

Tier C **human-relay** bridge for **RIN**.

## What this is

EV and RIN do not share context directly. Anything attributed to RIN reaches
the hub through Jana, so this adapter records:

- `actorId` = the human who relayed the message (normally Jana).
- `payload.originIdentity` = `"rin"`.
- `payload.channel` = `"human_relay"`.

This is not a live RIN connection and must never be presented as one.

## Usage

```ts
import { NexoraClient } from "@nexora/sdk-ts";
import { RinBridge } from "@nexora/adapter-rin-bridge";

const bridge = new RinBridge({
  client: new NexoraClient({
    baseUrl: process.env.NEXORA_API_URL!,
    apiToken: process.env.NEXORA_API_TOKEN,
  }),
  relayedByIdentityId: process.env.NEXORA_JANA_IDENTITY_ID!,
});

await bridge.submitNote({
  message: "RIN recommends Supabase Cloud for Phase 0.",
  topic: "architecture",
});
```

## Boundary

EV never claims direct communication with RIN, and this bridge never fabricates
a RIN-authored event. Only Jana can confirm that a message came from RIN.
