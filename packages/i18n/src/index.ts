export const LOCALES = ["en", "fa"] as const;

export type Locale = (typeof LOCALES)[number];

export type Direction = "ltr" | "rtl";

export const DEFAULT_LOCALE: Locale = "en";

export const DIRECTION: Record<Locale, Direction> = {
  en: "ltr",
  fa: "rtl",
};

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (LOCALES as readonly string[]).includes(value)
  );
}
