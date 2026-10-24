import Link from "next/link";
import { HeroCanvas } from "@/components/background/hero-canvas";
import { LiveDemo } from "@/components/home/live-demo";
import { BuiltOn, ClosingCta, Experiences, HeroCounters, HowItWorks } from "@/components/home/sections";
import { SectionDivider } from "@/components/ui/divider";
import { Footer } from "@/components/ui/footer";

// Constructa's home in Vouch's words: the same section order and look (web/DESIGN.md).
export default function Home() {
  return (
    <main className="landing" data-testid="home">
      <section className="hero">
        <div className="hero__grid-overlay" aria-hidden />
        <div className="hero__visual"><HeroCanvas /></div>
        <div className="hero__scrim" aria-hidden />
        <div className="hero__inner">
          <div className="hud-glass">
            <span className="hero__eyebrow"><span className="hero__eyebrow-dot" aria-hidden />Cal Hacks 13.0</span>
            <h1 className="hero__title">Trust that travels with every purchase.</h1>
            <p className="hero__sub">Vouch investigates refunds with AI agents, scores shopping behaviour, and lets any business verify a shopper&apos;s record without seeing it.</p>
            <div className="hero__cta">
              <Link href="/world" className="btn btn--glow" data-testid="enter-world">Enter Vouch World</Link>
              <Link href="/shop" className="btn btn--ghost-dark" data-testid="file-refund">File a refund</Link>
            </div>
            <HeroCounters />
          </div>
        </div>
      </section>

      <SectionDivider />
      <section className="section section--compact">
        <p className="section__eyebrow">Live demo</p>
        <h2 className="section__title">Buy, then verify.</h2>
        <p className="mt-2 max-w-2xl text-ink-soft">A purchase becomes a verified refund and a credit change, row by row. This is the whole product in twenty seconds.</p>
        <LiveDemo />
      </section>

      <SectionDivider />
      <Experiences />
      <SectionDivider />
      <HowItWorks />
      <SectionDivider />
      <BuiltOn />
      <SectionDivider />
      <ClosingCta />
      <Footer />
    </main>
  );
}
