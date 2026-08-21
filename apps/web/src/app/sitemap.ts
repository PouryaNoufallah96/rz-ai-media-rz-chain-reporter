import { env } from "@rz-chain-reporter/env/server";
import { LOCALES, type Locale } from "@rz-chain-reporter/i18n";
import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { getPathname } from "@/i18n/navigation";

const PUBLIC_HREFS = ["/"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();

  return PUBLIC_HREFS.flatMap((href) =>
    LOCALES.map((locale) => ({
      url: absolute(href, locale),
      alternates: {
        languages: Object.fromEntries(
          LOCALES.map((alternate) => [alternate, absolute(href, alternate)]),
        ),
      },
    })),
  );
}

function absolute(href: (typeof PUBLIC_HREFS)[number], locale: Locale) {
  return env.APP_URL + getPathname({ href, locale });
}
