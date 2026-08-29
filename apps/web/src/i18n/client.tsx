import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";

import { type CatalogNamespace, loadCatalog } from "./catalog";
import { NOW } from "./config";
import { currentLocale } from "./server";

export async function Localized({
  children,
  namespaces,
}: {
  children: ReactNode;
  namespaces: readonly CatalogNamespace[];
}) {
  const locale = await currentLocale();
  const catalog = await loadCatalog(locale);

  const messages = Object.fromEntries(
    namespaces.map((namespace) => [namespace, catalog[namespace]]),
  );

  return (
    <NextIntlClientProvider locale={locale} messages={messages} now={NOW}>
      {children}
    </NextIntlClientProvider>
  );
}
