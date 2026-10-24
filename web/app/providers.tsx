"use client";

import type { ReactNode } from "react";
import { StdbProvider } from "@/lib/stdb/provider";
import { Toaster } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StdbProvider>
      {children}
      <Toaster />
    </StdbProvider>
  );
}
