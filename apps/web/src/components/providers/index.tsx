"use client";

import { DIRECTION, type Locale } from "@rz-chain-reporter/i18n";
import { DirectionProvider } from "@rz-chain-reporter/ui/components/direction-provider";
import { Toaster } from "@rz-chain-reporter/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  type IntlError,
  IntlErrorCode,
  NextIntlClientProvider,
} from "next-intl";
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { NOW } from "@/i18n/config";
import { getQueryClient } from "@/lib/query-client";

import { WebVitals } from "./web-vitals";

function onIntlError(error: IntlError) {
  if (
    error.code === IntlErrorCode.MISSING_MESSAGE &&
    process.env.NODE_ENV !== "production"
  ) {
    throw error;
  }
}

// No messages here: an island without `Localized` must throw, not leak key paths.
export default function Providers({
  children,
  locale,
  timeZone,
}: {
  children: React.ReactNode;
  locale: Locale;
  timeZone: string;
}) {
  const queryClient = getQueryClient();
  const direction = DIRECTION[locale];

  // The adapter reads no search params until a `useQueryStates` consumer mounts,
  // so placing it above every boundary preserves the static shell.
  return (
    <NuqsAdapter>
      <NextIntlClientProvider
        locale={locale}
        now={NOW}
        onError={onIntlError}
        timeZone={timeZone}
      >
        <DirectionProvider direction={direction}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
            <Toaster dir={direction} richColors />
            <WebVitals />
          </ThemeProvider>
        </DirectionProvider>
      </NextIntlClientProvider>
    </NuqsAdapter>
  );
}
