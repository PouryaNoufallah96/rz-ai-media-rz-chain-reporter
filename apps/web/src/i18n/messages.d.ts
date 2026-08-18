import type { Locale } from "@rz-chain-reporter/i18n";

import type authEn from "@/features/auth/messages/en.json";
import type installationEn from "@/features/installation/messages/en.json";
import type operationsEn from "@/features/operations/messages/en.json";
import type sharedEn from "@/features/shared/messages/en.json";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof sharedEn &
      typeof authEn &
      typeof installationEn &
      typeof operationsEn;
  }
}
