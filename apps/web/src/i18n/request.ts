import { isLocale } from "@rz-chain-reporter/i18n";
import { getRequestConfig } from "next-intl/server";

import { customerTimeZone } from "@/lib/customer-template.server";
import { loadCatalog } from "./catalog";
import { NOW } from "./config";
import { currentLocale } from "./server";

// Never read `requestLocale` — it hits `headers()`. Root param only.
export default getRequestConfig(async ({ locale }) => {
  const active = isLocale(locale) ? locale : await currentLocale();

  return {
    locale: active,
    now: NOW,
    messages: await loadCatalog(active),
    timeZone: customerTimeZone,
  };
});
