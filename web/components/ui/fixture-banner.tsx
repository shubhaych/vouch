import { FIXTURE_MODE } from "@/lib/stdb/config";

/** Shown only in NEXT_PUBLIC_DATA=fixture development mode, which cannot be built for production. */
export function FixtureBanner() {
  if (!FIXTURE_MODE) return null;
  return (
    <div className="bg-fraud px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wider text-black">
      Fixture mode: recorded test data, not live. This build cannot be deployed.
    </div>
  );
}
