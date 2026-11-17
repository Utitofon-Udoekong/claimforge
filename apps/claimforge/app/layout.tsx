import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Serif, Outfit } from "next/font/google";
import { Banner } from "@/components/Banner";
import { siteConfig } from "@/lib/config";
import "./globals.css";

const sans = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "ClaimForge — pull a published FLDCH or BCH entitlement",
  description:
    "Pull-based Merkle claims on Bitcoin Cash. A SolidCash covenant checks the proof, marks the leaf spent, and pays the claimant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body>
        <Banner />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-slate-500 sm:px-6">
          EMBER2026 {siteConfig.ember2026Address}
        </footer>
      </body>
    </html>
  );
}
