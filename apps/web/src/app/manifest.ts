import { DEFAULT_LOCALE, DIRECTION } from "@rz-chain-reporter/i18n";
import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { PRODUCT_NAME } from "@/lib/branding";

// Outside [locale]; `next/root-params` would throw.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations({
    locale: DEFAULT_LOCALE,
    namespace: SHARED_NAMESPACE,
  });

  return {
    name: PRODUCT_NAME,
    description: t("metadata.description"),
    dir: DIRECTION[DEFAULT_LOCALE],
    lang: DEFAULT_LOCALE,
    start_url: `/${DEFAULT_LOCALE}`,
    display: "standalone",
  };
}
