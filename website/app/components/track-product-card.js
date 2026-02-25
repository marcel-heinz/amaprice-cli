"use client";

import { useEffect, useMemo, useState } from "react";

const ACTIVE_POLL_STATUSES = new Set(["queued", "collecting"]);

function statusTitle(status) {
  switch (status) {
    case "queued":
      return "Queued";
    case "collecting":
      return "Collecting";
    case "live":
      return "Live";
    case "failed":
      return "Failed";
    case "rate_limited":
      return "Rate Limited";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

function statusMessage(state) {
  switch (state?.status) {
    case "queued":
      if (!state?.asin && !state?.product?.asin) {
        return "Your link is accepted. We are resolving it to a product before first scrape.";
      }
      return "Your request is queued. A collector will claim it shortly.";
    case "collecting":
      return "A collector picked it up and is running the first scrape now.";
    case "live":
      return "This product is now live and in the standard tracking loop.";
    case "failed":
      return (
        state?.lastError ||
        "The first scrape failed. You can retry now or try a different product page URL."
      );
    case "rate_limited":
      return "Too many requests in a short window. Please wait a few minutes.";
    case "rejected":
      return state?.lastError || "Input could not be accepted. Check URL/ASIN and retry.";
    default:
      return "Waiting for status updates.";
  }
}

function isTerminalStatus(status) {
  return (
    status === "live" ||
    status === "failed" ||
    status === "rate_limited" ||
    status === "rejected"
  );
}

export default function TrackProductCard({ source = "website", compact = false }) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [requestState, setRequestState] = useState(null);

  const canSubmit = input.trim().length > 0 && !submitting;

  useEffect(() => {
    if (!requestState?.requestId || !ACTIVE_POLL_STATUSES.has(requestState.status)) {
      return undefined;
    }

    let cancelled = false;
    let timeoutId;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/v1/track-requests/${encodeURIComponent(requestState.requestId)}`,
          {
            cache: "no-store"
          }
        );

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || `Status request failed (${response.status}).`);
        }

        if (!cancelled) {
          setRequestState(data);
        }

        if (!cancelled && ACTIVE_POLL_STATUSES.has(data?.status)) {
          const delay = Math.max(1200, Number(data?.pollAfterMs) || 2200);
          timeoutId = window.setTimeout(poll, delay);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err?.message || "Could not refresh tracking status."));
        }
      }
    };

    timeoutId = window.setTimeout(poll, Math.max(900, Number(requestState.pollAfterMs) || 2200));

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [requestState]);

  const detailMessage = useMemo(() => statusMessage(requestState), [requestState]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/track-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: input.trim(),
          source
        })
      });

      const data = await response.json();
      if (!response.ok) {
        if (data?.requestId) {
          setRequestState(data);
        }
        throw new Error(data?.error || `Track request failed (${response.status}).`);
      }

      setRequestState(data);
    } catch (err) {
      setError(String(err?.message || "Could not submit tracking request."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={`track-intake ${compact ? "compact" : ""}`} aria-live="polite">
      <div className="track-intake-head">
        <h2>Track an Amazon Product</h2>
        <p>
          Paste an Amazon URL or ASIN. It enters the collector queue and becomes public
          once first scrape succeeds.
        </p>
      </div>

      <form className="track-intake-form" onSubmit={handleSubmit}>
        <label className="label" htmlFor={`track-input-${source}`}>
          Amazon URL or ASIN
        </label>
        <div className="track-intake-row">
          <input
            id={`track-input-${source}`}
            className="search-input"
            type="text"
            value={input}
            placeholder="https://www.amazon.com/dp/B0... or B0..."
            onChange={(event) => setInput(event.target.value)}
            autoComplete="off"
          />
          <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
            {submitting ? "Submitting..." : "Track"}
          </button>
        </div>
      </form>

      {error ? <p className="spotlight-note health-error">{error}</p> : null}

      {requestState ? (
        <article
          className={`track-status-card status-${requestState.status || "queued"}`}
        >
          <div className="track-status-head">
            <strong>{statusTitle(requestState.status)}</strong>
            <span className="track-status-asin">{requestState.asin || "n/a"}</span>
          </div>
          <p className="track-status-message">{detailMessage}</p>

          {requestState.product?.title ? (
            <p className="track-status-title" title={requestState.product.title}>
              {requestState.product.title}
            </p>
          ) : null}

          <div className="track-status-actions">
            {requestState.product?.pricesUrl ? (
              <a className="btn btn-ghost btn-small" href={requestState.product.pricesUrl}>
                Open in Price Explorer
              </a>
            ) : null}
            {isTerminalStatus(requestState.status) ? null : (
              <span className="track-status-note">Waiting for collectors...</span>
            )}
          </div>
        </article>
      ) : null}
    </section>
  );
}
