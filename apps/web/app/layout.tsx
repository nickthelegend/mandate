import type { Metadata } from "next";
import { Martian_Mono, Courier_Prime } from "next/font/google";

/*
 * A printout has one face, because one print head made it.
 *
 * Martian Mono is the wire's own voice: a variable monospace with a width axis,
 * so the same face carries a headline at 4rem and a hash at 12px without ever
 * becoming a different typeface. Monospace here is not a costume for
 * "technical" -- every character on this site was, in the world it borrows,
 * struck by a mechanism that only knows one advance width.
 */
const martian = Martian_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-wire",
  display: "swap",
});

/*
 * Courier Prime for the tape impressions themselves. A telegraph tape was typed
 * by a lighter, older mechanism than the one that set the machine's own labels,
 * and the difference is what makes a tape read as something the page received
 * rather than something the page wrote.
 */
const courier = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-tape",
  display: "swap",
});

import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Outcome — pay agents for verified results",
  description:
    "x402 pays per request and nobody checks the request was served. Outcome makes payment follow a verified result: it reads the receipt instead of trusting the status byte.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${martian.variable} ${courier.variable}`}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>
          <div className="relative flex min-h-screen flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </div>
        </Providers>
      </body>
    </html>
  );
}
