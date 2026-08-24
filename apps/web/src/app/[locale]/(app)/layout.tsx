import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import type { ReactNode } from "react";

import { Suspended } from "@/components/fetcher/suspended";
import { requireSession } from "@/features/auth/api/server/session";
import { AUTH_NAMESPACE } from "@/features/auth/constants";
import { getT } from "@/i18n/server";

export default function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <Suspended
        data={sessionBanner}
        fallback={
          <Skeleton
            aria-hidden="true"
            className="h-4 w-48 motion-reduce:animate-none"
          />
        }
      >
        {(banner) => (
          <aside>
            <p className="text-muted-foreground text-sm">{banner}</p>
          </aside>
        )}
      </Suspended>
      {children}
    </div>
  );
}

async function sessionBanner() {
  const [session, t] = await Promise.all([
    requireSession(),
    getT(AUTH_NAMESPACE),
  ]);

  return t.rich("session.signedInAs", {
    email: session.user.email,
    isolate: (chunks) => <Bdi>{chunks}</Bdi>,
  });
}
