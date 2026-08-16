"use client";

import { DIRECTION, type Locale } from "@rz-chain-reporter/i18n";
import { DirectionProvider } from "@rz-chain-reporter/ui/components/direction-provider";
import { Toaster } from "@rz-chain-reporter/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
  type IntlError,
  IntlErrorCode,
  NextIntlClientProvider,
} from "next-intl";
import { NuqsAdapter } from "nuqs/adapters/next/app";

import { FORMATS, NOW, TIME_ZONE } from "@/i18n/config";
import { getQueryClient } from "@/lib/query-client";

import { ThemeProvider } from "./theme-provider";

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
}: {
  children: React.ReactNode;
  locale: Locale;
}) {
  const queryClient = getQueryClient();
  const direction = DIRECTION[locale];

  // The adapter only publishes the framework binding through context; nothing
  // reads `useSearchParams` until a `useQueryStates` consumer mounts, so the
  // static shell survives mounting it above every boundary.
  return (
    <NuqsAdapter>
      <NextIntlClientProvider
        formats={FORMATS}
        locale={locale}
        now={NOW}
        onError={onIntlError}
        timeZone={TIME_ZONE}
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
              {process.env.NODE_ENV === "development" ? (
                <ReactQueryDevtools />
              ) : null}
            </QueryClientProvider>
            <Toaster dir={direction} richColors />
          </ThemeProvider>
        </DirectionProvider>
      </NextIntlClientProvider>
    </NuqsAdapter>
  );
}
