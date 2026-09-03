import type { Locale } from "@rz-chain-reporter/i18n";
import { cacheLife } from "next/cache";

import accountEn from "@/features/account/messages/en.json";
import accountFa from "@/features/account/messages/fa.json";
import assistantEn from "@/features/assistant/messages/en.json";
import assistantFa from "@/features/assistant/messages/fa.json";
import authEn from "@/features/auth/messages/en.json";
import authFa from "@/features/auth/messages/fa.json";
import editorialEn from "@/features/editorial/messages/en.json";
import editorialFa from "@/features/editorial/messages/fa.json";
import installationEn from "@/features/installation/messages/en.json";
import installationFa from "@/features/installation/messages/fa.json";
import landingEn from "@/features/landing/messages/en.json";
import landingFa from "@/features/landing/messages/fa.json";
import marketAnalysisEn from "@/features/market-analysis/messages/en.json";
import marketAnalysisFa from "@/features/market-analysis/messages/fa.json";
import operationsEn from "@/features/operations/messages/en.json";
import operationsFa from "@/features/operations/messages/fa.json";
import publishingEn from "@/features/publishing/messages/en.json";
import publishingFa from "@/features/publishing/messages/fa.json";
import sharedEn from "@/features/shared/messages/en.json";
import sharedFa from "@/features/shared/messages/fa.json";
import sourcesEn from "@/features/sources/messages/en.json";
import sourcesFa from "@/features/sources/messages/fa.json";
import usageEn from "@/features/usage/messages/en.json";
import usageFa from "@/features/usage/messages/fa.json";

const CATALOGS = {
  en: {
    ...accountEn,
    ...assistantEn,
    ...sharedEn,
    ...authEn,
    ...editorialEn,
    ...installationEn,
    ...landingEn,
    ...marketAnalysisEn,
    ...operationsEn,
    ...publishingEn,
    ...sourcesEn,
    ...usageEn,
  },
  fa: {
    ...accountFa,
    ...assistantFa,
    ...sharedFa,
    ...authFa,
    ...editorialFa,
    ...installationFa,
    ...landingFa,
    ...marketAnalysisFa,
    ...operationsFa,
    ...publishingFa,
    ...sourcesFa,
    ...usageFa,
  },
} satisfies Record<Locale, unknown>;

export type Catalog = (typeof CATALOGS)["en"];

export type CatalogNamespace = keyof Catalog;

// `locale` must stay an argument; it is what keys the cache entry.
export async function loadCatalog(locale: Locale): Promise<Catalog> {
  "use cache";
  cacheLife("max");
  return CATALOGS[locale];
}
