import "@/index.css";
import {
  DEFAULT_LOCALE,
  DIRECTION,
  SCRIPT,
  UI_FONT,
} from "@rz-chain-reporter/i18n";
import { Button } from "@rz-chain-reporter/ui/components/button";
import type { Metadata } from "next";

import { geistSans } from "@/lib/fonts";

export const metadata: Metadata = {
  title: "404 — Page not found",
};

export default function GlobalNotFound() {
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
            Page not found
          </h1>
          <p className="mt-3 text-muted-foreground text-sm leading-6">
            The page you requested does not exist.
          </p>
          <Button
            className="mt-6"
            nativeButton={false}
            render={<a aria-label="Return home" href={`/${DEFAULT_LOCALE}`} />}
            variant="outline"
          >
            Return home
          </Button>
        </main>
      </body>
    </html>
  );
}
