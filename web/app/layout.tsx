import type { Metadata, Viewport } from "next";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
// Loaded here, not via @import in globals.css: Tailwind's CSS resolver failed to find it under next dev.
import "lenis/dist/lenis.css";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/ui/nav";
import { FixtureBanner } from "@/components/ui/fixture-banner";

const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const dmSans = DM_Sans({ variable: "--font-dm", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Vouch", template: "%s · Vouch" },
  description:
    "Vouch helps merchants resolve refund requests quickly with video claims, policy checks, and a portable score built from confirmed outcomes.",
};

export const viewport: Viewport = { themeColor: "#DDE3E8", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fraunces.variable} ${dmSans.variable} ${jetbrains.variable}`} data-vouch>
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
