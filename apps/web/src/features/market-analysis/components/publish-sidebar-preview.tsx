"use client";

import {
  Button,
  buttonVariants,
} from "@rz-chain-reporter/ui/components/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalTrigger,
} from "@rz-chain-reporter/ui/components/responsive-modal";
import { DownloadIcon, ExpandIcon } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import type { MarketAnalysisProjection } from "../schemas/reads";

export function PublishSidebarPreview({
  analysis,
}: {
  analysis: MarketAnalysisProjection;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const mediaId = analysis.generation?.finalMediaAssetId;
  if (!mediaId) return null;
  const url = `/api/media/${mediaId}`;
  return (
    <div className="grid min-w-0 gap-2">
      <span className="ticket-label text-muted-foreground">
        {t("publish.approvedPost")}
      </span>
      <Image
        alt={t("publish.approvedPostAlt")}
        className="h-auto w-full rounded-lg border object-contain"
        height={1350}
        loading="eager"
        src={url}
        unoptimized
        width={1080}
      />
      <div className="flex flex-wrap gap-2">
        <a
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={`${url}?download=1`}
        >
          <DownloadIcon aria-hidden="true" />
          {t("publish.downloadPost")}
        </a>
        <ResponsiveModal>
          <ResponsiveModalTrigger
            render={<Button size="sm" type="button" variant="outline" />}
          >
            <ExpandIcon aria-hidden="true" data-icon="inline-start" />
            {t("publish.viewFull")}
          </ResponsiveModalTrigger>
          <ResponsiveModalContent className="max-w-3xl">
            <ResponsiveModalHeader>
              <ResponsiveModalTitle>
                {t("publish.approvedPost")}
              </ResponsiveModalTitle>
              <ResponsiveModalDescription>
                {t("publish.approvedPostAlt")}
              </ResponsiveModalDescription>
            </ResponsiveModalHeader>
            <Image
              alt={t("publish.approvedPostAlt")}
              className="h-auto max-h-[70vh] w-full rounded-lg border object-contain"
              height={1350}
              src={url}
              unoptimized
              width={1080}
            />
          </ResponsiveModalContent>
        </ResponsiveModal>
      </div>
    </div>
  );
}
