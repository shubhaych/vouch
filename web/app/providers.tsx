"use client";

import type { ReactNode } from "react";
import { StdbProvider } from "@/lib/stdb/provider";
import { SmoothScroll } from "@/components/ui/smooth-scroll";
import { Toaster } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SmoothScroll>
      <StdbProvider>
        {children}
        <Toaster />
      </StdbProvider>
    </SmoothScroll>
  );
}
