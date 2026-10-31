import type { HealthResponse, ReadinessResponse } from "@nexora/contracts";
import { NexoraApiError } from "@nexora/sdk-ts";
import { useCallback, useEffect, useState } from "react";
import { apiBaseUrl, client } from "./client";

interface Snapshot {
  health: HealthResponse | null;
  readiness: ReadinessResponse | null;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    health: null,
    readiness: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [healthResult, readinessResult] = await Promise.allSettled([
      client.health(),
      client.readiness(),
    ]);

    const next: Snapshot = { health: null, readiness: null };
    const failures: string[] = [];

    if (healthResult.status === "fulfilled") {
      next.health = healthResult.value;
    } else {
      failures.push(describeError(healthResult.reason));
    }

    if (readinessResult.status === "fulfilled") {
      next.readiness = readinessResult.value;
    } else {
      failures.push(describeError(readinessResult.reason));
    }

    setSnapshot(next);
    setError(failures.length > 0 ? failures.join(" · ") : null);
    setCheckedAt(new Date().toLocaleTimeString());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const database = snapshot.readiness?.checks.database;
  const databaseState = database?.status ?? "error";

  return (
    <div className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Hub-and-spoke workspace</p>
          <h1>
            NEXORA<span className="slash">/</span>Console
          </h1>
          <p className="lede">
            Phase 0 foundation · live state reported by the Core API. Nothing on
            this page is simulated.
          </p>
        </div>
        <button className="refresh" onClick={() => void load()} disabled={loading}>
          {loading ? "Checking…" : "Refresh"}
        </button>
      </header>

      {error !== null && (
        <div className="banner" role="alert">
          <strong>Core API unreachable.</strong> {error}
        </div>
      )}

      <section className="grid" aria-label="Service status">
        <article className="card">
          <p className="label">Core API</p>
          <p className={`value ${snapshot.health ? "ok" : "bad"}`}>
            {snapshot.health ? "Online" : "Offline"}
          </p>
          <p className="detail">
            {snapshot.health
              ? `${snapshot.health.service} v${snapshot.health.version}`
              : `Expected at ${apiBaseUrl}`}
          </p>
        </article>

        <article className="card">
          <p className="label">Database</p>
          <p
            className={`value ${
              databaseState === "ok"
                ? "ok"
                : databaseState === "not_configured"
                  ? "warn"
                  : "bad"
            }`}
          >
            {databaseLabel(databaseState)}
          </p>
          <p className="detail">
            {database?.latencyMs !== undefined
              ? `${database.latencyMs} ms round trip`
              : (database?.message ?? "No readiness data")}
          </p>
        </article>

        <article className="card">
          <p className="label">Uptime</p>
          <p className="value neutral">
            {snapshot.health ? formatUptime(snapshot.health.uptimeSeconds) : "—"}
          </p>
          <p className="detail">
            {checkedAt ? `Checked at ${checkedAt}` : "Not checked yet"}
          </p>
        </article>
      </section>

      <section className="panel">
        <h2>What exists today</h2>
        <ul>
          <li>Append-only event history in PostgreSQL (Supabase Cloud).</li>
          <li>Explicit identity permissions; owners bypass grants by design.</li>
          <li>Typed contracts shared by the API, SDK and adapters.</li>
          <li>EV and NILA adapters are skeletons until their integrations land.</li>
        </ul>
        <p className="footnote">
          Readiness reports <code>not_configured</code> until{" "}
          <code>DATABASE_URL</code> is set. See{" "}
          <code>docs/specs/phase-0-foundation.md</code>.
        </p>
      </section>
    </div>
  );
}

function describeError(error: unknown): string {
  if (error instanceof NexoraApiError) {
    return `${error.code}: ${error.message}`;
  }

  return error instanceof Error ? error.message : "Unknown error";
}

function databaseLabel(status: string): string {
  switch (status) {
    case "ok":
      return "Ready";
    case "not_configured":
      return "Not configured";
    default:
      return "Unreachable";
  }
}

function formatUptime(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${rest}s`;
  }

  return `${rest}s`;
}
