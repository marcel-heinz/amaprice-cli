import Link from "next/link";

const navItems = [
  { href: "/", label: "Home", key: "home" },
  { href: "/prices", label: "Prices", key: "prices" }
];

export default function SiteHeader({ active = "home" }) {
  return (
    <header className="topbar container">
      <Link className="brand" href="/" aria-label="amaprice home">
        <img
          className="brand-logo"
          src="/amaprice_logo.png"
          alt="amaprice"
          width="172"
          height="49"
        />
      </Link>
      <nav className="topnav" aria-label="Primary">
        {navItems.map((item) => (
          <Link
            key={item.key}
            className={`link ${active === item.key ? "link-active" : ""}`}
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
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
  );
}
