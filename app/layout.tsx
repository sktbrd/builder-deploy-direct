import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Builder DAO Launcher",
  description:
    "Launch your own Builder DAO site in 60 seconds. No code, no copy-paste — we fork the template, configure your env, and deploy it live to your Vercel.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

const themeInit = `
(function(){
  try {
    var t = localStorage.getItem('theme');
    var sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (t !== 'light' && sysDark)) {
      document.documentElement.classList.add('dark');
    }
  } catch(e){}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeInit }}
          suppressHydrationWarning
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
