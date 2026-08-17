import type { Locale } from "@rz-chain-reporter/i18n";

import authEn from "@/features/auth/messages/en.json";
import authFa from "@/features/auth/messages/fa.json";
import operationsEn from "@/features/operations/messages/en.json";
import operationsFa from "@/features/operations/messages/fa.json";
import sharedEn from "@/features/shared/messages/en.json";
import sharedFa from "@/features/shared/messages/fa.json";

const CATALOGS = {
  en: { ...sharedEn, ...authEn, ...operationsEn },
  fa: { ...sharedFa, ...authFa, ...operationsFa },
} satisfies Record<Locale, unknown>;

export type Catalog = (typeof CATALOGS)["en"];

export type CatalogNamespace = keyof Catalog;

// `locale` must stay an argument; it is what keys the cache entry.
export async function loadCatalog(locale: Locale): Promise<Catalog> {
  "use cache";
  return CATALOGS[locale] as Catalog;
}
