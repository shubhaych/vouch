import type { Metadata } from "next";
import { Suspense } from "react";
import { FinanceDesk } from "@/components/desk/finance-desk";

export const metadata: Metadata = { title: "Refund Finance Desk" };

export default function DeskPage() {
  return <Suspense fallback={<main className="app-dark min-h-screen" />}><FinanceDesk /></Suspense>;
}
