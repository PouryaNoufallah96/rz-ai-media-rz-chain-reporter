export const LOCALES = ["en", "fa"] as const;

export type Locale = (typeof LOCALES)[number];

export type Direction = "ltr" | "rtl";

export type Script = "latn" | "arab";

export const DEFAULT_LOCALE: Locale = "en";

export const DIRECTION: Record<Locale, Direction> = {
  en: "ltr",
  fa: "rtl",
};

export const SCRIPT: Record<Locale, Script> = {
  en: "latn",
  fa: "arab",
};

export const UI_FONT: Record<Locale, string> = {
  en: "var(--font-geist-sans)",
  fa: "var(--font-vazirmatn)",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
