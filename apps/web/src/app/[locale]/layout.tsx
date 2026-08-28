import {
  DIRECTION,
  isLocale,
  LOCALES,
  SCRIPT,
  UI_FONT,
} from "@rz-chain-reporter/i18n";
import type { Metadata } from "next";
import { Geist_Mono, Vazirmatn } from "next/font/google";
import { notFound } from "next/navigation";
import { locale as localeRootParam } from "next/root-params";

import "@/index.css";
import { Footer } from "@/components/layout/footer";
import Header from "@/components/layout/header";
import Providers from "@/components/providers";
import { AssistantScope } from "@/features/assistant/components/assistant-scope";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";
import { getT } from "@/i18n/server";
import {
  customerProductName,
  customerTimeZone,
} from "@/lib/customer-template.server";
import { geistSans } from "@/lib/fonts";

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
    title: customerProductName,
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
      data-script={SCRIPT[locale]}
      dir={DIRECTION[locale]}
      lang={locale}
      style={
        {
          "--font-ui-sans": UI_FONT[locale],
        } as React.CSSProperties
      }
      suppressHydrationWarning
    >
      <body className="min-w-0 antialiased">
        <Providers locale={locale} timeZone={customerTimeZone}>
          <AssistantScope>
            <div className="grid min-h-svh min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
              <Header />
              <Localized namespaces={[SHARED_NAMESPACE]}>{children}</Localized>
              <Footer />
            </div>
          </AssistantScope>
        </Providers>
      </body>
    </html>
  );
}
