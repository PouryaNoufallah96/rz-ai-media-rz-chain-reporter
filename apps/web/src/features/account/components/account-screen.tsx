import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { z } from "zod";

import { Suspended } from "@/components/fetcher/suspended";
import { requireSession } from "@/features/auth/api/server/session";
import { getPlatformDraft } from "@/features/editorial/api/server/get-platform-draft";
import { getRecentTopics } from "@/features/editorial/api/server/get-recent-topics";
import { getPublishingHistory } from "@/features/publishing/api/server/get-publishing-history";
import { getSavedHistory } from "@/features/publishing/api/server/get-saved-history";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";

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
          <h1 className="font-semibold text-2xl tracking-display">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm">
            {t("subtitle")}
          </p>
          <Suspended
            data={() => readAccountDesk(searchParams)}
            fallback={<AccountDeskSkeleton loadingLabel={t("loading")} />}
          >
            {(view) => (
              <Localized
                namespaces={[ACCOUNT_NAMESPACE, "editorial", "publishing"]}
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
  const validDraftId = z.uuid().safeParse(query.draft);
  const savedSearchParams = Promise.resolve({
    state: query.savedState,
    ...(query.savedCursor ? { cursor: query.savedCursor } : {}),
  });
  const scheduledSearchParams = Promise.resolve({ view: "scheduled" });

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
    getSavedHistory(savedSearchParams),
    getPublishingHistory(scheduledSearchParams),
    validDraftId.success ? getPlatformDraft(validDraftId.data) : null,
  ]);

  return {
    profile: {
      name: session.user.name,
      email: session.user.email,
      createdAt: session.user.createdAt,
    },
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
  return (
    <div aria-busy="true" className="mt-5" role="status">
      <span className="sr-only">{loadingLabel}</span>
      <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-2 md:gap-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-stretch">
        <div className="grid min-w-0 gap-4 lg:grid-rows-[auto_1fr]">
          <Skeleton className="h-48 w-full" />
          <div className="grid gap-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        </div>
        <div className="grid min-w-0 gap-4 lg:grid-rows-[auto_auto_1fr]">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="min-h-96 w-full" />
        </div>
      </div>
    </div>
  );
}
