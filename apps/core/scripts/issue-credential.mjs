#!/usr/bin/env node
// Issue a per-identity credential.
//
//   npm --prefix apps/core run credential:issue -- --handle ev --label "EV local"
//
// The plaintext token is printed exactly once and never stored: only its SHA-256
// digest is written to nexora.identity_credentials. Run this from the repository
// root (or any directory) with DATABASE_URL pointed at the target database.
//
// This is an operator tool, not an HTTP endpoint. It uses the privileged
// database connection directly, so it must never be exposed or bundled.

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  // Minimal .env reader: apps/core/.env then repository root .env.
  for (const candidate of [
    join(scriptDir, "..", ".env"),
    join(scriptDir, "..", "..", "..", ".env"),
  ]) {
    try {
      const text = readFileSync(candidate, "utf8");
      for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const [, key, rawValue] = match;
        if (process.env[key] !== undefined) continue;
        const value = rawValue.replace(/^["']|["']$/g, "");
        process.env[key] = value;
      }
    } catch {
      // Missing file is fine; environment variables may come from the shell.
    }
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function usage(message) {
  if (message) console.error(`error: ${message}`);
  console.error(
    'usage: credential:issue -- --handle <handle> [--label "text"] [--expires 2026-12-31T00:00:00Z]',
  );
  process.exit(1);
}

loadDotEnv();

const args = parseArgs(process.argv.slice(2));
const handle = args.handle;
if (!handle || handle === "true") usage("--handle is required");

const label = args.label && args.label !== "true" ? args.label : `issued-${handle}`;
const expiresAt = args.expires && args.expires !== "true" ? args.expires : null;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) usage("DATABASE_URL is not set");

const ssl =
  process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: true } : undefined;

const token = randomBytes(32).toString("hex");
const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");

const client = new Client({ connectionString, ssl });

try {
  await client.connect();

  const identity = await client.query(
    "select id, handle, status from nexora.identities where handle = $1",
    [handle],
  );
  const row = identity.rows[0];
  if (!row) {
    usage(`identity '${handle}' does not exist; run the seed or create it first`);
  }
  if (row.status !== "active") {
    usage(`identity '${handle}' is ${row.status}; activate it before issuing credentials`);
  }

  const inserted = await client.query(
    `insert into nexora.identity_credentials
       (identity_id, token_hash, label, expires_at)
     values ($1, $2, $3, $4::timestamptz)
     returning id, created_at`,
    [row.id, tokenHash, label, expiresAt],
  );

  const credential = inserted.rows[0];
  console.log("Credential issued.");
  console.log(`  identity:    ${row.handle} (${row.id})`);
  console.log(`  credential:  ${credential.id}`);
  console.log(`  label:       ${label}`);
  console.log(`  expires_at:  ${expiresAt ?? "never"}`);
  console.log("");
  console.log("Token (shown once, store it in a secret manager or .env):");
  console.log(token);
  console.log("");
  console.log("Only the SHA-256 digest is stored; this token cannot be recovered.");
} finally {
  await client.end();
}
