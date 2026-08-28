"use client";

import type {
  ActivityEventType,
  OperationLifecycle,
} from "@rz-chain-reporter/contracts";
import { DIRECTION, type Locale } from "@rz-chain-reporter/i18n";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@rz-chain-reporter/ui/components/card";
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
import { type MouseEvent, startTransition, useState } from "react";

import { StateMark, type StateMarkState } from "@/components/common/state-mark";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import { LabeledSelect } from "@/components/form/form-field";
import { CardSheet } from "@/features/editorial/components/card-sheet";
import type { PlatformDraftCard } from "@/features/editorial/schemas/drafts";
import { PublishingFreshness } from "@/features/publishing/components/publishing-freshness";
import { ScheduledPublicationActions } from "@/features/publishing/components/scheduled-publication-actions";
import type {
  KeysetPage,
  PublishingHistoryRow,
  PublishingQuery,
  SavedHistoryRow,
  SavedQuery,
} from "@/features/publishing/schemas/history";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";
import { Link } from "@/i18n/navigation";

import { ACCOUNT_NAMESPACE, ACCOUNT_SAVED_STATES } from "../constants";
import type { AccountSummary, ActivityHistoryRow } from "../schemas/account";
import {
  type AccountQuery,
  accountSearchParsers,
  normalizeAccountQuery,
} from "../schemas/search";

const ACTIVITY_MESSAGE = {
  "saved_card.saved": "activity.events.saved_card.saved",
  "saved_card.discarded": "activity.events.saved_card.discarded",
  "saved_card.restored": "activity.events.saved_card.restored",
  "approval.granted": "activity.events.approval.granted",
  "schedule.created": "activity.events.schedule.created",
  "schedule.cancelled": "activity.events.schedule.cancelled",
  "schedule.rescheduled": "activity.events.schedule.rescheduled",
  "schedule.missed": "activity.events.schedule.missed",
  "publication.requested": "activity.events.publication.requested",
  "publication.confirmed": "activity.events.publication.confirmed",
  "publication.failed": "activity.events.publication.failed",
  "publication.delivery_unknown":
    "activity.events.publication.delivery_unknown",
  "publication.reconciled_delivered":
    "activity.events.publication.reconciled_delivered",
  "publication.reconciled_not_delivered":
    "activity.events.publication.reconciled_not_delivered",
  "publication.telegram_attested_delivered":
    "activity.events.publication.telegram_attested_delivered",
  "publication.telegram_attested_not_delivered":
    "activity.events.publication.telegram_attested_not_delivered",
  "publishing.paused": "activity.events.publishing.paused",
  "publishing.resumed": "activity.events.publishing.resumed",
} as const satisfies Record<ActivityEventType, string>;

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
  analysisRunId: string;
  lifecycle: OperationLifecycle;
  card: PlatformDraftCard;
  readAt: Date;
} | null;

