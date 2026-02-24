import PricesExplorer from "../components/prices-explorer";
import SiteHeader from "../components/site-header";

const pageJsonLd = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "amaprice Price Explorer",
  url: "https://amaprice.sh/prices",
  description:
    "Search tracked products and explore valid historical price charts by ASIN/domain/title."
};

export const metadata = {
  title: "Prices Explorer",
  description:
    "Search tracked products and view valid price history charts to monitor trends and drops.",
  alternates: {
    canonical: "/prices"
  },
  openGraph: {
    title: "amaprice Price Explorer",
    description:
      "Search tracked products and view valid price history charts to monitor trends and drops.",
    url: "https://amaprice.sh/prices"
  }
};

export default function PricesPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(pageJsonLd)
        }}
      />
      <div className="backdrop" />
      <SiteHeader active="prices" />
      <main className="container">
        <section className="hero prices-hero">
          <p className="kicker">Live product trend discovery</p>
          <h1>Search products and track how prices move.</h1>
          <p className="lead">
            The explorer shows only valid tracked prices so charts stay clean,
            readable, and useful for buying decisions.
          </p>
        </section>
        <PricesExplorer />
      </main>
    </>
  );
}
