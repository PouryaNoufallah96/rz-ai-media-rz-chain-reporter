import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@rz-chain-reporter/ui/components/card";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  FileTextIcon,
  Layers2Icon,
  RadioIcon,
} from "lucide-react";

import { Suspended } from "@/components/fetcher/suspended";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Link } from "@/i18n/navigation";
import { getT } from "@/i18n/server";
import { customerProductName } from "@/lib/customer-template.server";
import { LANDING_NAMESPACE } from "../constants";

export function LandingScreen() {
  return (
    <Suspended
      data={() => getT(LANDING_NAMESPACE)}
      fallback={<LandingHeadingSkeleton />}
    >
      {(t) => (
        <div className="flex flex-col gap-16 sm:gap-24">
          <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <div>
              <h1 className="max-w-2xl text-balance font-semibold text-4xl tracking-display sm:text-5xl lg:text-6xl">
                {t("title")}
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-base text-muted-foreground leading-7">
                {t.rich("body", {
                  product: () => <Bdi>{customerProductName}</Bdi>,
                })}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  className="min-h-11 px-5"
                  nativeButton={false}
                  render={<Link href="/dashboard" />}
                  size="lg"
                >
                  {t("openWorkspace")}
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
                <Button
                  className="min-h-11 px-4"
                  nativeButton={false}
                  render={<Link href="/login" />}
                  size="lg"
                  variant="ghost"
                >
                  {t("signIn")}
                </Button>
              </div>
              <p className="mt-4 text-muted-foreground text-xs">
                {t("access")}
              </p>
            </div>
            <Card aria-labelledby="workflow-heading" className="gap-0 py-0">
              <CardHeader className="flex items-center gap-2 border-b px-5 py-4">
                <Layers2Icon
                  aria-hidden="true"
                  className="size-4 text-primary"
                />
                <h2 className="font-medium text-sm" id="workflow-heading">
                  {t("workflow.title")}
                </h2>
              </CardHeader>
              <CardContent className="px-0">
                <ol className="divide-y">
                  <li className="flex gap-4 p-5">
                    <RadioIcon
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    />
                    <div>
                      <h3 className="font-medium text-sm">
                        {t("workflow.discover")}
                      </h3>
                      <p className="mt-1 text-muted-foreground text-sm leading-6">
                        {t("workflow.discoverBody")}
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-4 p-5">
                    <FileTextIcon
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-primary"
                    />
                    <div>
                      <h3 className="font-medium text-sm">
                        {t("workflow.review")}
                      </h3>
                      <p className="mt-1 text-muted-foreground text-sm leading-6">
                        {t("workflow.reviewBody")}
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-4 p-5">
                    <CheckCircle2Icon
                      aria-hidden="true"
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    />
                    <div>
                      <h3 className="font-medium text-sm">
                        {t("workflow.publish")}
                      </h3>
                      <p className="mt-1 text-muted-foreground text-sm leading-6">
                        {t("workflow.publishBody")}
                      </p>
                    </div>
                  </li>
                </ol>
              </CardContent>
              <CardFooter>
                <p className="text-muted-foreground text-xs">
                  {t("workflow.platforms")}
                </p>
              </CardFooter>
            </Card>
          </section>
          <section className="grid gap-8 border-t pt-10 md:grid-cols-[1fr_1.2fr] md:gap-16">
            <div>
              <h2 className="max-w-sm text-balance font-semibold text-2xl tracking-display">
                {t("control.title")}
              </h2>
              <p className="mt-4 max-w-md text-muted-foreground text-sm leading-6">
                {t("control.body")}
              </p>
            </div>
            <dl className="grid gap-6">
              {(["brands", "visibility", "language"] as const).map((key) => (
                <div
                  className="grid gap-1 sm:grid-cols-[9rem_1fr] sm:gap-6"
                  key={key}
                >
                  <dt className="font-medium text-sm">{t(`control.${key}`)}</dt>
                  <dd className="text-muted-foreground text-sm leading-6">
                    {t(`control.${key}Body`)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </Suspended>
  );
}

async function LandingHeadingSkeleton() {
  const t = await getT(SHARED_NAMESPACE);
  return (
    <div aria-busy className="grid gap-8 lg:grid-cols-2">
      <span className="sr-only" role="status">
        {t("loader.loading")}
      </span>
      <div className="grid content-start gap-5">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-11 w-40" />
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
