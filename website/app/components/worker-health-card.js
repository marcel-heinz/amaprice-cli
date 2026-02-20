"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REFRESH_MS = 60_000;

function formatDateTime(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatPercent(value) {
  if (value === null || value === undefined) return "0.00%";
  const n = Number(value);
  if (!Number.isFinite(n)) return "0.00%";
  return `${n.toFixed(2)}%`;
}

function labelForStatus(status) {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "blocked":
      return "Blocked";
    case "idle_or_stuck":
      return "Idle / Stuck";
    default:
      return "Unknown";
  }
}

export default function WorkerHealthCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const status = useMemo(
    () => String(data?.health_status || "unknown").toLowerCase(),
    [data]
  );

  const loadHealth = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setError(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      setLoading(false);
      return;
    }

    try {
      const url = `${SUPABASE_URL}/rest/v1/worker_health?select=*&limit=1`;
      const response = await fetch(url, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        cache: "no-store"
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase request failed (${response.status}): ${body}`);
      }

      const rows = await response.json();
      setData(Array.isArray(rows) ? rows[0] || null : null);
      setError(null);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(String(err.message || "Could not load worker health."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHealth();
    const id = setInterval(loadHealth, REFRESH_MS);
    return () => clearInterval(id);
  }, [loadHealth]);

  return (
    <section className="panel worker-health" aria-live="polite">
      <div className="health-header">
        <h2>Worker Health</h2>
        <span className={`health-badge ${status}`}>
          {labelForStatus(status)}
        </span>
      </div>

      {loading ? (
        <p className="health-note">Loading latest worker telemetry...</p>
      ) : null}

      {error ? (
        <p className="health-note health-error">
          {error}
          {" "}
          Make sure the `worker_health` view exists and is selectable for `anon`.
        </p>
      ) : null}

      {data ? (
        <>
          <div className="health-grid">
            <article className="metric">
              <span className="metric-label">Attempts (1h)</span>
              <strong>{data.total_attempts_1h ?? 0}</strong>
            </article>
            <article className="metric">
              <span className="metric-label">Success (1h)</span>
              <strong>{data.ok_attempts_1h ?? 0}</strong>
            </article>
            <article className="metric">
              <span className="metric-label">Failures (1h)</span>
              <strong>{data.failed_attempts_1h ?? 0}</strong>
            </article>
            <article className="metric">
              <span className="metric-label">Blocked (1h)</span>
              <strong>{formatPercent(data.blocked_pct_1h)}</strong>
            </article>
            <article className="metric">
              <span className="metric-label">Due Now</span>
              <strong>{data.due_now_products ?? 0}</strong>
            </article>
            <article className="metric">
              <span className="metric-label">Active Products</span>
              <strong>{data.active_products ?? 0}</strong>
            </article>
          </div>
          <p className="health-note">
            Last ok: {formatDateTime(data.last_ok_at)} | Last error:{" "}
            {formatDateTime(data.last_error_at)} | Updated:{" "}
            {formatDateTime(lastUpdatedAt)}
          </p>
        </>
      ) : null}
    </section>
  );
}

