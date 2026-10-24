import type { Metadata } from "next";
import { BusinessView } from "@/components/business/business-view";

export const metadata: Metadata = { title: "Business" };

export default function BusinessPage() {
  return <BusinessView />;
}
