"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
} from "@rz-chain-reporter/ui/components/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@rz-chain-reporter/ui/components/sheet";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "@rz-chain-reporter/ui/components/stepper";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import {
  ChartSplineIcon,
  CheckIcon,
  CoinsIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  LoaderCircleIcon,
  LockIcon,
  MenuIcon,
  PanelRightIcon,
  PenLineIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  type ComponentProps,
  type ComponentType,
  createContext,
  type ReactNode,
  type SVGProps,
  use,
  useState,
} from "react";

import { Link } from "@/i18n/navigation";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import { MARKET_ANALYSIS_STEPS } from "../schemas/search";

export type MarketAnalysisStep = (typeof MARKET_ANALYSIS_STEPS)[number];

const AnalysisFooterSlot = createContext<HTMLDivElement | null>(null);

export function useAnalysisFooterSlot() {
  return use(AnalysisFooterSlot);
}

const PANEL_COLUMNS =
  "wide:grid-cols-[12rem_minmax(0,1fr)_15rem] workspace:grid-cols-[auto_minmax(0,1fr)]";
const FRAME_BALANCE = "flex min-w-0 flex-1 flex-col";
const FRAME_SPACE_ABOVE = "workspace:block hidden max-h-32 flex-1 basis-0";
const FRAME_SPACE_BELOW = "workspace:block hidden flex-1 basis-0";
const PANEL_VIEWPORT =
  "sticky top-[calc(var(--header-height)+(--spacing(6)))] max-h-[calc(100dvh-var(--header-height)-(--spacing(12)))] overflow-y-auto";

const STEP_ICONS: Record<
  MarketAnalysisStep,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  market: CoinsIcon,
  chart: ChartSplineIcon,
  story: PenLineIcon,
  design: LayoutTemplateIcon,
  generate: SparklesIcon,
  publish: SendIcon,
};

export function AnalysisWorkspaceFrame({
  children,
  completed,
  description,
  historyHref,
  loading = null,
  onStep,
  pending = false,
  reachable,
  selected,
  sidebar,
  sidebarFooter,
  title,
}: {
  children: ReactNode;
  completed: ReadonlySet<MarketAnalysisStep>;
  description: string;
  historyHref: ComponentProps<typeof Link>["href"];
  loading?: MarketAnalysisStep | null;
  onStep: (step: MarketAnalysisStep) => void;
  pending?: boolean;
  reachable: readonly MarketAnalysisStep[];
  selected: MarketAnalysisStep;
  sidebar: ReactNode;
  sidebarFooter?: ReactNode;
  title: string;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null);
  const currentIndex = MARKET_ANALYSIS_STEPS.indexOf(selected);
  const steps = (compact: boolean) => (
    <AnalysisStepper
      compact={compact}
      completed={completed}
      loading={loading}
      onStep={onStep}
      reachable={reachable}
      selected={selected}
    />
  );

  return (
    <div className={FRAME_BALANCE}>
      <div className={FRAME_SPACE_ABOVE} />
      <div className="flex min-w-0 flex-none flex-col gap-4">
        <div className="grid wide:hidden workspace:grid-cols-1 gap-2 sm:grid-cols-2">
          <Sheet>
            <SheetTrigger
              render={
                <Button
                  className="workspace:hidden w-full justify-between"
                  variant="outline"
                />
              }
            >
              <span>
                {t("shell.progress", {
                  step: t(`steps.${selected}`),
                  current: currentIndex + 1,
                  total: MARKET_ANALYSIS_STEPS.length,
                })}
              </span>
              <MenuIcon aria-hidden="true" />
            </SheetTrigger>
            <SheetContent closeLabel={t("shell.closeSteps")} side="block-end">
              <SheetHeader>
                <SheetTitle>{t("shell.openSteps")}</SheetTitle>
              </SheetHeader>
              {steps(false)}
              <HistoryLink compact={false} href={historyHref} />
            </SheetContent>
          </Sheet>
          <Sheet>
            <SheetTrigger
              render={
                <Button className="w-full justify-between" variant="outline" />
              }
            >
              <span>{t("shell.project")}</span>
              <PanelRightIcon aria-hidden="true" className="rtl:-scale-x-100" />
            </SheetTrigger>
            <SheetContent closeLabel={t("shell.closeProject")} side="block-end">
              <SheetHeader>
                <SheetTitle className="sr-only">
                  {t("shell.project")}
                </SheetTitle>
              </SheetHeader>
              {sidebar}
              {sidebarFooter ? (
                <div className="border-t p-4">{sidebarFooter}</div>
              ) : null}
            </SheetContent>
          </Sheet>
        </div>
        <div className={cn("grid min-w-0 gap-4", PANEL_COLUMNS)}>
          <Card
            className={cn(
              "workspace:flex hidden gap-0 bg-sidebar py-0",
              PANEL_VIEWPORT,
            )}
          >
            <div className="min-w-0 flex-1 p-2">{steps(true)}</div>
            <CardFooter className="mt-auto max-wide:p-2">
              <HistoryLink compact href={historyHref} />
            </CardFooter>
          </Card>
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="grow">
              <CardContent
                aria-busy={pending || undefined}
                className="@container grid min-w-0 content-start gap-4 data-pending:pointer-events-none data-pending:animate-pulse motion-reduce:animate-none"
                data-pending={pending || undefined}
              >
                <span className="sr-only" role="status">
                  {pending ? t("shell.updating") : ""}
                </span>
                <header className="grid gap-1">
                  <h1 className="font-semibold text-xl tracking-tight">
                    {title}
                  </h1>
                  <p className="max-w-2xl text-muted-foreground text-sm">
                    {description}
                  </p>
                </header>
                <AnalysisFooterSlot value={footerSlot}>
                  {children}
                </AnalysisFooterSlot>
              </CardContent>
            </Card>
            <div className="contents" ref={setFooterSlot} />
          </div>
          <Card
            className={cn(
              "wide:flex hidden min-w-0 gap-0 bg-sidebar py-0",
              PANEL_VIEWPORT,
            )}
          >
            {sidebar}
            {sidebarFooter ? (
              <div className="mt-auto border-t p-4">{sidebarFooter}</div>
            ) : null}
          </Card>
        </div>
      </div>
      <div className={FRAME_SPACE_BELOW} />
    </div>
  );
}