export function AccountDesk({
  activities,
  profile,
  query,
  saved,
  scheduled,
  selectedDraft,
  summary,
  topics,
}: {
  activities: ActivityHistoryRow[];
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
    selectedDraft?.card.id === selectedDraftId
      ? {
          analysisRunId: selectedDraft.analysisRunId,
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
      <div className="mt-7 grid items-start gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 content-start gap-8">
          <SavedCards
            isPending={isPending}
            onFallbackFocus={setFallbackFocus}
            onOpenDraft={openDraft}
            page={saved.page}
            query={query}
            setValues={setValues}
          />
          <ScheduledCards
            installationTimeZone={scheduled.installationTimeZone}
            onOpenDraft={openDraft}
            rows={scheduled.page.rows}
          />
        </div>
        <div className="grid min-w-0 content-start gap-7">
          <BrandList brands={summary.brands} />
          <TopicList topics={topics} />
          <ActivityList activities={activities} />
        </div>
      </div>
      <nav
        aria-label={t("links.title")}
        className="mt-8 flex flex-wrap gap-x-5 gap-y-1 border-border border-t pt-2 text-muted-foreground text-xs"
      >
        <Link
          className="inline-flex min-h-11 items-center py-3 hover:text-foreground"
          href="/usage"
        >
          {t("links.usage")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center py-3 hover:text-foreground"
          href="/sources"
        >
          {t("links.sources")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center py-3 hover:text-foreground"
          href="/installation"
        >
          {t("links.installation")}
        </Link>
        <Link
          className="inline-flex min-h-11 items-center py-3 hover:text-foreground"
          href="/schedule"
        >
          {t("links.schedule")}
        </Link>
      </nav>
      <CardSheet
        card={card}
        finalFocus={finalFocus}
        freshness={freshness}
        key={selectedDraftId ?? "missing-draft"}
        loading={selectedDraftId !== null && selectedDraftId !== query.draft}
        onOpenChange={(open) => {
          if (!open) void setValues({ draft: null }, { startTransition });
        }}
        open={selectedDraftId !== null}
      />
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
    <section className="mt-5 grid min-w-0 gap-5 border-border border-y py-5 md:grid-cols-2 md:gap-8">
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
        <dl className="mt-3 grid grid-cols-3 gap-4">
          <Metric
            label={t("metrics.generated")}
            value={summary.generatedDrafts}
          />
          <Metric label={t("metrics.scheduled")} value={summary.scheduled} />
          <Metric label={t("metrics.saved")} value={summary.saved} />
        </dl>
      </div>
    </section>
  );
}

function BrandList({ brands }: { brands: AccountSummary["brands"] }) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  return (
    <section aria-labelledby="account-brands-title" className="min-w-0">
      <h2 className="font-medium text-sm" id="account-brands-title">
        {t("brands.title")}
      </h2>
      <dl className="mt-3 grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
        {brands.map((brand) => (
          <div className="grid min-w-0 gap-3 bg-background p-3" key={brand.key}>
            <dt className="wrap-anywhere font-medium text-xs">
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
    </section>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
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
      <dd className="row-start-1 font-mono text-2xl tabular-nums">
        {format.number(value)}
      </dd>
    </div>
  );
}

function BrandFact({ label, value }: { label: string; value: number }) {
  const format = useFormatter();
  return (
    <span className="grid min-w-0 gap-0.5">
      <strong className="font-mono text-foreground tabular-nums">
        {format.number(value)}
      </strong>
      <span className="wrap-anywhere text-[0.65rem]">{label}</span>
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
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-border border-b pb-3">
        <h2 className="font-medium text-sm" id="account-activity-title">
          {t("activity.title")}
        </h2>
        {activities.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {t("activity.latest", {
              n: expanded ? activities.length : visibleCount,
            })}
          </p>
        ) : null}
      </div>
      {activities.length === 0 ? (
        <CompactEmpty description={t("activity.empty")} />
      ) : (
        <Collapsible onOpenChange={setExpanded} open={expanded}>
          {!expanded ? (
            <ul className="divide-y divide-border">
              <ActivityRows activities={activities.slice(0, visibleCount)} />
            </ul>
          ) : null}
          <CollapsibleContent
            aria-label={t("activity.snapshot")}
            render={<section />}
          >
            <ul className="divide-y divide-border">
              <ActivityRows activities={activities} />
            </ul>
          </CollapsibleContent>
          {activities.length > visibleCount ? (
            <CollapsibleTrigger
              render={
                <Button
                  className="mt-2 min-h-11"
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
                · <Bdi>{t(`platform.${activity.platform}`)}</Bdi>
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
      <h2 className="font-medium text-sm" id="account-topics-title">
        {t("topics.title")}
      </h2>
      {topics.length === 0 ? (
        <CompactEmpty description={t("topics.empty")} />
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {topics.map((topic) => (
            <li className="min-w-0 max-w-full" key={topic.toLocaleLowerCase()}>
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
    </section>
  );
}

function ScheduledCards({
  installationTimeZone,
  onOpenDraft,
  rows,
}: {
  installationTimeZone: string;
  onOpenDraft: (event: MouseEvent<HTMLButtonElement>, id: string) => void;
  rows: PublishingHistoryRow[];
}) {
  const t = useTranslations(ACCOUNT_NAMESPACE);
  const [expanded, setExpanded] = useState(false);
  const visibleCount = Math.min(4, rows.length);
  const Icon = expanded ? ChevronUpIcon : ChevronDownIcon;
  return (
    <section aria-labelledby="account-scheduled-title" className="min-w-0">
      <div className="border-border border-b pb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h2 className="font-medium text-sm" id="account-scheduled-title">
            {t("scheduled.title")}
          </h2>
          <Link
            className="inline-flex min-h-11 items-center text-xs underline-offset-4 hover:underline"
            href="/schedule?view=scheduled"
          >
            {t("scheduled.viewAll")}
          </Link>
        </div>
        <p className="text-muted-foreground text-xs">
          {t("scheduled.description")}
        </p>
        <div className="mt-2 [&_button]:min-h-11 sm:[&_button]:min-h-0">
          <PublishingFreshness />
        </div>
      </div>
      {rows.length === 0 ? (
        <CompactEmpty description={t("scheduled.empty")} />
      ) : (
        <Collapsible onOpenChange={setExpanded} open={expanded}>
          <ul className="divide-y divide-border">
            <ScheduledRows
              installationTimeZone={installationTimeZone}
              onOpenDraft={onOpenDraft}
              rows={rows.slice(0, visibleCount)}
            />
          </ul>
          {rows.length > visibleCount ? (
            <>
              <CollapsibleContent
                aria-label={t("scheduled.more")}
                className="max-h-128 overflow-y-auto overscroll-contain border-border border-t outline-none focus-visible:ring-1 focus-visible:ring-ring"
                render={<section />}
                tabIndex={0}
              >
                <ul className="divide-y divide-border">
                  <ScheduledRows
                    installationTimeZone={installationTimeZone}
                    onOpenDraft={onOpenDraft}
                    rows={rows.slice(visibleCount)}
                  />
                </ul>
              </CollapsibleContent>
              <CollapsibleTrigger
                render={
                  <Button
                    className="mt-2 min-h-11"
                    type="button"
                    variant="ghost"
                  />
                }
              >
                {expanded
                  ? t("scheduled.showLess")
                  : t("scheduled.showMore", { n: rows.length - visibleCount })}
                <Icon aria-hidden="true" data-icon="inline-end" />
              </CollapsibleTrigger>
            </>
          ) : null}
        </Collapsible>
      )}
    </section>
  );
}

function ScheduledRows({
  installationTimeZone,
  onOpenDraft,
  rows,
}: {
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
            <Bdi>{row.brandName}</Bdi> ·{" "}
            <Bdi>{t(`platform.${row.platform}`)}</Bdi>
          </p>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Button
            aria-label={`${t("scheduled.open")}: ${row.headline}`}
            className="grid h-auto min-h-11 w-full min-w-0 content-start justify-start whitespace-normal p-2 text-start"
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
          <div className="min-w-0 [&_button]:min-h-11 [&_input]:min-h-11">
            <ScheduledPublicationActions
              installationTimeZone={installationTimeZone}
              row={row}
            />
          </div>
        ) : null}
      </li>
    );
  });
}

function SavedCards({
  isPending,
  onFallbackFocus,
  onOpenDraft,
  page,
  query,
  setValues,
}: {
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
      className="min-w-0 border-transparent border-s-2 ps-3 data-pending:border-working"
      data-pending={isPending || undefined}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="grid gap-1">
          <h2
            className="font-medium text-sm"
            id="account-saved-title"
            ref={onFallbackFocus}
            tabIndex={-1}
          >
            {t("saved.title")}
          </h2>
          {isPending ? (
            <span className="font-mono text-working text-xs" role="status">
              {t("saved.updating")}
            </span>
          ) : null}
        </div>
        <LabeledSelect
          busy={isPending}
          className="ms-auto w-auto max-w-full flex-row items-center gap-2 *:w-auto"
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
          triggerClassName="min-h-11 min-w-28"
          value={query.savedState}
        />
      </div>
      {page.rows.length === 0 ? (
        <CompactEmpty description={t("saved.empty")} />
      ) : (
        <section
          aria-label={t("saved.list")}
          className="max-h-144 overflow-y-auto overscroll-contain p-px outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ul className="grid gap-3">
            {page.rows.map((row) => {
              const savedAt = new Date(row.savedAt.valueOf());
              return (
                <li key={row.id}>
                  <Card size="sm">
                    <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <StateMark
                          state={row.discardedAt ? "cancelled" : "succeeded"}
                        />
                        {row.discardedAt
                          ? t("saved.discarded")
                          : t("saved.active")}
                      </CardTitle>
                      <p className="wrap-anywhere text-muted-foreground text-xs">
                        <Bdi>{row.brandName}</Bdi> ·{" "}
                        <Bdi>{t(`platform.${row.platform}`)}</Bdi>
                      </p>
                    </CardHeader>
                    <CardContent>
                      <Button
                        aria-label={`${t("saved.open")}: ${row.headline ?? row.originTitle}`}
                        className="grid h-auto min-h-11 w-full min-w-0 justify-start gap-1 whitespace-normal p-2 text-start"
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
                    </CardContent>
                    <CardFooter className="flex flex-wrap justify-between gap-2 text-muted-foreground text-xs">
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
                        · {row.hasImage ? t("card.image") : t("card.textOnly")}
                      </span>
                    </CardFooter>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <div className="[&_button]:min-h-11">
        <KeysetPagination
          backToLatestLabel={t("saved.latest")}
          newerLabel={t("saved.newer")}
          olderLabel={t("saved.older")}
          offLatest={page.offLatest}
          onBackToLatest={() => void setValues({ savedCursor: null })}
          onNewer={() => void setValues({ savedCursor: page.newerCursor })}
          onOlder={
            page.olderCursor
              ? () => void setValues({ savedCursor: page.olderCursor })
              : null
          }
        />
      </div>
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
    <Empty className="items-start border-0 px-0 py-5 text-start md:px-0 md:py-5">
      <EmptyHeader className="items-start">
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function publicationMark(
  lifecycle: PublishingHistoryRow["lifecycle"],
): StateMarkState {
  switch (lifecycle) {
    case "confirmed":
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "delivery_unknown":
    case "missed_requires_confirmation":
      return "unknown";
    case "effect_claimed":
    case "reserved":
      return "running";
    case "rescheduled":
      return "retrying";
    default:
      return "queued";
  }
}
