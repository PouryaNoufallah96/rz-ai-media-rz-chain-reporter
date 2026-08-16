import { DEFAULT_LOCALE, isLocale, type Locale } from "@rz-chain-reporter/i18n";
import { locale as localeRootParam } from "next/root-params";
import { getRequestConfig } from "next-intl/server";

import { loadCatalog } from "./catalog";
import { FORMATS, NOW, TIME_ZONE } from "./config";

async function resolveFromRootParams(): Promise<Locale> {
  const value = await localeRootParam();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

// Never read `requestLocale` — it hits `headers()`. Root param only.
export default getRequestConfig(async ({ locale }) => {
  const active = isLocale(locale) ? locale : await resolveFromRootParams();

  return {
    formats: FORMATS,
    locale: active,
    now: NOW,
    messages: await loadCatalog(active),
    timeZone: TIME_ZONE,
  };
});
