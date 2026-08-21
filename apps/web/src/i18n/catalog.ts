import type { Locale } from "@rz-chain-reporter/i18n";
import { cacheLife } from "next/cache";

import authEn from "@/features/auth/messages/en.json";
import authFa from "@/features/auth/messages/fa.json";
import dashboardEn from "@/features/dashboard/messages/en.json";
import dashboardFa from "@/features/dashboard/messages/fa.json";
import installationEn from "@/features/installation/messages/en.json";
import installationFa from "@/features/installation/messages/fa.json";
import landingEn from "@/features/landing/messages/en.json";
import landingFa from "@/features/landing/messages/fa.json";
import operationsEn from "@/features/operations/messages/en.json";
import operationsFa from "@/features/operations/messages/fa.json";
import sharedEn from "@/features/shared/messages/en.json";
import sharedFa from "@/features/shared/messages/fa.json";
import usageEn from "@/features/usage/messages/en.json";
import usageFa from "@/features/usage/messages/fa.json";

const CATALOGS = {
  en: {
    ...sharedEn,
    ...authEn,
    ...dashboardEn,
    ...installationEn,
    ...landingEn,
    ...operationsEn,
    ...usageEn,
  },
  fa: {
    ...sharedFa,
    ...authFa,
    ...dashboardFa,
    ...installationFa,
    ...landingFa,
    ...operationsFa,
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
