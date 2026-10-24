import type { Metadata } from "next";
import { Suspense } from "react";
import { ClaimView } from "@/components/claim/claim-view";

export const metadata: Metadata = { title: "Your claim" };

export default function ClaimPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-bg" />}>
      <ClaimView />
    </Suspense>
  );
}
