import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { GeistMono } from "geist/font/mono";

/*
 * Archivo: a high-pressure grotesque with flat sides and tight apertures -- the
 * letterform of a punch struck into metal rather than drawn on paper. Its
 * expanded widths are what make a cartouche read as struck rather than typeset.
 */
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-archivo",
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
    <html lang="en" className={`${archivo.variable} ${GeistMono.variable}`}>
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
