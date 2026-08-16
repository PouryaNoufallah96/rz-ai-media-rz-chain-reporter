import {
  DEFAULT_LOCALE,
  DIRECTION,
  SCRIPT,
  UI_FONT,
} from "@rz-chain-reporter/i18n";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — Page not found",
};

// Bypasses [locale]; English-only (ADR 0002). Prefixed paths use [locale]/not-found.tsx.
export default function GlobalNotFound() {
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
            Page not found
          </h1>
          <p style={{ marginTop: "0.75rem" }}>
            The page you requested does not exist.
          </p>
          <a
            href={`/${DEFAULT_LOCALE}`}
            style={{ marginTop: "1rem", display: "inline-block" }}
          >
            Return home
          </a>
        </main>
      </body>
    </html>
  );
}
