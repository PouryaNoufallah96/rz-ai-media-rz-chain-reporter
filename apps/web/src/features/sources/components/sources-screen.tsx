import { Card } from "@rz-chain-reporter/ui/components/card";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";

import { DataTableSkeleton } from "@/components/data-table/skeleton";
import { Suspended } from "@/components/fetcher/suspended";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";
import { getFormatter, getT } from "@/i18n/server";

import { getSourceCatalog } from "../api/server/get-source-catalog";
import { getSourceImports } from "../api/server/get-source-imports";
import { getSourceItemStream } from "../api/server/get-source-item-stream";
import { SOURCES_NAMESPACE } from "../constants";
import type { StreamSearchParams } from "../schemas/stream";
import { SourceCatalog } from "./source-catalog";
import { SourceImportRuns } from "./source-import-card";
import { SourceImportForm } from "./source-import-form";
import { SourceItemTable } from "./source-item-table";

export function SourcesScreen({
  searchParams,
}: {
  searchParams: StreamSearchParams;
}) {
  return (
    <Suspended
      data={() => Promise.all([getT(SOURCES_NAMESPACE), getFormatter()])}
      fallback={<SourcesHeadingSkeleton />}
    >
      {([t, format]) => (
        <>
          <h1 className="font-semibold text-2xl tracking-display">
            {t("title")}
          </h1>
          <Suspended
            data={getSourceCatalog}
            fallback={<CatalogSkeleton loadingLabel={t("catalog.loading")} />}
          >
            {(catalog) => (
              <>
                <p className="mt-2 text-muted-foreground text-sm/relaxed">
                  {catalog.lastImportAt
                    ? t("caption.sourceCount", {
                        rss: countOf(catalog.entries, "rss"),
                        telegram: countOf(catalog.entries, "telegram_public"),
                        time: format.dateTime(catalog.lastImportAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                        }),
                      })
                    : t("caption.noImport", {
                        rss: countOf(catalog.entries, "rss"),
                        telegram: countOf(catalog.entries, "telegram_public"),
                      })}
                </p>
                <Suspended
                  data={getSourceImports}
                  fallback={
                    <ImportBlockSkeleton loadingLabel={t("import.loading")} />
                  }
                >
                  {(imports) => (
                    <Localized
                      namespaces={[
                        SHARED_NAMESPACE,
                        SOURCES_NAMESPACE,
                        OPERATIONS_NAMESPACE,
                      ]}
                    >
                      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2 lg:items-stretch">
                        <SourceImportForm catalog={catalog} imports={imports} />
                        <SourceImportRuns imports={imports} />
                      </div>
                    </Localized>
                  )}
                </Suspended>
                <Localized namespaces={[SOURCES_NAMESPACE]}>
                  <SourceCatalog catalog={catalog} />
                </Localized>
              </>
            )}
          </Suspended>
          <Suspended
            data={() => getSourceItemStream(searchParams)}
            fallback={<StreamSkeleton loadingLabel={t("stream.loading")} />}
          >
            {(stream) => (
              <Localized namespaces={[SOURCES_NAMESPACE]}>
                <SourceItemTable stream={stream} />
              </Localized>
            )}
          </Suspended>
        </>
      )}
    </Suspended>
  );
}

function countOf(
  entries: readonly { origin: string }[],
  origin: "rss" | "telegram_public",
) {
  return entries.filter((entry) => entry.origin === origin).length;
}

function SourcesHeadingSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-5 w-full max-w-md" />
    </div>
  );
}

function CatalogSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        {loadingLabel}
      </p>
      <Skeleton className="mt-2 h-5 w-full max-w-md" />
      <ImportBlockSkeleton />
      <SourceCatalogSkeleton />
    </div>
  );
}

function ImportBlockSkeleton({ loadingLabel }: { loadingLabel?: string }) {
  return (
    <div
      aria-busy="true"
      className="mt-6 grid items-start gap-4 lg:grid-cols-2 lg:items-stretch"
    >
      {loadingLabel ? (
        <p className="sr-only" role="status">
          {loadingLabel}
        </p>
      ) : null}
      <Skeleton className="h-128 w-full" />
      <div className="grid h-128 grid-rows-[1fr_1fr] gap-4">
        <Skeleton className="w-full" />
        <Skeleton className="w-full" />
      </div>
    </div>
  );
}

function SourceCatalogSkeleton() {
  const groups = Array.from({ length: 2 }, (_, index) => index);
  const rows = Array.from({ length: 4 }, (_, index) => index);

  return (
    <section className="min-w-0">
      <Card className="mt-8 gap-0 border p-4 ring-0 sm:p-5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="mt-2 h-4 w-full max-w-md" />
        {groups.map((group) => (
          <div className="mt-6" key={group}>
            <Skeleton className="h-4 w-40" />
            <div className="mt-3 divide-y overflow-hidden rounded-lg border bg-muted/20">
              {rows.map((row) => (
                <div className="px-3 py-3" key={row}>
                  <Skeleton className="h-5 w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
    </section>
  );
}

function StreamSkeleton({ loadingLabel }: { loadingLabel: string }) {
  const filters = Array.from({ length: 3 }, (_, index) => index);

  return (
    <section aria-busy="true" className="mt-8">
      <Skeleton className="h-5 w-40" />
      <div className="mt-3 mb-4 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 sm:p-4">
        {filters.map((filter) => (
          <div
            className="flex min-w-0 flex-1 flex-col gap-2 sm:w-fit sm:flex-none"
            key={filter}
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-full sm:w-52" />
          </div>
        ))}
      </div>
      <DataTableSkeleton columnCount={6} labels={{ loading: loadingLabel }} />
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Skeleton className="h-7 w-20 max-sm:h-11" />
        <Skeleton className="h-7 w-20 max-sm:h-11" />
      </div>
    </section>
  );
}
