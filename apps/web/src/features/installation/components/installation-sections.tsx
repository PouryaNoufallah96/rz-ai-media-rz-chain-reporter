import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import type { ReactNode } from "react";

import { getFormatter, getT } from "@/i18n/server";

import { INSTALLATION_NAMESPACE } from "../constants";
import type { InstallationOverview } from "../schemas/installation-overview";
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
    <div className="mt-10 flex flex-col gap-10">
      <Section title={t("identity.title")}>
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
      </Section>

      <Section title={t("mediaBrands.title")}>
        <List>
          {mediaBrands.map((brand) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-2 py-2"
              key={brand.key}
            >
              <span className="text-sm">{brand.name}</span>
              <Identifier>{brand.key}</Identifier>
            </li>
          ))}
        </List>
      </Section>

      <Section title={t("sources.title")}>
        {sources.length === 0 ? (
          <EmptyLine>{t("sources.empty")}</EmptyLine>
        ) : (
          <List>
            {sources.map((source) => (
              <li className="flex flex-col gap-2 py-3" key={source.key}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{source.name}</span>
                  <StateBadge>
                    {source.enabled
                      ? t("state.enabled")
                      : t("state.disabledByTemplate")}
                  </StateBadge>
                </div>
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
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
      </Section>

      <Section title={t("destinations.title")}>
        {destinations.length === 0 ? (
          <EmptyLine>{t("destinations.empty")}</EmptyLine>
        ) : (
          <List>
            {destinations.map((destination) => (
              <li className="flex flex-col gap-2 py-3" key={destination.key}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{destination.label}</span>
                  <StateBadge
                    tone={
                      destination.binding === "unbound" ? "warning" : "neutral"
                    }
                  >
                    {t(`state.${destination.binding}`)}
                  </StateBadge>
                  <span className="text-muted-foreground text-xs">
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
                    ) : destination.binding === "unchecked" ? (
                      t("destinations.neverChecked")
                    ) : null}
                  </span>
                </div>
                <dl className="flex flex-wrap gap-x-8 gap-y-2">
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
                      <Identifier>{destination.instagram.username}</Identifier>
                    </DefinitionItem>
                  ) : null}
                </dl>
              </li>
            ))}
          </List>
        )}
      </Section>

      <Section title={t("mapping.title")}>
        <List>
          {mediaBrands.map((brand) => (
            <li
              className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-2"
              key={brand.key}
            >
              <span className="text-sm">{brand.name}</span>
              {brand.destinationKeys.length === 0 ? (
                <span className="text-muted-foreground text-sm">
                  {t("mapping.none")}
                </span>
              ) : (
                <ul className="flex flex-wrap gap-x-4 gap-y-1">
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
      </Section>
    </div>
  );
}

export function InstallationSectionsSkeleton({
  loadingLabel,
  sectionTitles,
}: {
  loadingLabel: string;
  sectionTitles: readonly string[];
}) {
  return (
    <div aria-busy="true" className="mt-10 flex flex-col gap-10">
      <p className="sr-only" role="status">
        {loadingLabel}
      </p>
      {sectionTitles.map((title, index) => (
        <Section key={title} title={title}>
          <Skeleton className={index === 0 ? "h-20 w-full" : "h-36 w-full"} />
        </Section>
      ))}
    </div>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold text-lg">{title}</h2>
      {children}
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col divide-y divide-border border-border border-y">
      {children}
    </ul>
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
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
