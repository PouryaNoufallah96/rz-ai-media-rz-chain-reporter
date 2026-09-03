import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { Layers2Icon } from "lucide-react";
import { UrlDataBoundary } from "@/components/fetcher/suspended";
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
import {
  customerProductName,
  customerTemplate,
} from "@/lib/customer-template.server";

import { LocaleSwitch } from "./locale-switch";
import { ModeToggle } from "./mode-toggle";
import { PrimaryNav } from "./primary-nav";

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

function HeaderControlSkeleton({
  className,
  label,
}: {
  className: string;
  label: string;
}) {
  return (
    <div aria-busy="true" className={className}>
      <Skeleton aria-hidden="true" className="size-full" />
      <span className="sr-only" role="status">
        {label}
      </span>
    </div>
  );
}

export default async function Header() {
  const t = await getT(SHARED_NAMESPACE);
  const loadingLabel = t("loader.loading");

  return (
    <header className="sticky top-0 z-40 min-w-0 border-border/40 border-b bg-background/45 backdrop-blur-xl">
      <a
        className="sr-only z-50 bg-background px-3 py-2 focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2"
        href="#main-content"
      >
        {t("header.skipToContent")}
      </a>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Link
          aria-label={t("header.home")}
          className="flex min-h-9 min-w-0 items-center gap-2.5 rounded-md font-semibold text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:flex-1"
          href="/"
        >
          <Layers2Icon
            aria-hidden="true"
            className="size-5 shrink-0 text-primary"
          />
          <span className="truncate">{customerProductName}</span>
        </Link>
        <div className="order-last w-full border-t pt-1 sm:order-0 sm:w-auto sm:border-0 sm:pt-0">
          <UrlDataBoundary
            fallback={
              <HeaderControlSkeleton
                className="h-9 w-72 max-sm:h-11"
                label={loadingLabel}
              />
            }
          >
            <PrimaryNav
              accountLabel={t("header.account")}
              dashboardLabel={t("header.multiMedia")}
              label={t("header.primaryNav")}
              marketAnalysisEnabled={customerTemplate.marketAnalysis.enabled}
              marketAnalysisLabel={t("header.marketAnalysis")}
              usageLabel={t("header.usage")}
            />
          </UrlDataBoundary>
        </div>
        <div className="ms-auto flex min-w-0 items-center justify-end gap-1">
          <Localized namespaces={[SHARED_NAMESPACE, OPERATIONS_NAMESPACE]}>
            <OperationsIndicator />
          </Localized>
          <Localized namespaces={[SHARED_NAMESPACE]}>
            <UrlDataBoundary
              fallback={
                <HeaderControlSkeleton
                  className="size-8 max-sm:size-11"
                  label={loadingLabel}
                />
              }
            >
              <LocaleSwitch />
            </UrlDataBoundary>
            <ModeToggle />
            <UrlDataBoundary
              fallback={
                <HeaderControlSkeleton
                  className="h-8 w-20 max-sm:h-11 sm:w-32"
                  label={loadingLabel}
                />
              }
            >
              <ResolvedUserMenu />
            </UrlDataBoundary>
          </Localized>
        </div>
      </div>
    </header>
  );
}
