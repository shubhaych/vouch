import Link from "next/link";

export default function NotFound() {
  return (
    <main className="app-dark flex min-h-[70vh] flex-col items-center justify-center gap-4 text-ink-dark">
      <span className="text-5xl">404</span>
      <p className="text-ink-soft-dark">This page does not exist.</p>
      <Link href="/" className="btn btn--primary btn--sm">Back to home</Link>
    </main>
  );
}
