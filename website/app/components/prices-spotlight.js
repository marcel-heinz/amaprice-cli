"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  fetchProducts,
  fetchRecentPriceHistory,
  formatMoney,
  hasSupabaseConfig
} from "../lib/price-data";

function shortTitle(value) {
  const text = String(value || "").trim();
  if (!text) return "Untitled product";
  if (text.length <= 86) return text;
  return `${text.slice(0, 83)}...`;
}

function buildTopDrops(products, recentRows) {
  const byProductId = new Map(products.map((row) => [row.id, row]));
  const historyByProduct = new Map();

  for (const row of recentRows) {
    if (!row?.productId) continue;
    const bucket = historyByProduct.get(row.productId) || [];
    bucket.push(row);
    historyByProduct.set(row.productId, bucket);
  }

  const drops = [];
  for (const [productId, points] of historyByProduct.entries()) {
    if (!Array.isArray(points) || points.length < 2) continue;
    const product = byProductId.get(productId);
    if (!product) continue;

    const first = points[0];
    const last = points[points.length - 1];
    if (!first || !last || last.price >= first.price || first.price <= 0) continue;

    const dropAmount = first.price - last.price;
    const dropPct = (dropAmount / first.price) * 100;
    if (!Number.isFinite(dropPct) || dropPct <= 0) continue;

    drops.push({
      product,
      first,
      last,
      dropAmount,
      dropPct
    });
  }

  return drops.sort((a, b) => b.dropPct - a.dropPct).slice(0, 8);
}

export default function PricesSpotlight() {
  const [products, setProducts] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!hasSupabaseConfig()) {
        setError("Website API is not configured.");
        setLoading(false);
        return;
      }

      try {
        const [catalog, recent] = await Promise.all([
          fetchProducts({ limit: 260 }),
          fetchRecentPriceHistory({ hours: 72, limit: 3600 })
        ]);

        if (!active) return;
        setProducts(catalog);
        setRows(recent);
        setError(null);
      } catch (err) {
        if (!active) return;
        setError(String(err?.message || "Could not load price spotlight."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const topDrops = useMemo(() => buildTopDrops(products, rows), [products, rows]);
  const fallbackProducts = useMemo(() => products.slice(0, 8), [products]);

  return (
    <section className="panel spotlight-panel" aria-live="polite">
      <div className="section-head">
        <h2>Today&apos;s Biggest Drops</h2>
        <p className="muted-text">Valid tracked prices over the last 72 hours.</p>
      </div>

      {loading ? (
        <p className="spotlight-note">Loading latest movers...</p>
      ) : null}

      {error ? (
        <p className="spotlight-note health-error">
          {error}
        </p>
      ) : null}

      {!loading && !error && topDrops.length > 0 ? (
        <div className="spotlight-grid">
          {topDrops.map((item) => (
            <article key={item.product.asin} className="spotlight-card">
              <p className="spotlight-domain">{item.product.domain}</p>
              <h3 title={item.product.title}>{shortTitle(item.product.title)}</h3>
              <p className="spotlight-prices">
                <strong>{formatMoney(item.last.price, item.last.currency)}</strong>
                <span>{formatMoney(item.first.price, item.first.currency)}</span>
              </p>
              <p className="spotlight-drop">
                Down {item.dropPct.toFixed(2)}% ({formatMoney(item.dropAmount, item.last.currency)})
              </p>
              <Link className="btn btn-ghost btn-small" href={`/prices?asin=${encodeURIComponent(item.product.asin)}`}>
                View Price History
              </Link>
            </article>
          ))}
        </div>
      ) : null}

      {!loading && !error && topDrops.length === 0 && fallbackProducts.length > 0 ? (
        <div className="spotlight-grid">
          {fallbackProducts.map((product) => (
            <article key={product.asin} className="spotlight-card">
              <p className="spotlight-domain">{product.domain}</p>
              <h3 title={product.title}>{shortTitle(product.title)}</h3>
              <p className="spotlight-note">No active drop signal yet. Open the chart for trend context.</p>
              <Link className="btn btn-ghost btn-small" href={`/prices?asin=${encodeURIComponent(product.asin)}`}>
                View Price History
              </Link>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
