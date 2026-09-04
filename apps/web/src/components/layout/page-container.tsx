import type { ReactNode } from "react";

const PAGE_CONTAINER = "mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8";

export function PageMain({ children }: { children: ReactNode }) {
  return (
    <main className={PAGE_CONTAINER} id="main-content" tabIndex={-1}>
      {children}
    </main>
  );
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className={PAGE_CONTAINER}>{children}</div>;
}
