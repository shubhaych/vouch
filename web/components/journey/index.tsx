"use client";

import { DemoProvider } from "@/lib/demo/demo-store";
import { OpeningScene } from "./opening-scene";
import { Dilemma } from "./dilemma";
import { Insight } from "./insight";
import { TryClaim } from "./try-claim";
import { PoweredBy } from "./powered-by";
import { JudgeNext } from "./judge-next";

export function Journey() {
  return (
    <DemoProvider>
      <OpeningScene />
      <Dilemma />
      <Insight />
      <TryClaim />
      <JudgeNext />
      <PoweredBy />
    </DemoProvider>
  );
}
