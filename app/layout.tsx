import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Builder Deploy Direct",
  description:
    "Deploy your Nouns Builder DAO site straight to Vercel via the API — no copy-paste, no roundtrip.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
