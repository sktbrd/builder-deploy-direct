import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Builder DAO Launcher",
  description:
    "Launch your own Builder DAO site in 60 seconds. No code, no copy-paste — we fork the template, configure your env, and deploy it live to your Vercel.",
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
