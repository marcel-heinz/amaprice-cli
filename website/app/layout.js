import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const siteUrl = "https://amaprice.sh";
const googleVerification = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "amaprice - Amazon & E-commerce Price Tracking CLI",
    template: "%s | amaprice"
  },
  description:
    "Track Amazon and e-commerce prices from the terminal. Open-source CLI with tiered background sync, worker telemetry, and shared price history.",
  applicationName: "amaprice",
  alternates: {
    canonical: "/"
  },
  keywords: [
    "amaprice",
    "amazon price tracker",
    "e-commerce price tracking",
    "terminal price tracking",
    "cli price tracker",
    "amazon cli",
    "price history",
    "background sync"
  ],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "amaprice",
    title: "amaprice - Amazon & E-commerce Price Tracking CLI",
    description:
      "Terminal-first CLI to track Amazon and e-commerce prices with tiered sync and shared history.",
    images: [
      {
        url: "/amaprice_logo.png",
        width: 1200,
        height: 630,
        alt: "amaprice logo"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: "amaprice - Amazon & E-commerce Price Tracking CLI",
    description:
      "Terminal-first CLI to track Amazon and e-commerce prices with tiered sync and shared history.",
    images: ["/amaprice_logo.png"]
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1
    }
  },
  verification: googleVerification
    ? {
        google: googleVerification
      }
    : undefined,
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico"]
  },
  manifest: "/site.webmanifest"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
