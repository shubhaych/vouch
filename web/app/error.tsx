"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app-dark flex min-h-[70vh] flex-col items-center justify-center gap-4 px-6 text-center text-ink-dark">
      <h1 className="text-2xl font-bold">Something broke on this page</h1>
      <p className="max-w-lg text-sm text-ink-soft-dark">{error.message}</p>
      <button className="btn btn--ghost-dark btn--sm" onClick={reset}>Try again</button>
    </main>
  );
}