export function AnalysisFrameSkeleton() {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  return (
    <div aria-busy className={FRAME_BALANCE}>
      <div className={FRAME_SPACE_ABOVE} />
      <div className="flex min-w-0 flex-none flex-col gap-4">
        <div className="grid wide:hidden workspace:grid-cols-1 gap-2 sm:grid-cols-2">
          <Skeleton className="workspace:hidden h-8 rounded-lg" />
          <Skeleton className="h-8 rounded-lg" />
        </div>
        <div className={cn("grid min-w-0 gap-4", PANEL_COLUMNS)}>
          <Skeleton className="workspace:block hidden wide:w-auto workspace:w-15 rounded-xl" />
          <div className="flex min-w-0 flex-col gap-4">
            <Skeleton className="min-h-120 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
          <Skeleton className="wide:block hidden rounded-xl" />
          <span className="sr-only" role="status">
            {t("shell.loading")}
          </span>
        </div>
      </div>
      <div className={FRAME_SPACE_BELOW} />
    </div>
  );
}

function HistoryLink({
  compact,
  href,
}: {
  compact: boolean;
  href: ComponentProps<typeof Link>["href"];
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const label = t("history.openHistory");
  return (
    <Button
      className={cn(
        "w-full justify-start",
        compact &&
          "max-wide:mx-auto max-wide:size-11 max-wide:justify-center max-wide:px-0",
      )}
      nativeButton={false}
      render={<Link href={href} />}
      title={compact ? label : undefined}
      variant="outline"
    >
      <HistoryIcon
        aria-hidden="true"
        data-icon={compact ? undefined : "inline-start"}
      />
      <span className={cn(compact && "max-wide:sr-only")}>{label}</span>
    </Button>
  );
}

function AnalysisStepper({
  compact,
  completed,
  loading,
  onStep,
  reachable,
  selected,
}: {
  compact: boolean;
  completed: ReadonlySet<MarketAnalysisStep>;
  loading: MarketAnalysisStep | null;
  onStep: (step: MarketAnalysisStep) => void;
  reachable: readonly MarketAnalysisStep[];
  selected: MarketAnalysisStep;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const format = useFormatter();
  return (
    <Stepper aria-label={t("shell.openSteps")}>
      {MARKET_ANALYSIS_STEPS.map((step, index) => {
        const available = reachable.includes(step);
        const complete = completed.has(step);
        const busy = loading === step;
        const name = t(`steps.${step}`);
        const reason = available
          ? undefined
          : t("shell.locked", { step: name });
        const StepIcon = STEP_ICONS[step];
        return (
          <StepperItem
            data-complete={complete || undefined}
            data-current={selected === step || undefined}
            key={step}
          >
            {index < MARKET_ANALYSIS_STEPS.length - 1 ? (
              <StepperSeparator
                className={cn(compact && "max-wide:inset-s-[calc(50%-1px)]")}
              />
            ) : null}
            <StepperTrigger
              aria-busy={busy || undefined}
              aria-current={selected === step ? "step" : undefined}
              aria-label={reason ? `${name}. ${reason}` : name}
              className={cn(
                compact &&
                  "max-wide:mx-auto max-wide:size-11 max-wide:justify-center max-wide:gap-0 max-wide:px-0 max-wide:py-0",
              )}
              disabled={!available}
              onClick={() => onStep(step)}
              title={reason ?? (compact ? name : undefined)}
            >
              <StepperIndicator className={cn(compact && "max-wide:size-8")}>
                {busy ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                  />
                ) : complete ? (
                  <CheckIcon aria-hidden="true" className="size-3.5" />
                ) : compact ? (
                  <>
                    <StepIcon
                      aria-hidden="true"
                      className="wide:hidden size-4"
                    />
                    <span className="max-wide:hidden">
                      {format.number(index + 1)}
                    </span>
                  </>
                ) : (
                  format.number(index + 1)
                )}
              </StepperIndicator>
              <StepIcon
                aria-hidden="true"
                className={cn("size-4 shrink-0", compact && "max-wide:hidden")}
              />
              <StepperTitle className={cn(compact && "max-wide:hidden")}>
                {name}
              </StepperTitle>
              {available ? null : (
                <LockIcon
                  aria-hidden="true"
                  className={cn(
                    "ms-auto size-3.5 shrink-0",
                    compact && "max-wide:hidden",
                  )}
                />
              )}
            </StepperTrigger>
          </StepperItem>
        );
      })}
    </Stepper>
  );
}
