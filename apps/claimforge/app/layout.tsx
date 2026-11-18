import type { Metadata } from "next";
import { HomeBanner } from "@/components/HomeBanner";
import { Logo } from "@/components/Logo";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClaimForge",
  description: "Pull a published Bitcoin Cash or FLDCH entitlement.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <HomeBanner />
        <header className="border-b border-ink">
          <div className="mx-auto flex max-w-6xl items-end gap-5 px-6 py-8">
            <Logo className="h-14 w-14" />
            <span className="text-2xl font-medium leading-none tracking-tight">ClaimForge</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
