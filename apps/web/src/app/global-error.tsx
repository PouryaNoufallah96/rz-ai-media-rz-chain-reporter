"use client";

import {
  DEFAULT_LOCALE,
  DIRECTION,
  SCRIPT,
  UI_FONT,
} from "@rz-chain-reporter/i18n";

// Replaces the root layout — no locale or catalog. English-only (ADR 0002).
export default function GlobalError() {
  return (
    <html
      data-script={SCRIPT[DEFAULT_LOCALE]}
      dir={DIRECTION[DEFAULT_LOCALE]}
      lang={DEFAULT_LOCALE}
      style={
        {
          "--font-ui-sans": UI_FONT[DEFAULT_LOCALE],
        } as React.CSSProperties
      }
    >
      <body
        style={{
          alignItems: "center",
          display: "flex",
          fontFamily: "system-ui, sans-serif",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <main style={{ maxWidth: "32rem", padding: "1.5rem" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p style={{ marginTop: "0.75rem" }}>
            The application failed to load. Reload the page to try again.
          </p>
        </main>
      </body>
    </html>
  );
}
