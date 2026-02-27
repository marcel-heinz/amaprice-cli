"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  fetchProductHistory,
  fetchProducts,
  formatDateShort,
  formatDateTime,
  formatMoney,
  getChangeInfo,
  hasSupabaseConfig
} from "../lib/price-data";

const RANGE_OPTIONS = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "1y", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null }
];

const chartDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric"
});

function shortTitle(value) {
  const text = String(value || "").trim();
  if (!text) return "Untitled product";
  if (text.length <= 94) return text;
  return `${text.slice(0, 91)}...`;
}

function pointsForRange(points, rangeKey) {
  if (!Array.isArray(points) || points.length === 0 || rangeKey === "all") {
    return Array.isArray(points) ? points : [];
  }

  const option = RANGE_OPTIONS.find((item) => item.key === rangeKey);
  if (!option?.days) {
    return points;
  }

  const cutoff = Date.now() - option.days * 24 * 60 * 60 * 1000;
  return points.filter((point) => point.timestamp >= cutoff);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function metricMin(points) {
  return points.reduce(
    (min, point) => (point.price < min.price ? point : min),
    points[0]
  );
}

function metricMax(points) {
  return points.reduce(
    (max, point) => (point.price > max.price ? point : max),
    points[0]
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatChartDate(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "n/a";
  }
  return chartDateFormatter.format(new Date(timestamp));
}

function buildChart(points, width, height, padding) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const minPrice = Math.min(...points.map((point) => point.price));
  const maxPrice = Math.max(...points.map((point) => point.price));
  const minTs = points[0].timestamp;
  const maxTs = points[points.length - 1].timestamp;

  const priceSpan = maxPrice - minPrice;
  const pricePadding = priceSpan === 0 ? Math.max(minPrice * 0.015, 1) : priceSpan * 0.08;
  const yMin = minPrice - pricePadding;
  const yMax = maxPrice + pricePadding;

  const ySpan = yMax - yMin || 1;
  const xSpan = maxTs - minTs || 1;

  const xStart = padding.left;
  const xEnd = width - padding.right;
  const yTop = padding.top;
  const yBottom = height - padding.bottom;

  const x = (timestamp) => xStart + ((timestamp - minTs) / xSpan) * (xEnd - xStart);
  const y = (price) => yBottom - ((price - yMin) / ySpan) * (yBottom - yTop);

  const plottedPoints = points.map((point, index) => ({
    ...point,
    x: x(point.timestamp),
    y: y(point.price),
    key: `${point.timestamp}-${point.price}-${index}`
  }));

  const firstPoint = plottedPoints[0];
  const lastPoint = plottedPoints[plottedPoints.length - 1];

  const linePath = plottedPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${lastPoint.x} ${yBottom} L ${firstPoint.x} ${yBottom} Z`;

  const yTicks = [0, 1, 2, 3, 4].map((step) => {
    const ratio = step / 4;
    const value = yMax - (yMax - yMin) * ratio;
    return {
      value,
      yPos: y(value)
    };
  });

  const xTicks = [0, 1, 2, 3, 4].map((step) => {
    const ratio = step / 4;
    const timestamp = minTs + (maxTs - minTs) * ratio;
    return {
      timestamp,
      xPos: x(timestamp)
    };
  });

  const lowPoint = plottedPoints.reduce(
    (min, point) => (point.price < min.price ? point : min),
    plottedPoints[0]
  );
  const highPoint = plottedPoints.reduce(
    (max, point) => (point.price > max.price ? point : max),
    plottedPoints[0]
  );

  return {
    linePath,
    areaPath,
    yTicks,
    xTicks,
    plottedPoints,
    firstPoint,
    lastPoint,
    lowPoint,
    highPoint,
    yBottom,
    xStart,
    xEnd
  };
}

function PriceLineChart({ points, currency, rangeLabel }) {
  const chartId = useId().replace(/:/g, "");

  if (!Array.isArray(points) || points.length === 0) {
    return (
      <div className="chart-empty">
        <p>No tracked price points in the {rangeLabel} range yet.</p>
      </div>
    );
  }

  const width = 960;
  const height = 360;
  const padding = {
    top: 22,
    right: 16,
    bottom: 36,
    left: 70
  };

  const chart = buildChart(points, width, height, padding);
  if (!chart) {
    return null;
  }

  const gradientId = `price-area-gradient-${chartId}`;
  const pointsCount = points.length;
  const pointRadius =
    pointsCount > 1200 ? 1.1 : pointsCount > 700 ? 1.35 : pointsCount > 350 ? 1.65 : 2.05;

  const summaryRows = [
    { key: "low", label: "Low", point: chart.lowPoint, tone: "low" },
    { key: "high", label: "High", point: chart.highPoint, tone: "high" },
    { key: "latest", label: "Latest", point: chart.lastPoint, tone: "latest" }
  ];

  const seenFocus = new Set();
  const focusPoints = summaryRows.filter((entry) => {
    if (!entry.point) {
      return false;
    }
    const pointKey = `${entry.point.timestamp}-${entry.point.price}`;
    if (seenFocus.has(pointKey)) {
      return false;
    }
    seenFocus.add(pointKey);
    return true;
  });

  return (
    <div className="chart-wrap">
      <svg
        className="price-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Price chart with ${points.length} tracked data points`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(18, 107, 68, 0.27)" />
            <stop offset="100%" stopColor="rgba(18, 107, 68, 0.02)" />
          </linearGradient>
        </defs>

        {chart.yTicks.map((tick) => (
          <g key={`y-${tick.yPos}`}>
            <line
              x1={chart.xStart}
              x2={chart.xEnd}
              y1={tick.yPos}
              y2={tick.yPos}
              className="chart-grid-line"
            />
            <text
              x={padding.left - 8}
              y={clamp(tick.yPos + 4, padding.top + 10, height - padding.bottom - 2)}
              className="chart-grid-label"
              textAnchor="end"
            >
              {formatMoney(tick.value, currency)}
            </text>
          </g>
        ))}

        {chart.xTicks.map((tick) => (
          <g key={`x-${tick.timestamp}`}>
            <line
              x1={tick.xPos}
              x2={tick.xPos}
              y1={padding.top}
              y2={chart.yBottom}
              className="chart-grid-line x"
            />
            <text x={tick.xPos} y={height - 10} className="chart-grid-label x" textAnchor="middle">
              {formatChartDate(tick.timestamp)}
            </text>
          </g>
        ))}

        <path d={chart.areaPath} className="chart-area" fill={`url(#${gradientId})`} />
        <path d={chart.linePath} className="chart-line" />

        <g className="chart-dots">
          {chart.plottedPoints.map((point) => (
            <circle key={point.key} cx={point.x} cy={point.y} r={pointRadius} className="chart-dot">
              <title>
                {`${formatDateTime(point.scrapedAt)} — ${formatMoney(point.price, point.currency || currency)}`}
              </title>
            </circle>
          ))}
        </g>

        {focusPoints.map((entry) => (
          <circle
            key={`focus-${entry.key}`}
            cx={entry.point.x}
            cy={entry.point.y}
            r={Math.max(3.8, pointRadius + 2.1)}
            className={`chart-focus chart-focus-${entry.tone}`}
          />
        ))}
      </svg>

      <p className="chart-axis">
        <span>{formatDateShort(chart.firstPoint.scrapedAt)}</span>
        <span>{formatDateShort(chart.lastPoint.scrapedAt)}</span>
      </p>

      <div className="chart-key" aria-label="Chart highlights">
        {summaryRows.map((entry) => (
          <p key={entry.key} className="chart-key-item">
            <span className={`chart-key-dot ${entry.tone}`} aria-hidden="true" />
            <strong>{entry.label}</strong>
            <span>
              {entry.point
                ? `${formatMoney(entry.point.price, entry.point.currency || currency)} (${formatDateShort(entry.point.scrapedAt)})`
                : "n/a"}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

export default function PricesExplorer() {
  const [products, setProducts] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedAsin, setSelectedAsin] = useState("");
  const [historyRows, setHistoryRows] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [range, setRange] = useState("90d");

  const syncAsinUrl = useCallback((asin, { replace = false } = {}) => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    if (asin) {
      url.searchParams.set("asin", asin);
    } else {
      url.searchParams.delete("asin");
    }
    const nextPath = `${url.pathname}${url.search}${url.hash}`;
    if (replace) {
      window.history.replaceState({}, "", nextPath);
    } else {
      window.history.pushState({}, "", nextPath);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialAsin = new URLSearchParams(window.location.search).get("asin");
    if (initialAsin) {
      setSelectedAsin(String(initialAsin).toUpperCase());
    }

    const onPopState = () => {
      const asin = new URLSearchParams(window.location.search).get("asin");
      setSelectedAsin(asin ? String(asin).toUpperCase() : "");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadCatalog() {
      if (!hasSupabaseConfig()) {
        setCatalogError("Website API is not configured.");
        setCatalogLoading(false);
        return;
      }

      try {
        const rows = await fetchProducts({ limit: 450 });
        if (!active) return;
        setProducts(rows);
        setCatalogError(null);
      } catch (error) {
        if (!active) return;
        setCatalogError(String(error?.message || "Could not load product catalog."));
      } finally {
        if (active) {
          setCatalogLoading(false);
        }
      }
    }

    loadCatalog();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!products.length) {
      return;
    }
    const hasSelected = selectedAsin && products.some((product) => product.asin === selectedAsin);
    if (hasSelected) {
      return;
    }
    const first = products[0];
    if (!first?.asin) {
      return;
    }
    setSelectedAsin(first.asin);
    syncAsinUrl(first.asin, { replace: true });
  }, [products, selectedAsin, syncAsinUrl]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return products;
    }
    return products.filter((product) =>
      [product.title, product.asin, product.domain].some((entry) =>
        String(entry || "").toLowerCase().includes(term)
      )
    );
  }, [products, search]);

  const selectedProduct = useMemo(
    () => products.find((row) => row.asin === selectedAsin) || null,
    [products, selectedAsin]
  );

  useEffect(() => {
    let active = true;

    async function loadHistory(product) {
      if (!product?.id) {
        setHistoryRows([]);
        setHistoryLoading(false);
        setHistoryError(null);
        return;
      }

      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const rows = await fetchProductHistory(product.id, { limit: 1800 });
        if (!active) return;
        setHistoryRows(rows);
      } catch (error) {
        if (!active) return;
        setHistoryError(String(error?.message || "Could not load price history."));
        setHistoryRows([]);
      } finally {
        if (active) {
          setHistoryLoading(false);
        }
      }
    }

    loadHistory(selectedProduct);
    return () => {
      active = false;
    };
  }, [selectedProduct]);

  const rangeRows = useMemo(() => pointsForRange(historyRows, range), [historyRows, range]);
  const activeRange = RANGE_OPTIONS.find((option) => option.key === range) || RANGE_OPTIONS[0];

  const totalTrackedPoints = historyRows.length;
  const visibleRows = rangeRows;
  const hasRangeData = visibleRows.length > 0;

  const latestOverall = totalTrackedPoints > 0 ? historyRows[totalTrackedPoints - 1] : null;
  const latestInRange = hasRangeData ? visibleRows[visibleRows.length - 1] : null;
  const low = hasRangeData ? metricMin(visibleRows) : null;
  const high = hasRangeData ? metricMax(visibleRows) : null;
  const change = getChangeInfo(visibleRows);
  const changePrefix = Number.isFinite(change.change) && change.change > 0 ? "+" : "";

  const displayCurrency = latestInRange?.currency || latestOverall?.currency || "USD";
  const lastKnownPrice = latestOverall?.price ?? numberOrNull(selectedProduct?.lastPrice);

  return (
    <section className="panel prices-explorer" aria-live="polite">
      <div className="section-head">
        <h2>Price Explorer</h2>
        <p className="muted-text">
          Search tracked products, pick a time range, and inspect every tracked price point directly on the chart.
        </p>
      </div>

      {catalogLoading ? <p className="spotlight-note">Loading product catalog...</p> : null}

      {catalogError ? (
        <p className="spotlight-note health-error">
          {catalogError}
        </p>
      ) : null}

      {!catalogLoading && !catalogError ? (
        <div className="prices-layout">
          <aside className="catalog-pane" aria-label="Product catalog">
            <div className="catalog-head">
              <label className="label" htmlFor="product-search">
                Find a tracked product
              </label>
              <p className="catalog-count">
                {filteredProducts.length} matches
                {search.trim() ? ` (${products.length} total)` : ""}
              </p>
            </div>
            <input
              id="product-search"
              className="search-input"
              type="search"
              placeholder="Search by title, ASIN, domain..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {filteredProducts.length > 0 ? (
              <div className="catalog-list">
                {filteredProducts.map((product) => {
                  const isActive = selectedAsin === product.asin;
                  return (
                    <button
                      key={product.id}
                      className={`product-item ${isActive ? "active" : ""}`}
                      type="button"
                      onClick={() => {
                        setSelectedAsin(product.asin);
                        syncAsinUrl(product.asin);
                      }}
                    >
                      <span className="product-item-top">
                        <span className="product-item-domain">{product.domain}</span>
                        {isActive ? <span className="product-item-badge">Selected</span> : null}
                      </span>
                      <strong className="product-item-title">{shortTitle(product.title)}</strong>
                      <span className="product-item-meta">
                        <code>{product.asin}</code>
                        <span className="product-item-price">
                          {Number.isFinite(product.lastPrice) ? formatMoney(product.lastPrice) : "n/a"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="spotlight-note">No products matched your search.</p>
            )}
          </aside>

          <article className="detail-pane">
            {selectedProduct ? (
              <>
                <div className="detail-head">
                  <div>
                    <p className="kicker">Tracking {selectedProduct.domain}</p>
                    <h3 title={selectedProduct.title}>{selectedProduct.title}</h3>
                    <p className="detail-meta">
                      ASIN: <code>{selectedProduct.asin}</code> | Last known: {formatMoney(lastKnownPrice, displayCurrency)}
                    </p>
                  </div>
                  {selectedProduct.url ? (
                    <a className="btn btn-ghost btn-small" href={selectedProduct.url} target="_blank" rel="noreferrer">
                      Open Product
                    </a>
                  ) : null}
                </div>

                <div className="range-row" role="tablist" aria-label="Price range">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`range-btn ${range === option.key ? "active" : ""}`}
                      onClick={() => setRange(option.key)}
                      aria-pressed={range === option.key}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {historyLoading ? <p className="spotlight-note">Loading tracked price history...</p> : null}
                {historyError ? <p className="spotlight-note health-error">{historyError}</p> : null}

                {!historyLoading && !historyError ? (
                  <>
                    <div className="metric-grid">
                      <article className="metric">
                        <span className="metric-label">Current ({activeRange.label})</span>
                        <strong>{latestInRange ? formatMoney(latestInRange.price, latestInRange.currency) : "n/a"}</strong>
                      </article>
                      <article className="metric">
                        <span className="metric-label">Lowest ({activeRange.label})</span>
                        <strong>{low ? formatMoney(low.price, low.currency) : "n/a"}</strong>
                      </article>
                      <article className="metric">
                        <span className="metric-label">Highest ({activeRange.label})</span>
                        <strong>{high ? formatMoney(high.price, high.currency) : "n/a"}</strong>
                      </article>
                      <article className="metric">
                        <span className="metric-label">Change ({activeRange.label})</span>
                        <strong>
                          {Number.isFinite(change.change)
                            ? `${changePrefix}${formatMoney(change.change, displayCurrency)} (${changePrefix}${change.changePct.toFixed(2)}%)`
                            : "n/a"}
                        </strong>
                      </article>
                    </div>

                    <PriceLineChart
                      points={visibleRows}
                      currency={displayCurrency}
                      rangeLabel={activeRange.label}
                    />

                    <p className="detail-note">
                      {hasRangeData
                        ? `Showing ${visibleRows.length} of ${totalTrackedPoints} tracked points in ${activeRange.label}. Latest update in range: ${formatDateTime(latestInRange.scrapedAt)}.`
                        : totalTrackedPoints > 0
                          ? `No tracked points were collected in ${activeRange.label}. Switch range or choose All to inspect all ${totalTrackedPoints} tracked points.`
                          : "Waiting for the first tracked price point."}
                    </p>
                  </>
                ) : null}
              </>
            ) : (
              <p className="spotlight-note">
                Select a product to inspect its tracked price history.
              </p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
