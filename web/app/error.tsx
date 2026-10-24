"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-muted">The page failed to load. Nothing was changed.</p>
      <button onClick={reset} className="mt-6 rounded-lg bg-accent px-5 py-2.5 font-semibold text-white">Try again</button>
    </div>
  );
}
