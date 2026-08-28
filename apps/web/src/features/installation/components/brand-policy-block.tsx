import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { getFormatter, getT } from "@/i18n/server";
import {
  customerBrandPolicy,
  customerTemplateFingerprint,
} from "@/lib/customer-template.server";

import {
  FINGERPRINT_DISPLAY_LENGTH,
  INSTALLATION_NAMESPACE,
} from "../constants";
import { Identifier } from "./identifier";

const STAMP = { dateStyle: "medium", timeStyle: "short" } as const;

export async function BrandPolicyBlock({
  appliedAt,
}: {
  appliedAt: Date | null;
}) {
  const [t, format] = await Promise.all([
    getT(INSTALLATION_NAMESPACE),
    getFormatter(),
  ]);

  return (
    <>
      <p className="text-muted-foreground text-sm">{t("brandPolicy.hint")}</p>
      <ul className="flex flex-col divide-y divide-border">
        <li className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 py-2 sm:grid">
          <span className="ticket-label">{t("brandPolicy.brand")}</span>
          <span className="ticket-label">{t("brandPolicy.bible")}</span>
          <span className="ticket-label">{t("brandPolicy.profile")}</span>
        </li>
        {customerBrandPolicy.map((brand) => (
          <li
            className="grid items-baseline gap-1.5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-6"
            key={brand.key}
          >
            <span className="min-w-0 text-sm">
              <Bdi>{brand.name}</Bdi>
            </span>
            <ReferenceCell
              label={t("brandPolicy.bible")}
              noneLabel={t("brandPolicy.none")}
              presentLabel={t("brandPolicy.present")}
              reference={brand.brandBible}
            />
            <ReferenceCell
              label={t("brandPolicy.profile")}
              noneLabel={t("brandPolicy.none")}
              presentLabel={t("brandPolicy.present")}
              reference={brand.imageProfile}
            />
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        {t("brandPolicy.fingerprint", {
          id: customerTemplateFingerprint.slice(0, FINGERPRINT_DISPLAY_LENGTH),
        })}
        {appliedAt
          ? ` · ${t("brandPolicy.appliedAt", {
              date: format.dateTime(appliedAt, STAMP),
            })}`
          : ""}
      </p>
    </>
  );
}

function ReferenceCell({
  label,
  noneLabel,
  presentLabel,
  reference,
}: {
  label: string;
  noneLabel: string;
  presentLabel: string;
  reference: { sha256: string } | null;
}) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
      <span className="ticket-label text-muted-foreground sm:hidden">
        {label}
      </span>
      {reference ? (
        <>
          {presentLabel}
          <Identifier>
            {reference.sha256.slice(0, FINGERPRINT_DISPLAY_LENGTH)}
          </Identifier>
        </>
      ) : (
        <Badge
          className="h-auto whitespace-normal text-muted-foreground"
          variant="outline"
        >
          {noneLabel}
        </Badge>
      )}
    </span>
  );
}
