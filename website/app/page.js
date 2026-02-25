import WorkerHealthCard from "./components/worker-health-card";
import PricesSpotlight from "./components/prices-spotlight";
import SiteHeader from "./components/site-header";
import TrackProductCard from "./components/track-product-card";

const softwareApplicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "amaprice",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux, Windows",
  softwareVersion: "1.0.6",
  description:
    "Open-source terminal-first CLI to track Amazon and e-commerce prices with tiered background sync and shared history.",
  license: "https://github.com/marcel-heinz/amaprice-cli/blob/main/LICENSE",
  codeRepository: "https://github.com/marcel-heinz/amaprice-cli",
  downloadUrl: "https://www.npmjs.com/package/amaprice",
  url: "https://amaprice.sh",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD"
  }
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "amaprice",
  url: "https://amaprice.sh",
  description:
    "Official website for the amaprice terminal CLI used for Amazon and e-commerce price tracking.",
  publisher: {
    "@type": "Organization",
    name: "amaprice"
  }
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(softwareApplicationJsonLd)
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteJsonLd)
        }}
      />
      <div className="backdrop" />
      <SiteHeader active="home" />

      <main className="container">
        <section className="hero">
          <p className="kicker">Terminal-first e-commerce price tracking</p>
          <h1>Track Amazon and e-commerce prices fast from your terminal.</h1>
          <p className="lead">
            <code>amaprice</code> is a clean, open-source CLI for one-shot checks
            and long-running tracking across online stores. Add a product once,
            then let hourly/daily/weekly sync keep a clear price timeline.
          </p>

          <div className="install-card">
            <span className="label">Install</span>
            <code>npm install -g amaprice</code>
          </div>

          <div className="cta-row">
            <a className="btn btn-primary" href="/prices">
              Explore Prices
            </a>
            <a
              className="btn btn-ghost"
              href="https://github.com/marcel-heinz/amaprice-cli"
              target="_blank"
              rel="noreferrer"
            >
              View on GitHub
            </a>
            <a className="btn btn-ghost" href="#quickstart">
              Quickstart
            </a>
          </div>

          <TrackProductCard source="home" />
        </section>

        <PricesSpotlight />

        <section id="quickstart" className="panel">
          <h2>Quickstart</h2>
          <div className="cmd-grid">
            <article>
              <h3>One-shot lookup</h3>
              <pre>
                <code>
                  amaprice price "https://www.amazon.de/dp/B0DZ5P7JD6"
                </code>
              </pre>
            </article>
            <article>
              <h3>Start tracking</h3>
              <pre>
                <code>amaprice track B0DZ5P7JD6 --tier daily</code>
              </pre>
            </article>
            <article>
              <h3>Price history</h3>
              <pre>
                <code>amaprice history B0DZ5P7JD6 --limit 30</code>
              </pre>
            </article>
            <article>
              <h3>Background sync worker</h3>
              <pre>
                <code>amaprice sync --limit 20</code>
              </pre>
            </article>
          </div>
        </section>

        <section className="panel">
          <h2>Value You Get</h2>
          <div className="value-grid">
            <article>
              <h3>Fast terminal workflow</h3>
              <p>No dashboard required. Paste URL/ASIN, get price, keep moving.</p>
            </article>
            <article>
              <h3>Tier-based background sync</h3>
              <p>
                Products sync on schedule, so you do not need to reopen each
                product manually.
              </p>
            </article>
            <article>
              <h3>Tiered cost control</h3>
              <p>
                Hourly for volatile products, daily for active products, weekly
                for stable ones.
              </p>
            </article>
            <article>
              <h3>Scriptable by default</h3>
              <p>
                Every command supports JSON output for agents, automations, and
                pipelines.
              </p>
            </article>
          </div>
        </section>

        <section className="panel">
          <h2>Open Source</h2>
          <p>
            <code>amaprice</code> is MIT-licensed and built in public. Contribute
            features, fixes, and ideas directly on GitHub.
          </p>
          <div className="cta-row">
            <a
              className="btn btn-primary"
              href="https://github.com/marcel-heinz/amaprice-cli"
              target="_blank"
              rel="noreferrer"
            >
              GitHub Repository
            </a>
            <a
              className="btn btn-ghost"
              href="https://github.com/marcel-heinz/amaprice-cli/blob/main/LICENSE"
              target="_blank"
              rel="noreferrer"
            >
              MIT License
            </a>
          </div>
        </section>

        <WorkerHealthCard />

        <footer className="site-footer">
          <p>
            Built for terminal-first tracking on <code>amaprice.sh</code>.
          </p>
        </footer>
      </main>
    </>
  );
}
