export const LOCALES = ["en", "fa"] as const;

export type Locale = (typeof LOCALES)[number];

export type Direction = "ltr" | "rtl";

export type Script = "latn" | "arab";

export type Calendar = "gregory" | "persian";

export type FontFamily = "Geist" | "Vazirmatn";

export const DEFAULT_LOCALE: Locale = "en";

export const DIRECTION: Record<Locale, Direction> = {
  en: "ltr",
  fa: "rtl",
};

export const SCRIPT: Record<Locale, Script> = {
  en: "latn",
  fa: "arab",
};

export const CALENDAR: Record<Locale, Calendar> = {
  en: "gregory",
  fa: "persian",
};

export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US-u-ca-gregory-nu-latn",
  fa: "fa-IR-u-ca-gregory-nu-arabext",
};

export const FONT_FAMILY: Record<Locale, FontFamily> = {
  en: "Geist",
  fa: "Vazirmatn",
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
