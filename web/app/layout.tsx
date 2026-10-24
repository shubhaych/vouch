import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/ui/nav";
import { FixtureBanner } from "@/components/ui/fixture-banner";

const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Vouch World", template: "%s · Vouch" },
  description: "Trust that travels with every purchase: AI refund investigation, a live shopping economy, and fraud detectors that improve themselves.",
};

export const viewport: Viewport = { themeColor: "#0b0f14", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jakarta.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen">
        <Providers>
          <FixtureBanner />
          <Nav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
