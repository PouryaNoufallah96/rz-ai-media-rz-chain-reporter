"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@rz-chain-reporter/ui/components/card";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { useTranslations } from "next-intl";

import { ASSISTANT_NAMESPACE } from "../constants";
import type {
  AssistantRunFormLoadResponse,
  SignedApprovalEnvelope,
} from "../schemas/approval";

export function AssistantProposal({
  active,
  envelope,
  error,
  form,
  onApprove,
  onCancel,
  onEdit,
  pending,
}: {
  active: boolean;
  envelope: SignedApprovalEnvelope;
  error: string | null;
  form: AssistantRunFormLoadResponse | null;
  onApprove: () => void;
  onCancel: () => void;
  onEdit: () => void;
  pending: boolean;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const configuration = envelope.payload.configuration;
  const brands =
    configuration.kind === "news"
      ? configuration.brands
      : configuration.promo.brands;
  const brandNames = brands.map(
    (key) =>
      form?.options.brands.find((brand) => brand.key === key)?.name ?? key,
  );
  const modelNames = configuration.models.map(
    (key) =>
      form?.options.models.find((model) => model.key === key)?.name ?? key,
  );
  const sourceNames =
    configuration.kind === "news"
      ? configuration.sourceIds.map(
          (id) => form?.sources.find((source) => source.id === id)?.name ?? id,
        )
      : [];

  return (
    <Card data-assistant-proposal size="sm">
      <CardHeader>
        <CardTitle>{t("proposal.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t("proposal.kind")}</dt>
          <dd>
            <Bdi>{t(`proposal.kindValue.${configuration.kind}`)}</Bdi>
          </dd>
          <dt className="text-muted-foreground">{t("proposal.brands")}</dt>
          <dd className="wrap-anywhere">
            <Bdi>{brandNames.join(", ")}</Bdi>
          </dd>
          <dt className="text-muted-foreground">{t("proposal.models")}</dt>
          <dd className="wrap-anywhere">
            <Bdi>{modelNames.join(", ")}</Bdi>
          </dd>
          <dt className="text-muted-foreground">{t("proposal.platforms")}</dt>
          <dd>
            <Bdi translate="no">
              {(configuration.platforms ?? []).join(", ")}
            </Bdi>
          </dd>
          {configuration.kind === "news" ? (
            <>
              <dt className="text-muted-foreground">{t("proposal.sources")}</dt>
              <dd className="tabular-nums">
                <details>
                  <summary>
                    {t("proposal.sourceCount", {
                      count: configuration.sourceIds.length,
                    })}
                  </summary>
                  <Bdi className="wrap-anywhere mt-1 block text-muted-foreground">
                    {sourceNames.join(", ")}
                  </Bdi>
                </details>
              </dd>
              <dt className="text-muted-foreground">{t("proposal.window")}</dt>
              <dd className="tabular-nums">
                {t("proposal.hours", { count: configuration.windowHours })}
              </dd>
              <dt className="text-muted-foreground">
                {t("proposal.enrichment")}
              </dt>
              <dd>
                {t(`proposal.boolean.${configuration.enrichmentEnabled}`)}
              </dd>
              <dt className="text-muted-foreground">
                {t("proposal.telegramOnly")}
              </dt>
              <dd>{t(`proposal.boolean.${configuration.telegramOnly}`)}</dd>
              <dt className="text-muted-foreground">
                {t("proposal.ordering")}
              </dt>
              <dd>
                <Bdi translate="no">{configuration.orderingMode}</Bdi>
              </dd>
              <dt className="text-muted-foreground">{t("proposal.topN")}</dt>
              <dd className="tabular-nums">{configuration.topN}</dd>
              <dt className="text-muted-foreground">{t("proposal.topics")}</dt>
              <dd>
                <Bdi>
                  {configuration.topics.length > 0
                    ? configuration.topics.join(", ")
                    : t("proposal.none")}
                </Bdi>
              </dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">
                {t("proposal.promoText")}
              </dt>
              <dd>
                <details>
                  <summary>{t("proposal.showPromoText")}</summary>
                  <div className="mt-1 grid gap-1 text-muted-foreground">
                    {configuration.promo.brands.map((brand) => (
                      <Bdi className="wrap-anywhere" key={brand}>
                        {configuration.promo.prompts[brand]}
                      </Bdi>
                    ))}
                  </div>
                </details>
              </dd>
            </>
          )}
        </dl>
        <p className="mt-3 text-muted-foreground text-xs">
          {t("proposal.consequence")}
        </p>
        {error ? (
          <p className="mt-2 text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        {!active ? (
          <p className="mt-2 text-muted-foreground text-xs">
            {t("proposal.superseded")}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end gap-1.5">
        <Button
          disabled={pending || !active}
          onClick={onCancel}
          size="sm"
          variant="ghost"
        >
          {t("proposal.cancel")}
        </Button>
        <Button
          disabled={pending || !active}
          onClick={onEdit}
          size="sm"
          variant="outline"
        >
          {t("proposal.edit")}
        </Button>
        <Button disabled={pending || !active} onClick={onApprove} size="sm">
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? t("proposal.approving") : t("proposal.approve")}
        </Button>
      </CardFooter>
    </Card>
  );
}
