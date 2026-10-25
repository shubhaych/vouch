"use client";

import { DemoProvider } from "@/lib/demo/demo-store";
import { HeroWheel } from "./wheel/hero-wheel";
import { Dilemma } from "./dilemma";
import { Insight } from "./insight";
import { HowItWorks } from "./how-it-works";
import { MerchantDemo } from "./merchant-demo";
import { HandoffEnding } from "./handoff-ending";
import { PoweredBy } from "./powered-by";

export function Journey() {
  return (
    <DemoProvider>
      <HeroWheel />
      <Dilemma />
      <Insight />
      <HowItWorks />
      <MerchantDemo />
      <HandoffEnding />
      <PoweredBy />
    </DemoProvider>
  );
}
