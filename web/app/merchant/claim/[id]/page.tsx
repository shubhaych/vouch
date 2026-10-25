import type { Metadata } from "next";
import { ClaimResult } from "@/components/merchant/claim-result";

export const metadata: Metadata = { title: "Merchant claim · Vouch" };

export default async function MerchantClaimPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClaimResult claimId={id} />;
}
