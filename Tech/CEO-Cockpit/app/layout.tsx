import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { QueryProvider } from "@/lib/query-client";
import "./globals.css";

// All pages need Supabase at runtime — skip static prerendering
export const dynamic = "force-dynamic";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Carisma Cockpit",
  description: "CEO Business Intelligence Dashboard",
  manifest: "/manifest.json",
};

// viewport-fit=cover is required for env(safe-area-inset-bottom) to work on iOS Safari.
// Without it, safe-area-inset-bottom always resolves to 0 and the home indicator
// overlaps bottom-anchored elements (CIChatFloat, main content padding).
export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
