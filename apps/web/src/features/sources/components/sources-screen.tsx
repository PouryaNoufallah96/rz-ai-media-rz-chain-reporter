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
          <Suspended data={getSourceCatalog} fallback={<CatalogSkeleton />}>
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
                  fallback={<ImportBlockSkeleton />}
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
            fallback={
              <div className="mt-8">
                <DataTableSkeleton
                  columnCount={6}
                  labels={{ loading: t("stream.loading") }}
                />
              </div>
            }
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
    <>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-2 h-5 w-full max-w-md" />
    </>
  );
}

function CatalogSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="mt-2 h-5 w-full max-w-md" />
      <ImportBlockSkeleton />
      <Skeleton className="mt-8 h-96 w-full" />
    </div>
  );
}

function ImportBlockSkeleton() {
  return (
    <div
      aria-busy="true"
      className="mt-6 grid items-start gap-4 lg:grid-cols-2"
    >
      <Skeleton className="h-128 w-full" />
      <div className="grid h-128 grid-rows-[auto_1fr] gap-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="w-full" />
      </div>
    </div>
  );
}
