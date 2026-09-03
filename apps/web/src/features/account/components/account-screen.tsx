import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { Suspended } from "@/components/fetcher/suspended";
import { requireSession } from "@/features/auth/api/server/session";
import { getPlatformDraft } from "@/features/editorial/api/server/get-platform-draft";
import { getRecentTopics } from "@/features/editorial/api/server/get-recent-topics";
import { EDITORIAL_NAMESPACE } from "@/features/editorial/constants";
import { MARKET_ANALYSIS_NAMESPACE } from "@/features/market-analysis/constants";
import { getPublishingHistory } from "@/features/publishing/api/server/get-publishing-history";
import { getSavedHistory } from "@/features/publishing/api/server/get-saved-history";
import { PUBLISHING_NAMESPACE } from "@/features/publishing/constants";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";
import {
  customerEditorial,
  enabledImageModels,
} from "@/lib/customer-template.server";

import { getAccountSummary } from "../api/server/get-account-summary";
import { getActivityHistory } from "../api/server/get-activity-history";
import { getActivityLedger } from "../api/server/get-activity-ledger";
import { ACCOUNT_NAMESPACE } from "../constants";
import {
  type AccountSearchParams,
  loadAccountSearchParams,
  normalizeAccountQuery,
} from "../schemas/search";
import { AccountDesk } from "./account-desk";

export function AccountScreen({
  searchParams,
}: {
  searchParams: AccountSearchParams;
}) {
  return (
    <Suspended
      data={() => getT(ACCOUNT_NAMESPACE)}
      fallback={<AccountHeadingSkeleton />}
    >
      {(t) => (
        <div className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8">
          <h1 className="text-balance font-semibold text-2xl tracking-display">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-pretty text-muted-foreground text-sm">
            {t("subtitle")}
          </p>
          <Suspended
            data={() => readAccountDesk(searchParams)}
            fallback={<AccountDeskSkeleton loadingLabel={t("loading")} />}
          >
            {(view) => (
              <Localized
                namespaces={[
                  ACCOUNT_NAMESPACE,
                  EDITORIAL_NAMESPACE,
                  MARKET_ANALYSIS_NAMESPACE,
                  PUBLISHING_NAMESPACE,
                ]}
              >
                <AccountDesk {...view} />
              </Localized>
            )}
          </Suspended>
        </div>
      )}
    </Suspended>
  );
}

async function readAccountDesk(searchParams: AccountSearchParams) {
  const query = normalizeAccountQuery(
    await loadAccountSearchParams(searchParams),
  );
  const [
    session,
    summary,
    activities,
    ledger,
    topics,
    saved,
    scheduled,
    selectedDraft,
  ] = await Promise.all([
    requireSession(),
    getAccountSummary(),
    getActivityHistory(),
    getActivityLedger(query.auditCursor),
    getRecentTopics(),
    getSavedHistory({ state: query.savedState, cursor: query.savedCursor }),
    getPublishingHistory({ view: "scheduled", cursor: null }),
    query.draft ? getPlatformDraft(query.draft) : null,
  ]);

  return {
    profile: {
      name: session.user.name,
      email: session.user.email,
      createdAt: session.user.createdAt,
    },
    brands: customerEditorial.brands,
    models: customerEditorial.models,
    imageModels: enabledImageModels,
    summary,
    activities,
    ledger,
    topics,
    saved,
    scheduled,
    selectedDraft,
    query,
  };
}

function AccountHeadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-1 h-5 w-full max-w-xl" />
    </div>
  );
}

function AccountDeskSkeleton({ loadingLabel }: { loadingLabel: string }) {
  const ledgerColumns = Array.from({ length: 4 }, (_, index) => index);
  const ledgerRows = Array.from({ length: 6 }, (_, index) => index);
  const links = Array.from({ length: 3 }, (_, index) => index);

  return (
    <div aria-busy="true" role="status">
      <span className="sr-only">{loadingLabel}</span>
      <div className="mt-5 grid gap-5 rounded-xl border bg-card p-4 sm:p-5 md:grid-cols-2 md:gap-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-stretch">
        <div className="grid min-w-0 content-start gap-4 lg:grid-rows-[auto_1fr]">
          <Skeleton className="h-144 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
        <div className="grid min-w-0 content-start gap-4 lg:grid-rows-[auto_auto_1fr]">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="min-h-96 w-full" />
        </div>
      </div>
      <div className="mt-6 min-w-0">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-1 mb-3 h-4 w-full max-w-3xl" />
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="grid grid-cols-4 gap-3 border-b px-3 py-3">
            {ledgerColumns.map((column) => (
              <Skeleton className="h-2.5 w-16" key={column} />
            ))}
          </div>
          {ledgerRows.map((row) => (
            <div
              className="grid grid-cols-4 gap-3 border-b px-3 py-3 last:border-b-0"
              key={row}
            >
              {ledgerColumns.map((column) => (
                <Skeleton className="h-3.5 w-full" key={column} />
              ))}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Skeleton className="h-7 w-20 max-sm:h-11" />
          <Skeleton className="h-7 w-20 max-sm:h-11" />
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-x-5 gap-y-1 border-border border-t pt-2">
        {links.map((link) => (
          <span className="flex h-11 items-center" key={link}>
            <Skeleton className="h-4 w-20" />
          </span>
        ))}
      </div>
    </div>
  );
}
