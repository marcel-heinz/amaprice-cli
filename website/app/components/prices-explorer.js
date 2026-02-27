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

const INITIAL_VISIBLE_PRODUCTS = 24;
const PRODUCT_PAGE_SIZE = 24;
const CHART_X_TICK_RATIOS = [0, 0.5, 1];

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

function buildTimelineChart(points, width, height, padding) {
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

  const linePath = plottedPoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const yTicks = [0, 1, 2, 3, 4].map((step) => {
    const ratio = step / 4;
    const value = yMax - (yMax - yMin) * ratio;
    return {
      value,
      yPos: y(value)
    };
  });

  const xTicks = CHART_X_TICK_RATIOS.map((ratio) => {
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
  const latestPoint = plottedPoints[plottedPoints.length - 1];

  return {
    linePath,
    yTicks,
    xTicks,
    plottedPoints,
    lowPoint,
    highPoint,
    latestPoint,
    xStart,
    xEnd,
    yTop,
    yBottom
  };
}

function PriceTimelineChart({ points, currency, rangeLabel }) {
  const chartId = useId().replace(/:/g, "");

  if (!Array.isArray(points) || points.length === 0) {
    return (
      <div className="chart-empty">
        <p>No tracked price points in the {rangeLabel} range yet.</p>
      </div>
    );
  }

  const width = 960;
  const height = 336;
  const padding = {
    top: 20,
    right: 14,
    bottom: 34,
    left: 68
  };

  const chart = buildTimelineChart(points, width, height, padding);
  if (!chart) {
    return null;
  }

  const pointsCount = points.length;
  const pointRadius =
    pointsCount > 1500 ? 1.05 : pointsCount > 900 ? 1.2 : pointsCount > 500 ? 1.45 : 1.85;

  const summaryRows = [
    { key: "low", label: "Low", point: chart.lowPoint, tone: "low" },
    { key: "high", label: "High", point: chart.highPoint, tone: "high" },
    { key: "latest", label: "Latest", point: chart.latestPoint, tone: "latest" }
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

  const baselineY = chart.yBottom;

  return (
    <div className="chart-wrap">
      <svg
        className="price-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Price chart with ${points.length} tracked data points`}
      >
        <defs>
          <clipPath id={`plot-clip-${chartId}`}>
            <rect
              x={chart.xStart}
              y={chart.yTop}
              width={chart.xEnd - chart.xStart}
              height={chart.yBottom - chart.yTop}
            />
          </clipPath>
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
              className="chart-price-label"
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
              y1={chart.yTop}
              y2={chart.yBottom}
              className="chart-grid-line x"
            />
            <text x={tick.xPos} y={height - 8} className="chart-axis-label" textAnchor="middle">
              {formatChartDate(tick.timestamp)}
            </text>
          </g>
        ))}

        <line
          x1={chart.xStart}
          x2={chart.xEnd}
          y1={baselineY}
          y2={baselineY}
          className="chart-baseline"
        />

        <g clipPath={`url(#plot-clip-${chartId})`}>
          <path d={chart.linePath} className="chart-line" />
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
            r={Math.max(3.8, pointRadius + 2.2)}
            className={`chart-focus chart-focus-${entry.tone}`}
          />
        ))}
      </svg>

      <div className="chart-legend" aria-label="Chart highlights">
        {summaryRows.map((entry) => (
          <p key={entry.key} className="chart-legend-item">
            <span className={`chart-legend-dot ${entry.tone}`} aria-hidden="true" />
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

function RecentPointsFeed({ points, fallbackCurrency }) {
  const rows = [...(Array.isArray(points) ? points : [])].slice(-14).reverse();

  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="points-feed-wrap" aria-label="Latest tracked points">
      <div className="points-feed-head">
        <strong>Latest Tracked Points</strong>
        <span>{rows.length} shown</span>
      </div>
      <ul className="points-feed">
        {rows.map((row, index) => (
          <li key={`${row.timestamp}-${row.price}-${index}`} className="point-row">
            <strong>{formatMoney(row.price, row.currency || fallbackCurrency)}</strong>
            <span>{formatDateTime(row.scrapedAt)}</span>
          </li>
        ))}
      </ul>
    </section>
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
  const [visibleProductCount, setVisibleProductCount] = useState(INITIAL_VISIBLE_PRODUCTS);

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

  useEffect(() => {
    setVisibleProductCount(INITIAL_VISIBLE_PRODUCTS);
  }, [search]);

  const visibleProducts = useMemo(
    () => filteredProducts.slice(0, visibleProductCount),
    [filteredProducts, visibleProductCount]
  );
  const hasMoreProducts = filteredProducts.length > visibleProducts.length;

  const selectedProduct = useMemo(
    () => products.find((row) => row.asin === selectedAsin) || null,
    [products, selectedAsin]
  );

  const pickerValue = useMemo(() => {
    return filteredProducts.some((product) => product.asin === selectedAsin) ? selectedAsin : "";
  }, [filteredProducts, selectedAsin]);

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
  const feedRows = hasRangeData ? visibleRows : historyRows;

  return (
    <section className="panel prices-explorer" aria-live="polite">
      <div className="section-head">
        <h2>Price Explorer</h2>
        <p className="muted-text">
          Mobile-first search and selection with every tracked price point plotted in the active range.
        </p>
      </div>

      {catalogLoading ? <p className="spotlight-note">Loading product catalog...</p> : null}

      {catalogError ? (
        <p className="spotlight-note health-error">
          {catalogError}
        </p>
      ) : null}

      {!catalogLoading && !catalogError ? (
        <>
          <div className="explorer-toolbar">
            <div className="catalog-head">
              <label className="label" htmlFor="product-search">
                Search tracked products
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
              placeholder="Search title, ASIN, domain..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="quick-pick-wrap">
              <label className="label" htmlFor="product-picker">
                Quick pick
              </label>
              <select
                id="product-picker"
                className="product-picker"
                value={pickerValue}
                onChange={(event) => {
                  const nextAsin = String(event.target.value || "");
                  if (!nextAsin) {
                    return;
                  }
                  setSelectedAsin(nextAsin);
                  syncAsinUrl(nextAsin);
                }}
              >
                <option value="" disabled>
                  {filteredProducts.length > 0 ? "Choose a product" : "No matching products"}
                </option>
                {filteredProducts.map((product) => (
                  <option key={product.id} value={product.asin}>
                    {`${product.asin} · ${shortTitle(product.title)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {filteredProducts.length > 0 ? (
            <div className="catalog-shell" aria-label="Product catalog">
              <div className="catalog-grid">
                {visibleProducts.map((product) => {
                  const isActive = selectedAsin === product.asin;
                  return (
                    <button
                      key={product.id}
                      className={`product-card ${isActive ? "active" : ""}`}
                      type="button"
                      onClick={() => {
                        setSelectedAsin(product.asin);
                        syncAsinUrl(product.asin);
                      }}
                    >
                      <span className="product-card-top">
                        <span className="product-card-domain">{product.domain}</span>
                        <span className="product-card-price">
                          {Number.isFinite(product.lastPrice) ? formatMoney(product.lastPrice) : "n/a"}
                        </span>
                      </span>
                      <strong className="product-card-title">{shortTitle(product.title)}</strong>
                      <span className="product-card-meta">
                        <code>{product.asin}</code>
                        {isActive ? <span>Selected</span> : <span>Open</span>}
                      </span>
                    </button>
                  );
                })}
              </div>

              {hasMoreProducts ? (
                <button
                  type="button"
                  className="catalog-more"
                  onClick={() => setVisibleProductCount((count) => count + PRODUCT_PAGE_SIZE)}
                >
                  Show {Math.min(PRODUCT_PAGE_SIZE, filteredProducts.length - visibleProducts.length)} More Products
                </button>
              ) : null}
            </div>
          ) : (
            <p className="spotlight-note">No products matched your search.</p>
          )}

          <article className="detail-pane detail-workspace">
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

                    <PriceTimelineChart
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

                    <RecentPointsFeed points={feedRows} fallbackCurrency={displayCurrency} />
                  </>
                ) : null}
              </>
            ) : (
              <p className="spotlight-note">Select a product to inspect its tracked price history.</p>
            )}
          </article>
        </>
      ) : null}
    </section>
  );
}
