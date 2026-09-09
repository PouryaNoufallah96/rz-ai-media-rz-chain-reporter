"use client";

import type {
  ActivityEventType,
  MarketExecutionScopeTarget,
  ModelOption,
  OperationLifecycle,
} from "@rz-chain-reporter/contracts";
import { DIRECTION, type Locale } from "@rz-chain-reporter/i18n";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Card } from "@rz-chain-reporter/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from "@rz-chain-reporter/ui/components/empty";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  type MouseEvent,
  type ReactNode,
  startTransition,
  useState,
} from "react";

import { type BrandLogo, BrandMark } from "@/components/common/brand-mark";
import { PlatformIcon } from "@/components/common/platform-icon";
import { SectionCard } from "@/components/common/section-card";
import { StateMark, type StateMarkState } from "@/components/common/state-mark";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import { LabeledSelect } from "@/components/form/form-field";
import { CardSheet } from "@/features/editorial/components/card-sheet";
import type { PlatformDraftExactCard } from "@/features/editorial/schemas/drafts";
import type { RunOptions } from "@/features/editorial/schemas/workspace";
import { MarketAnalysisFreshness } from "@/features/market-analysis/components/market-analysis-freshness";
import { PublishingFreshness } from "@/features/publishing/components/publishing-freshness";
import { ScheduledPublicationActions } from "@/features/publishing/components/scheduled-publication-actions";
import { publicationMark } from "@/features/publishing/lib/publication-mark";
import type {
  PublishingHistoryRow,
  PublishingQuery,
  SavedHistoryRow,
  SavedQuery,
} from "@/features/publishing/schemas/history";
import type { KeysetPage } from "@/features/shared/lib/keyset-cursor";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";
import { Link } from "@/i18n/navigation";

import {
  ACCOUNT_NAMESPACE,
  ACCOUNT_SAVED_STATES,
  ACTIVITY_MESSAGE,
} from "../constants";
import type {
  AccountSummary,
  ActivityHistoryRow,
  ActivityLedgerRow,
} from "../schemas/account";
import {
  type AccountQuery,
  accountSearchParsers,
  normalizeAccountQuery,
} from "../schemas/search";
import { ActivityLedger } from "./activity-ledger";

const ACTIVITY_MARK = {
  "saved_card.saved": "succeeded",
  "saved_card.discarded": "cancelled",
  "saved_card.restored": "succeeded",
  "approval.granted": "succeeded",
  "schedule.created": "queued",
  "schedule.cancelled": "cancelled",
  "schedule.rescheduled": "queued",
  "schedule.missed": "waiting",
  "publication.requested": "queued",
  "publication.confirmed": "succeeded",
  "publication.failed": "failed",
  "publication.delivery_unknown": "unknown",
  "publication.reconciled_delivered": "succeeded",
  "publication.reconciled_not_delivered": "cancelled",
  "publication.telegram_attested_delivered": "succeeded",
  "publication.telegram_attested_not_delivered": "cancelled",
  "publishing.paused": "failed",
  "publishing.resumed": "succeeded",
} as const satisfies Record<ActivityEventType, StateMarkState>;

type SelectedDraft = {
  executionScope: MarketExecutionScopeTarget;
  lifecycle: OperationLifecycle;
  card: PlatformDraftExactCard;
  readAt: Date;
} | null;

type BrandCatalog = readonly {
  key: string;
  name: string;
  logo: BrandLogo | null;
}[];

function brandLogo(brands: BrandCatalog, brandKey: string | null) {
  return brands.find((brand) => brand.key === brandKey)?.logo ?? null;
}

