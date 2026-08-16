import { DEFAULT_LOCALE, DIRECTION } from "@rz-chain-reporter/i18n";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "404 — Page not found",
};

// Bypasses [locale]; English-only (ADR 0002). Prefixed paths use [locale]/not-found.tsx.
export default function GlobalNotFound() {
  return (
    <html dir={DIRECTION[DEFAULT_LOCALE]} lang={DEFAULT_LOCALE}>
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
