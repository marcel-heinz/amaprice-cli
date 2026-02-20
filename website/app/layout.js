import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "amaprice - Amazon Price Tracking CLI",
  description:
    "Track Amazon prices from the terminal. Open-source CLI with tiered background sync and shared price history."
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
