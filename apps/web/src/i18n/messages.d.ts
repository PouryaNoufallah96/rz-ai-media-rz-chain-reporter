import type { Locale } from "@rz-chain-reporter/i18n";

import type { Catalog } from "./catalog";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Catalog;
  }
}
