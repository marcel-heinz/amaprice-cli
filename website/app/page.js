import WorkerHealthCard from "./components/worker-health-card";

export default function Home() {
  return (
    <>
      <div className="backdrop" />
      <header className="topbar container">
        <a className="brand" href="/">
          amaprice
        </a>
        <nav>
          <a
            className="link"
            href="https://github.com/marcel-heinz/amaprice-cli"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </header>

      <main className="container">
        <section className="hero">
          <p className="kicker">Terminal-first price tracking</p>
          <h1>Track Amazon prices fast. Build history automatically.</h1>
          <p className="lead">
            <code>amaprice</code> is a clean, open-source CLI for one-shot checks
            and long-running tracking. Add a product once, then let
            hourly/daily/weekly sync collect history in the background.
          </p>

          <div className="install-card">
            <span className="label">Install</span>
            <code>npm install -g amaprice</code>
          </div>

          <div className="cta-row">
            <a
              className="btn btn-primary"
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
        </section>

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
              <h3>Automatic history building</h3>
              <p>
                Products are synced by tier so users do not need to reopen each
                product.
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
