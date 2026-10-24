import type { Metadata } from "next";
import { Card } from "@/components/card";
import { LadderTable } from "@/components/ladder-table";
import { MerchantPolicyView, RiskDial } from "@/components/merchant-policy";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Merchant" };

export default function MerchantPage() {
  return (
    <>
      <PageHeader title="Merchant" lede="One policy object and one dial. Choose a point on the speed-against-loss curve instead of living with an accident." />
      <div className="space-y-6">
        <Card title="Risk dial"><RiskDial /></Card>
        <Card title="Policy"><MerchantPolicyView /></Card>
        <Card title="The refund ladder"><LadderTable /></Card>
      </div>
    </>
  );
}