export function AccountDesk({
  activities,
  brands,
  imageModels,
  ledger,
  models,
  profile,
  query,
  saved,
  scheduled,
  selectedDraft,
  summary,
  topics,
}: {
  activities: ActivityHistoryRow[];
  brands: BrandCatalog;
  imageModels: readonly ModelOption[];
  ledger: KeysetPage<ActivityLedgerRow>;
  models: RunOptions["models"];
  profile: { name: string; email: string; createdAt: Date };
  query: AccountQuery;
  saved: { page: KeysetPage<SavedHistoryRow>; query: SavedQuery };
  scheduled: {
    page: KeysetPage<PublishingHistoryRow>;
    query: PublishingQuery;
    installationTimeZone: string;
  };
  selectedDraft: SelectedDraft;
  summary: AccountSummary;
  topics: string[];
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const { isPending, setValues, values } =
    useTransitionUrlState(accountSearchParsers);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const [fallbackFocus, setFallbackFocus] = useState<HTMLElement | null>(null);
  const selectedDraftId = normalizeAccountQuery(values).draft;
  const card =
    selectedDraft?.card.id === selectedDraftId ? selectedDraft.card : null;
  const freshness =
    selectedDraft?.card.id === selectedDraftId &&
    selectedDraft.executionScope.kind === "analysis_run"
      ? {
          analysisRunId: selectedDraft.executionScope.analysisRunId,
          lifecycle: selectedDraft.lifecycle,
          readAt: selectedDraft.readAt,
        }
      : undefined;
  const openDraft = (
    event: MouseEvent<HTMLButtonElement>,
    platformDraftId: string,
  ) => {
    setOpener(event.currentTarget);
    void setValues({ draft: platformDraftId }, { startTransition });
  };
  const finalFocus = opener?.isConnected ? opener : fallbackFocus;

  return (
    <>
      <Overview profile={profile} summary={summary} />
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-stretch">
        <div className="grid min-w-0 content-start gap-4 lg:grid-rows-[auto_1fr]">
          <SavedCards
            brands={brands}
            isPending={isPending}
            onFallbackFocus={setFallbackFocus}
            onOpenDraft={openDraft}
            page={saved.page}
            query={query}
            setValues={setValues}
          />
          <ScheduledCards
            brands={brands}
            installationTimeZone={scheduled.installationTimeZone}
            onOpenDraft={openDraft}
            rows={scheduled.page.rows}
            showFreshness={selectedDraftId === null}
          />
        </div>
        <div className="grid min-w-0 content-start gap-4 lg:grid-rows-[auto_auto_1fr]">
          <BrandList brands={summary.brands} catalog={brands} />
          <TopicList topics={topics} />
          <ActivityList activities={activities} />
        </div>
      </div>
      <ActivityLedger page={ledger} />
      <nav
        aria-label={t("links.title")}
        className="mt-8 flex flex-wrap gap-x-5 gap-y-1 border-border border-t pt-2 text-muted-foreground text-xs"
      >
        <Link
          className="inline-flex min-h-11 items-center hover:text-foreground"
          href="/sources"
        >
          {t("links.sources")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center hover:text-foreground"
          href="/installation"
        >
          {t("links.installation")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center hover:text-foreground"
          href="/schedule"
        >
          {t("links.schedule")}
        </Link>
      </nav>
      <CardSheet
        card={card}
        finalFocus={finalFocus}
        models={models}
        freshness={freshness}
        imageModels={imageModels}
        loading={selectedDraftId !== null && selectedDraftId !== query.draft}
        onOpenChange={(open) => {
          if (!open) {
            void setValues({ draft: null }, { startTransition });
          }
        }}
        open={selectedDraftId !== null}
      />
      {card?.executionScope.kind === "market_analysis" ? (
        <MarketAnalysisFreshness
          analysisId={card.executionScope.marketAnalysisId}
        />
      ) : null}
    </>
  );
}

function Overview({
  profile,
  summary,
}: {
  profile: { name: string; email: string; createdAt: Date };
  summary: AccountSummary;
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const format = useFormatter();
  const createdAt = new Date(profile.createdAt.valueOf());
  return (
    <section className="min-w-0">
      <Card className="mt-5 grid min-w-0 gap-5 border p-4 ring-0 sm:p-5 md:grid-cols-2 md:gap-6">
        <div className="min-w-0">
          <h2 className="ticket-label text-muted-foreground">
            {t("profile.title")}
          </h2>
          <dl className="mt-2 grid gap-1">
            <div>
              <dt className="sr-only">{t("profile.name")}</dt>
              <dd className="wrap-anywhere font-medium text-lg">
                <Bdi>{profile.name}</Bdi>
              </dd>
            </div>
            <div>
              <dt className="sr-only">{t("profile.email")}</dt>
              <dd className="wrap-anywhere text-muted-foreground text-sm">
                <Bdi>{profile.email}</Bdi>
              </dd>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-muted-foreground text-xs">
              <dt>{t("profile.createdAt")}</dt>
              <dd>
                <time dateTime={createdAt.toISOString()}>
                  {format.dateTime(createdAt, { dateStyle: "long" })}
                </time>
              </dd>
            </div>
          </dl>
        </div>
        <div className="min-w-0">
          <h2 className="ticket-label text-muted-foreground">
            {t("metrics.title")}
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <Metric
              label={t("metrics.generated")}
              value={summary.generatedDrafts}
            />
            <Metric label={t("metrics.scheduled")} value={summary.scheduled} />
            <Metric label={t("metrics.saved")} value={summary.saved} />
          </dl>
        </div>
      </Card>
    </section>
  );
}

function BrandList({
  brands,
  catalog,
}: {
  brands: AccountSummary["brands"];
  catalog: BrandCatalog;
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  return (
    <section aria-labelledby="account-brands-title" className="min-w-0">
      <SectionCard
        className="min-w-0"
        title={t("brands.title")}
        titleId="account-brands-title"
      >
        <dl className="grid grid-cols-1 gap-2">
          {brands.map((brand) => (
            <div
              className="grid min-w-0 gap-3 rounded-lg border bg-muted/30 p-3"
              key={brand.key}
            >
              <dt className="wrap-anywhere flex items-center gap-2 font-medium text-xs">
                <BrandMark
                  className="size-4"
                  logo={brandLogo(catalog, brand.key)}
                  name={brand.name}
                />
                <Bdi>{brand.name}</Bdi>
              </dt>
              <dd className="grid grid-cols-3 gap-2 text-muted-foreground">
                <BrandFact
                  label={t("brands.generated")}
                  value={brand.generatedDrafts}
                />
                <BrandFact
                  label={t("brands.scheduled")}
                  value={brand.scheduled}
                />
                <BrandFact label={t("brands.saved")} value={brand.saved} />
              </dd>
            </div>
          ))}
        </dl>
      </SectionCard>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="ticket-label text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere font-medium">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const format = useFormatter();
  return (
    <div className="grid min-w-0 content-start gap-1">
      <dt className="row-start-2 text-muted-foreground text-xs/relaxed">
        {label}
      </dt>
      <dd className="row-start-1 text-2xl tabular-nums">
        {format.number(value)}
      </dd>
    </div>
  );
}

function BrandFact({ label, value }: { label: string; value: number }) {
  const format = useFormatter();
  return (
    <span className="grid min-w-0 gap-0.5">
      <strong className="text-foreground tabular-nums">
        {format.number(value)}
      </strong>
      <span className="text-xs/relaxed">{label}</span>
    </span>
  );
}

function ActivityList({ activities }: { activities: ActivityHistoryRow[] }) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const [expanded, setExpanded] = useState(false);
  const visibleCount = Math.min(6, activities.length);
  const Icon = expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <section aria-labelledby="account-activity-title" className="min-w-0">
      <SectionCard
        action={
          activities.length > 0 ? (
            <p className="text-muted-foreground text-xs">
              {t("activity.latest", {
                n: expanded ? activities.length : visibleCount,
              })}
            </p>
          ) : null
        }
        className="min-w-0 lg:h-full"
        title={t("activity.title")}
        titleId="account-activity-title"
      >
        {activities.length === 0 ? (
          <CompactEmpty description={t("activity.empty")} />
        ) : (
          <Collapsible onOpenChange={setExpanded} open={expanded}>
            <ul className="divide-y divide-border">
              <ActivityRows activities={activities.slice(0, visibleCount)} />
            </ul>
            {activities.length > visibleCount ? (
              <CollapsibleContent
                aria-label={t("activity.snapshot")}
                className="border-border border-t"
                render={<section />}
              >
                <ul className="divide-y divide-border">
                  <ActivityRows activities={activities.slice(visibleCount)} />
                </ul>
              </CollapsibleContent>
            ) : null}
            {activities.length > visibleCount ? (
              <CollapsibleTrigger
                render={
                  <Button
                    className="mt-2 max-sm:min-h-11"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                {expanded
                  ? t("activity.showLess")
                  : t("activity.showAll", { n: activities.length })}
                <Icon aria-hidden="true" data-icon="inline-end" />
              </CollapsibleTrigger>
            ) : null}
          </Collapsible>
        )}
      </SectionCard>
    </section>
  );
}

function ActivityRows({ activities }: { activities: ActivityHistoryRow[] }) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const format = useFormatter();
  return activities.map((activity) => {
    const occurredAt = new Date(activity.occurredAt.valueOf());
    return (
      <li className="flex min-w-0 gap-3 py-3" key={activity.id}>
        <StateMark state={ACTIVITY_MARK[activity.eventType]} />
        <div className="grid min-w-0 flex-1 gap-1">
          <p className="wrap-anywhere font-medium text-xs/relaxed">
            {t(ACTIVITY_MESSAGE[activity.eventType])}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            <Bdi>
              {activity.headline ?? activity.brandName ?? t("activity.global")}
            </Bdi>
            {activity.platform ? (
              <>
                {" "}
                ·{" "}
                <span className="inline-flex items-center gap-1.5">
                  <PlatformIcon
                    className="size-3.5"
                    platform={activity.platform}
                  />
                  <Bdi>{t(`platform.${activity.platform}`)}</Bdi>
                </span>
              </>
            ) : null}
          </p>
          <time
            className="text-muted-foreground text-xs tabular-nums"
            dateTime={occurredAt.toISOString()}
          >
            {format.dateTime(occurredAt, {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </time>
        </div>
      </li>
    );
  });
}

function TopicList({ topics }: { topics: string[] }) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  return (
    <section aria-labelledby="account-topics-title" className="min-w-0">
      <SectionCard
        className="min-w-0"
        title={t("topics.title")}
        titleId="account-topics-title"
      >
        {topics.length === 0 ? (
          <CompactEmpty description={t("topics.empty")} />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {topics.map((topic) => (
              <li
                className="min-w-0 max-w-full"
                key={topic.toLocaleLowerCase()}
              >
                <Badge
                  className="h-auto max-w-full whitespace-normal py-1"
                  variant="outline"
                >
                  <Bdi className="wrap-anywhere">{topic}</Bdi>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </section>
  );
}

function ScheduledCards({
  brands,
  installationTimeZone,
  onOpenDraft,
  rows,
  showFreshness,
}: {
  brands: BrandCatalog;
  installationTimeZone: string;
  onOpenDraft: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  rows: PublishingHistoryRow[];
  showFreshness: boolean;
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const [expanded, setExpanded] = useState(false);
  const visibleCount = Math.min(4, rows.length);
  const Icon = expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <section aria-labelledby="account-scheduled-title" className="min-w-0">
      <SectionCard
        action={
          <Link
            className="inline-flex items-center text-xs underline-offset-4 hover:underline max-sm:min-h-11"
            href="/schedule?view=scheduled"
          >
            {t("scheduled.viewAll")}
          </Link>
        }
        className="min-w-0 lg:h-full"
        description={
          <>
            {t("scheduled.description")}
            {showFreshness ? (
              <span className="mt-2 block">
                <PublishingFreshness />
              </span>
            ) : null}
          </>
        }
        title={t("scheduled.title")}
        titleId="account-scheduled-title"
      >
        {rows.length === 0 ? (
          <CompactEmpty description={t("scheduled.empty")} />
        ) : (
          <Collapsible onOpenChange={setExpanded} open={expanded}>
            <ul className="divide-y divide-border">
              <ScheduledRows
                brands={brands}
                installationTimeZone={installationTimeZone}
                onOpenDraft={onOpenDraft}
                rows={rows.slice(0, visibleCount)}
              />
            </ul>
            {rows.length > visibleCount ? (
              <CollapsibleContent
                aria-label={t("scheduled.more")}
                className="border-border border-t"
                render={<section />}
              >
                <ul className="divide-y divide-border">
                  <ScheduledRows
                    brands={brands}
                    installationTimeZone={installationTimeZone}
                    onOpenDraft={onOpenDraft}
                    rows={rows.slice(visibleCount)}
                  />
                </ul>
              </CollapsibleContent>
            ) : null}
            {rows.length > visibleCount ? (
              <CollapsibleTrigger
                render={
                  <Button
                    className="mt-2 max-sm:min-h-11"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                {expanded
                  ? t("scheduled.showLess")
                  : t("scheduled.showMore", {
                      n: rows.length - visibleCount,
                    })}
                <Icon aria-hidden="true" data-icon="inline-end" />
              </CollapsibleTrigger>
            ) : null}
          </Collapsible>
        )}
      </SectionCard>
    </section>
  );
}

function ScheduledRows({
  brands,
  installationTimeZone,
  onOpenDraft,
  rows,
}: {
  brands: BrandCatalog;
  installationTimeZone: string;
  onOpenDraft: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  rows: PublishingHistoryRow[];
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const publishingT = useTranslations("publishing");
  const format = useFormatter();
  return rows.map((row) => {
    const occurredAt = new Date(row.occurredAt.valueOf());
    return (
      <li className="grid min-w-0 gap-3 py-4" key={row.id}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <p className="flex min-w-0 items-center gap-2 font-medium">
            <StateMark state={publicationMark(row.lifecycle)} />
            <span className="wrap-anywhere">
              {publishingT(`lifecycle.${row.lifecycle}`)}
            </span>
          </p>
          <p className="wrap-anywhere text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <BrandMark
                className="size-3.5"
                logo={brandLogo(brands, row.brandKey)}
                name={row.brandName}
              />
              <Bdi>{row.brandName}</Bdi>
              <span aria-hidden="true">·</span>
              <PlatformIcon className="size-3.5" platform={row.platform} />
              <Bdi>{t(`platform.${row.platform}`)}</Bdi>
            </span>
          </p>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Button
            aria-label={`${t("scheduled.open")}: ${row.headline}`}
            className="grid h-auto min-h-11 w-full min-w-0 content-start justify-start whitespace-normal rounded-lg border bg-muted/20 p-3 text-start"
            onClick={(event) => onOpenDraft(event, row.platformDraftId)}
            type="button"
            variant="ghost"
          >
            <ContentPreview
              contentLocale={row.contentLocale}
              headline={row.headline}
              body={row.body}
            />
          </Button>
          <dl className="grid min-w-0 content-start gap-3 text-xs sm:border-border sm:border-s sm:ps-4">
            <Fact
              label={t("scheduled.scheduledFor", {
                timeZone: installationTimeZone,
              })}
              value={
                <time dateTime={occurredAt.toISOString()}>
                  {format.dateTime(occurredAt, {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: installationTimeZone,
                  })}
                </time>
              }
            />
            <Fact
              label={t("scheduled.destination")}
              value={<Bdi>{row.destinationLabel}</Bdi>}
            />
          </dl>
        </div>
        <p className="text-muted-foreground text-xs">
          {row.hasImage ? t("card.image") : t("card.textOnly")}
        </p>
        {row.lifecycle === "scheduled" && row.scheduleId ? (
          <ScheduledPublicationActions
            installationTimeZone={installationTimeZone}
            row={row}
          />
        ) : null}
      </li>
    );
  });
}

function SavedCards({
  brands,
  isPending,
  onFallbackFocus,
  onOpenDraft,
  page,
  query,
  setValues,
}: {
  brands: BrandCatalog;
  isPending: boolean;
  onFallbackFocus: (node: HTMLElement | null) => void;
  onOpenDraft: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  page: KeysetPage<SavedHistoryRow>;
  query: AccountQuery;
  setValues: ReturnType<
    typeof useTransitionUrlState<typeof accountSearchParsers>
  >["setValues"];
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const format = useFormatter();
  return (
    <section
      aria-busy={isPending || undefined}
      aria-labelledby="account-saved-title"
      className="min-w-0"
    >
      <SectionCard
        action={
          <LabeledSelect
            busy={isPending}
            className="w-fit"
            label={t("saved.filter")}
            onValueChange={(savedState) =>
              void setValues({
                savedState: savedState ?? "active",
                savedCursor: null,
              })
            }
            options={ACCOUNT_SAVED_STATES.map((value) => ({
              label: t(`saved.filterState.${value}`),
              value,
            }))}
            orientation="horizontal"
            triggerClassName="max-sm:min-h-11"
            value={query.savedState}
          />
        }
        className="min-w-0"
        title={t("saved.title")}
        titleId="account-saved-title"
        titleRef={(node) => onFallbackFocus(node)}
        titleTabIndex={-1}
      >
        {page.rows.length === 0 ? (
          <CompactEmpty description={t("saved.empty")} />
        ) : (
          <section
            aria-label={t("saved.list")}
            className="max-h-144 overflow-y-auto overscroll-contain rounded-lg p-px ring-offset-background focus-within:ring-1 focus-within:ring-ring"
          >
            <ul className="grid gap-3">
              {page.rows.map((row) => {
                const savedAt = new Date(row.savedAt.valueOf());
                return (
                  <li key={row.id}>
                    <SectionCard
                      action={
                        <p className="wrap-anywhere text-muted-foreground text-xs">
                          <span className="inline-flex items-center gap-1.5">
                            <BrandMark
                              className="size-3.5"
                              logo={brandLogo(brands, row.brandKey)}
                              name={row.brandName}
                            />
                            <Bdi>{row.brandName}</Bdi>
                            <span aria-hidden="true">·</span>
                            <PlatformIcon
                              className="size-3.5"
                              platform={row.platform}
                            />
                            <Bdi>{t(`platform.${row.platform}`)}</Bdi>
                          </span>
                        </p>
                      }
                      content="flush"
                      footer={
                        <div className="flex w-full flex-wrap justify-between gap-2 text-muted-foreground text-xs">
                          <time dateTime={savedAt.toISOString()}>
                            {format.dateTime(savedAt, {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </time>
                          <span>
                            {row.revisionNumber
                              ? t("card.revision", { n: row.revisionNumber })
                              : t("card.noHeadline")}{" "}
                            ·{" "}
                            {row.hasImage
                              ? t("card.image")
                              : t("card.textOnly")}
                          </span>
                        </div>
                      }
                      size="sm"
                      title={
                        <span className="flex items-center gap-2">
                          <StateMark
                            state={row.discardedAt ? "cancelled" : "succeeded"}
                          />
                          {row.discardedAt
                            ? t("saved.discarded")
                            : t("saved.active")}
                        </span>
                      }
                      titleLevel={3}
                    >
                      <Button
                        aria-label={`${t("saved.open")}: ${row.headline ?? row.originTitle}`}
                        className="grid h-auto min-h-11 w-full min-w-0 justify-start gap-1 whitespace-normal px-2 py-3 text-start"
                        onClick={(event) =>
                          onOpenDraft(event, row.platformDraftId)
                        }
                        type="button"
                        variant="ghost"
                      >
                        <ContentPreview
                          contentLocale={row.contentLocale}
                          headline={row.headline}
                          body={row.body}
                        />
                      </Button>
                    </SectionCard>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <KeysetPagination
          ariaLabel={t("saved.title")}
          backToLatestLabel={t("saved.latest")}
          newerLabel={t("saved.newer")}
          olderLabel={t("saved.older")}
          offLatest={page.offLatest}
          newerCursor={page.newerCursor}
          olderCursor={page.olderCursor}
          onCursor={(savedCursor) => void setValues({ savedCursor })}
        />
      </SectionCard>
    </section>
  );
}

function ContentPreview({
  body,
  contentLocale,
  headline,
}: {
  body: string | null;
  contentLocale: Locale | null;
  headline: string | null;
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const uiLocale = useLocale();
  const locale = contentLocale ?? uiLocale;
  return (
    <span
      className="grid min-w-0 gap-1 text-start"
      dir={DIRECTION[locale]}
      lang={locale}
    >
      <strong className="wrap-anywhere line-clamp-2 text-sm/relaxed">
        {headline ?? t("card.noHeadline")}
      </strong>
      <span className="wrap-anywhere line-clamp-2 text-muted-foreground text-xs/relaxed">
        {body ?? t("card.noBody")}
      </span>
    </span>
  );
}

function CompactEmpty({ description }: { description: string }) {
  return (
    <Empty className="items-start rounded-lg border bg-muted/20 px-4 py-5 text-start">
      <EmptyHeader className="items-start">
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
