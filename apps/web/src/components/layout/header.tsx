import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { Suspense } from "react";
import { getSession } from "@/features/auth/api/server/session";
import UserMenu, {
  type UserMenuUser,
} from "@/features/auth/components/user-menu";
import { OperationsIndicator } from "@/features/operations/components/operations-indicator";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";
import { Link } from "@/i18n/navigation";
import { getT } from "@/i18n/server";

import { ModeToggle } from "./mode-toggle";

const NAV_LINK_CLASS =
  "underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

async function ResolvedUserMenu() {
  const session = await getSession();
  const user = session?.user
    ? ({
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
      } satisfies UserMenuUser)
    : null;

  return <UserMenu user={user} />;
}

export default async function Header() {
  const t = await getT(SHARED_NAMESPACE);

  return (
    <header className="relative min-w-0 border-b">
      <a
        className="sr-only z-50 bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2"
        href="#main-content"
      >
        {t("header.skipToContent")}
      </a>
      <div className="flex min-w-0 flex-col gap-2 px-2 py-2 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
        <nav
          aria-label={t("header.primaryNav")}
          className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm sm:text-base xl:text-lg"
        >
          <Link className={NAV_LINK_CLASS} href="/">
            {t("header.home")}
          </Link>
          <Link className={NAV_LINK_CLASS} href="/dashboard">
            {t("header.dashboard")}
          </Link>
          <Link className={NAV_LINK_CLASS} href="/sources">
            {t("header.sources")}
          </Link>
          <Link className={NAV_LINK_CLASS} href="/usage">
            {t("header.usage")}
          </Link>
          <Link className={NAV_LINK_CLASS} href="/installation">
            {t("header.installation")}
          </Link>
        </nav>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Localized namespaces={[SHARED_NAMESPACE, OPERATIONS_NAMESPACE]}>
            <OperationsIndicator />
          </Localized>
          <Localized namespaces={[SHARED_NAMESPACE]}>
            <ModeToggle />
            <Suspense fallback={<Skeleton className="h-8 w-20 sm:w-32" />}>
              <ResolvedUserMenu />
            </Suspense>
          </Localized>
        </div>
      </div>
    </header>
  );
}
