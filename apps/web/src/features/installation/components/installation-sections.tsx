import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import type { ReactNode } from "react";

import { PlatformIcon } from "@/components/common/platform-icon";
import { SectionCard } from "@/components/common/section-card";
import { getFormatter, getT } from "@/i18n/server";

import { INSTALLATION_NAMESPACE } from "../constants";
import type { InstallationOverview } from "../schemas/installation-overview";
import { BrandPolicyBlock } from "./brand-policy-block";
import { Identifier } from "./identifier";
import { StateBadge } from "./state-badge";

const STAMP = { dateStyle: "medium", timeStyle: "short" } as const;

export async function InstallationSections({
  installation,
}: {
  installation: InstallationOverview;
}) {
  const [t, format] = await Promise.all([
    getT(INSTALLATION_NAMESPACE),
    getFormatter(),
  ]);
  const { destinations, identity, mediaBrands, sources } = installation;

  return (
    <div className="mt-6 grid gap-4">
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <SectionCard content="grid" section title={t("identity.title")}>
          <dl className="grid gap-4 sm:grid-cols-2">
            <DefinitionItem label={t("labels.workspace")}>
              {identity.workspaceName}
            </DefinitionItem>
            <DefinitionItem label={t("labels.template")}>
              {identity.templateKey ? (
                <Identifier>{identity.templateKey}</Identifier>
              ) : (
                t("identity.notRecorded")
              )}
            </DefinitionItem>
            <DefinitionItem label={t("labels.schemaVersion")}>
              <Identifier>{identity.templateSchemaVersion}</Identifier>
            </DefinitionItem>
            <DefinitionItem label={t("labels.fingerprint")}>
              {identity.templateFingerprintShort ? (
                <Identifier>{identity.templateFingerprintShort}</Identifier>
              ) : (
                t("identity.notRecorded")
              )}
            </DefinitionItem>
            <DefinitionItem label={t("labels.appliedAt")}>
              {identity.templateAppliedAt ? (
                <time dateTime={identity.templateAppliedAt.toISOString()}>
                  {format.dateTime(identity.templateAppliedAt, STAMP)}
                </time>
              ) : (
                t("identity.notRecorded")
              )}
            </DefinitionItem>
          </dl>
        </SectionCard>

        <SectionCard content="grid" section title={t("mediaBrands.title")}>
          <List>
            {mediaBrands.map((brand) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                key={brand.key}
              >
                <span className="wrap-anywhere text-sm">{brand.name}</span>
                <Identifier>{brand.key}</Identifier>
              </li>
            ))}
          </List>
        </SectionCard>

        <SectionCard content="grid" section title={t("brandPolicy.title")}>
          <BrandPolicyBlock appliedAt={identity.templateAppliedAt} />
        </SectionCard>

        <SectionCard content="grid" section title={t("destinations.title")}>
          {destinations.length === 0 ? (
            <EmptyLine>{t("destinations.empty")}</EmptyLine>
          ) : (
            <List>
              {destinations.map((destination) => (
                <li className="flex flex-col gap-2 py-3" key={destination.key}>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                    <span className="wrap-anywhere flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <PlatformIcon
                        className="size-4 shrink-0"
                        platform={destination.platform}
                      />
                      <Bdi>{destination.label}</Bdi>
                    </span>
                    <StateBadge
                      tone={
                        destination.binding === "unbound"
                          ? "warning"
                          : "neutral"
                      }
                    >
                      {t(`state.${destination.binding}`)}
                    </StateBadge>
                  </div>
                  {destination.bindingCheckedAt ||
                  destination.binding === "unchecked" ? (
                    <p className="text-muted-foreground text-xs">
                      {destination.bindingCheckedAt ? (
                        <time
                          dateTime={destination.bindingCheckedAt.toISOString()}
                        >
                          {t("destinations.checkedAt", {
                            date: format.dateTime(
                              destination.bindingCheckedAt,
                              STAMP,
                            ),
                          })}
                        </time>
                      ) : (
                        t("destinations.neverChecked")
                      )}
                    </p>
                  ) : null}
                  <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <DefinitionItem label={t("labels.key")}>
                      <Identifier>{destination.key}</Identifier>
                    </DefinitionItem>
                    <DefinitionItem label={t("labels.platform")}>
                      <Identifier>{destination.platform}</Identifier>
                    </DefinitionItem>
                    {destination.instagram ? (
                      <DefinitionItem label={t("labels.professionalAccountId")}>
                        <Identifier>
                          {destination.instagram.professionalAccountId}
                        </Identifier>
                      </DefinitionItem>
                    ) : null}
                    {destination.instagram?.username ? (
                      <DefinitionItem label={t("labels.username")}>
                        <Identifier>
                          {destination.instagram.username}
                        </Identifier>
                      </DefinitionItem>
                    ) : null}
                  </dl>
                </li>
              ))}
            </List>
          )}
        </SectionCard>

        <SectionCard
          content="grid"
          section="lg:col-span-2"
          title={t("mapping.title")}
        >
          <List>
            {mediaBrands.map((brand) => (
              <li
                className="grid min-w-0 items-start gap-x-6 gap-y-2 py-3 sm:grid-cols-3"
                key={brand.key}
              >
                <span className="wrap-anywhere min-w-0 text-sm">
                  <Bdi>{brand.name}</Bdi>
                </span>
                {brand.destinationKeys.length === 0 ? (
                  <span className="min-w-0 text-muted-foreground text-sm sm:col-span-2">
                    {t("mapping.none")}
                  </span>
                ) : (
                  <ul className="flex min-w-0 flex-wrap gap-x-6 gap-y-2 sm:col-span-2">
                    {brand.destinationKeys.map((destinationKey) => (
                      <li key={destinationKey}>
                        <Identifier>{destinationKey}</Identifier>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </List>
        </SectionCard>
      </div>
      <div className="min-w-0">
        <SectionCard content="grid" section title={t("sources.title")}>
          {sources.length === 0 ? (
            <EmptyLine>{t("sources.empty")}</EmptyLine>
          ) : (
            <List>
              {sources.map((source) => (
                <li className="flex flex-col gap-2 py-3" key={source.key}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="wrap-anywhere text-sm">{source.name}</span>
                    <StateBadge>
                      {source.enabled
                        ? t("state.enabled")
                        : t("state.disabledByTemplate")}
                    </StateBadge>
                  </div>
                  <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <DefinitionItem label={t("labels.key")}>
                      <Identifier>{source.key}</Identifier>
                    </DefinitionItem>
                    <DefinitionItem label={t("labels.origin")}>
                      <Identifier>{source.origin}</Identifier>
                    </DefinitionItem>
                    <DefinitionItem label={t("labels.endpoint")}>
                      <Identifier>{source.endpoint}</Identifier>
                    </DefinitionItem>
                  </dl>
                </li>
              ))}
            </List>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

export function InstallationSectionsSkeleton({
  loadingLabel,
  sections,
}: {
  loadingLabel: string;
  sections: readonly { key: string; title: string }[];
}) {
  return (
    <div aria-busy="true" className="mt-6 grid gap-4">
      <p className="sr-only" role="status">
        {loadingLabel}
      </p>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {sections.map(({ key, title }) =>
          key === "sources" ? null : (
            <SectionCard
              content="grid"
              key={key}
              section={key === "mapping" ? "lg:col-span-2" : true}
              title={title}
            >
              <Skeleton
                className={key === "identity" ? "h-20 w-full" : "h-36 w-full"}
              />
            </SectionCard>
          ),
        )}
      </div>
      {sections.map(({ key, title }) =>
        key !== "sources" ? null : (
          <SectionCard content="grid" key={key} section title={title}>
            <Skeleton className="h-144 w-full" />
          </SectionCard>
        ),
      )}
    </div>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className="flex min-w-0 flex-col divide-y divide-border">{children}</ul>
  );
}

function DefinitionItem({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="wrap-anywhere text-sm">{children}</dd>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
