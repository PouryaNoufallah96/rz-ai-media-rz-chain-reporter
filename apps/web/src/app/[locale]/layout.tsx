import { DIRECTION, isLocale, LOCALES } from "@rz-chain-reporter/i18n";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Vazirmatn } from "next/font/google";
import { notFound } from "next/navigation";
import { locale as localeRootParam } from "next/root-params";

import "@/index.css";
import Header from "@/components/layout/header";
import Providers from "@/components/providers";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Preload links are keyed by layout path, not locale — true would ship Vazirmatn on `en`.
const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic", "latin"],
  preload: false,
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT(SHARED_NAMESPACE);

  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await localeRootParam();

  if (!isLocale(locale)) {
    notFound();
  }

  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable} ${vazirmatn.variable}`}
      dir={DIRECTION[locale]}
      lang={locale}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Providers locale={locale}>
          <div className="grid h-svh grid-rows-[auto_1fr]">
            <Header />
            <Localized namespaces={[SHARED_NAMESPACE]}>{children}</Localized>
          </div>
        </Providers>
      </body>
    </html>
  );
}
