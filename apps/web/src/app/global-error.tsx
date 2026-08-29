"use client";

import "@/index.css";
import {
  DEFAULT_LOCALE,
  DIRECTION,
  SCRIPT,
  UI_FONT,
} from "@rz-chain-reporter/i18n";
import { Button } from "@rz-chain-reporter/ui/components/button";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { geistSans } from "@/lib/fonts";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html
      className={geistSans.variable}
      data-script={SCRIPT[DEFAULT_LOCALE]}
      dir={DIRECTION[DEFAULT_LOCALE]}
      lang={DEFAULT_LOCALE}
      style={
        {
          "--font-ui-sans": UI_FONT[DEFAULT_LOCALE],
        } as React.CSSProperties
      }
    >
      <body className="flex min-h-svh items-center justify-center bg-background px-5 font-sans text-foreground">
        <main className="w-full max-w-md rounded-xl border bg-card p-8">
          <h1 className="font-semibold text-2xl tracking-display">
            Something went wrong
          </h1>
          <p className="mt-3 text-muted-foreground text-sm leading-6">
            The application failed to load. Reload the page to try again.
          </p>
          <Button
            className="mt-6"
            onClick={() => window.location.reload()}
            variant="outline"
          >
            Reload page
          </Button>
        </main>
      </body>
    </html>
  );
}
