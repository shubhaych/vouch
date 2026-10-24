import Link from "next/link";

export default function Home() {
  return (
    <main className="hero">
      <div className="hero__inner">
        <div className="hud-glass">
          <h1 className="hero__title">Trust that travels with every purchase.</h1>
          <Link href="/world" className="btn btn--glow">Enter Vouch World</Link>
        </div>
      </div>
    </main>
  );
}
