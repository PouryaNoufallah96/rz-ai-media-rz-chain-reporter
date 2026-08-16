import { env } from "@rz-chain-reporter/env/server";
import { LOCALES } from "@rz-chain-reporter/i18n";
import type { MetadataRoute } from "next";

import { getPathname } from "@/i18n/navigation";

const PUBLIC_HREFS = ["/"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
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

function absolute(href: (typeof PUBLIC_HREFS)[number], locale: string) {
  return env.APP_URL + getPathname({ href, locale: locale as never });
}
