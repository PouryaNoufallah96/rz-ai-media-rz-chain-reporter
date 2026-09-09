"use client";

import { Suspense, ViewTransition } from "react";
import type {} from "react/canary";

import { usePathname } from "@/i18n/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <PageTransitionView>{children}</PageTransitionView>
    </Suspense>
  );
}

function PageTransitionView({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <ViewTransition key={pathname} default="none" enter="none" exit="page-fade">
      {children}
    </ViewTransition>
  );
}
