"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function buildChart(points, width, height, padding) {
  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const minPrice = Math.min(...points.map((point) => point.price));
  const maxPrice = Math.max(...points.map((point) => point.price));
  const minTs = points[0].timestamp;
  const maxTs = points[points.length - 1].timestamp;

  const paddedMin = minPrice === maxPrice ? minPrice - 1 : minPrice;
  const paddedMax = minPrice === maxPrice ? maxPrice + 1 : maxPrice;
  const ySpan = paddedMax - paddedMin || 1;
  const xSpan = maxTs - minTs || 1;

  const x = (timestamp) =>
    padding + ((timestamp - minTs) / xSpan) * (width - padding * 2);
  const y = (price) =>
    height - padding - ((price - paddedMin) / ySpan) * (height - padding * 2);

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.timestamp)} ${y(point.price)}`)
    .join(" ");

  const firstX = x(points[0].timestamp);
  const lastX = x(points[points.length - 1].timestamp);
  const bottomY = height - padding;
  const areaPath = `${linePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

  const ticks = [0, 1, 2, 3, 4].map((step) => {
    const ratio = step / 4;
    const value = paddedMin + (paddedMax - paddedMin) * ratio;
    const yPos = y(value);
    return { value, yPos };
  });

  return {
    minPrice: paddedMin,
    maxPrice: paddedMax,
    linePath,
    areaPath,
    ticks,
    firstX,
    lastX,
    lastY: y(points[points.length - 1].price)
  };
}

function PriceLineChart({ points, currency }) {
  if (!Array.isArray(points) || points.length === 0) {
    return (
      <div className="chart-empty">
        <p>No valid price points are available yet for this range.</p>
      </div>
    );
  }

  const width = 860;
  const height = 290;
  const padding = 30;
  const chart = buildChart(points, width, height, padding);
  if (!chart) {
    return null;
  }

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="chart-wrap">
      <svg
        className="price-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Price chart with ${points.length} valid data points`}
      >
        <defs>
          <linearGradient id="priceAreaGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(18, 107, 68, 0.33)" />
            <stop offset="100%" stopColor="rgba(18, 107, 68, 0.03)" />
          </linearGradient>
        </defs>
        {chart.ticks.map((tick) => (
          <g key={tick.yPos}>
            <line
              x1={padding}
              x2={width - padding}
              y1={tick.yPos}
              y2={tick.yPos}
              className="chart-grid-line"
            />
            <text x={6} y={tick.yPos + 4} className="chart-grid-label">
              {formatMoney(tick.value, currency)}
            </text>
          </g>
        ))}
        <path d={chart.areaPath} className="chart-area" />
        <path d={chart.linePath} className="chart-line" />
        <circle cx={chart.lastX} cy={chart.lastY} r="5.2" className="chart-point" />
      </svg>
      <p className="chart-axis">
        <span>{formatDateShort(first.scrapedAt)}</span>
        <span>{formatDateShort(last.scrapedAt)}</span>
      </p>
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
  const visibleRows = rangeRows.length > 0 ? rangeRows : historyRows;
  const latest = visibleRows.length > 0 ? visibleRows[visibleRows.length - 1] : null;
  const low = visibleRows.length > 0 ? metricMin(visibleRows) : null;
  const high = visibleRows.length > 0 ? metricMax(visibleRows) : null;
  const change = getChangeInfo(visibleRows);
  const lastKnownPrice = latest?.price ?? numberOrNull(selectedProduct?.lastPrice);
  const changePrefix = Number.isFinite(change.change) && change.change > 0 ? "+" : "";

  return (
    <section className="panel prices-explorer" aria-live="polite">
      <div className="section-head">
        <h2>Price Explorer</h2>
        <p className="muted-text">
          Search products, open one, and inspect valid tracked prices across time ranges.
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
            <label className="label" htmlFor="product-search">
              Search products
            </label>
            <input
              id="product-search"
              className="search-input"
              type="search"
              placeholder="Search by title, ASIN, domain..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <p className="catalog-count">{filteredProducts.length} products</p>
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
                      <span className="product-item-domain">{product.domain}</span>
                      <strong>{shortTitle(product.title)}</strong>
                      <span className="product-item-meta">
                        <code>{product.asin}</code>
                        <span>{Number.isFinite(product.lastPrice) ? formatMoney(product.lastPrice) : "Open chart"}</span>
                      </span>
                      <span className="product-item-cta">View Price History</span>
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
                      ASIN: <code>{selectedProduct.asin}</code> | Last known:{" "}
                      {formatMoney(lastKnownPrice, latest?.currency || "USD")}
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
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                {historyLoading ? <p className="spotlight-note">Loading valid price history...</p> : null}
                {historyError ? <p className="spotlight-note health-error">{historyError}</p> : null}

                {!historyLoading && !historyError ? (
                  <>
                    <div className="metric-grid">
                      <article className="metric">
                        <span className="metric-label">Current</span>
                        <strong>{latest ? formatMoney(latest.price, latest.currency) : "n/a"}</strong>
                      </article>
                      <article className="metric">
                        <span className="metric-label">Lowest</span>
                        <strong>{low ? formatMoney(low.price, low.currency) : "n/a"}</strong>
                      </article>
                      <article className="metric">
                        <span className="metric-label">Highest</span>
                        <strong>{high ? formatMoney(high.price, high.currency) : "n/a"}</strong>
                      </article>
                      <article className="metric">
                        <span className="metric-label">Change</span>
                        <strong>
                          {Number.isFinite(change.change)
                            ? `${changePrefix}${formatMoney(change.change, latest?.currency)} (${changePrefix}${change.changePct.toFixed(2)}%)`
                            : "n/a"}
                        </strong>
                      </article>
                    </div>

                    <PriceLineChart points={visibleRows} currency={latest?.currency || "USD"} />

                    <p className="detail-note">
                      Showing {visibleRows.length} valid points.
                      {" "}
                      {latest ? `Latest update: ${formatDateTime(latest.scrapedAt)}.` : "Waiting for first valid scrape."}
                    </p>
                  </>
                ) : null}
              </>
            ) : (
              <p className="spotlight-note">
                Select a product from the left to open its chart.
              </p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
