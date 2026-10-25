import type { Metadata } from "next";
import { ClaimView } from "@/components/claim/claim-view";
import { hintToProps, parseHint } from "@/lib/claim-link";

export const metadata: Metadata = { title: "Your claim" };

// The QR link carries the claim's details, so the first HTML response already
// holds the upload box; the live rows arrive over SpacetimeDB afterwards.
export default async function ClaimPage({ params, searchParams }: PageProps<"/claim/[id]">) {
  const { id } = await params;
  const hint = hintToProps(parseHint(await searchParams));
  return <ClaimView idParam={id} hint={hint} />;
}
