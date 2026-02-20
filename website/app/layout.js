import "./globals.css";

export const metadata = {
  title: "amaprice - Amazon Price Tracking CLI",
  description:
    "Track Amazon prices from the terminal. Open-source CLI with tiered background sync and shared price history."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
