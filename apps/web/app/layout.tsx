import type { Metadata } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import { GeistMono } from "geist/font/mono";

/* Inter carries the whole interface. */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

/*
 * Instrument Serif italic, for exactly one accent word in a headline. It is a
 * counterpoint to Inter, not a second voice -- used twice on a page it stops
 * being an accent and becomes a typeface choice nobody made.
 */
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});


import { SiteFooter } from "@/components/site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mandate — give an agent a budget it cannot exceed",
  description:
    "x402 pays per request and nobody checks the request was served. Mandate makes payment follow a verified result: it reads the receipt instead of trusting the status byte.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${instrument.variable} ${GeistMono.variable}`}>
      {/*
        * The page is a mat; every route sits on it as an inset, rounded panel.
        * The navbar lives inside that panel rather than in this layout, because
        * it floats over the hero video and is clipped by the same corners.
        */}
      <body className="min-h-screen w-full bg-background p-3 font-sans antialiased sm:p-4">
          <main>{children}</main>
          <SiteFooter />
      </body>
    </html>
  );
}
