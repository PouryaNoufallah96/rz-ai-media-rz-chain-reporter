import { INTL_LOCALE, type Locale } from "@rz-chain-reporter/i18n";

const AMOUNT_FORMATTERS: Record<Locale, Intl.NumberFormat> = {
  en: new Intl.NumberFormat(INTL_LOCALE.en, { maximumFractionDigits: 4 }),
  fa: new Intl.NumberFormat(INTL_LOCALE.fa, { maximumFractionDigits: 4 }),
};

const CHANGE_FORMATTERS: Record<Locale, Intl.NumberFormat> = {
  en: new Intl.NumberFormat(INTL_LOCALE.en, {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
    style: "percent",
  }),
  fa: new Intl.NumberFormat(INTL_LOCALE.fa, {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
    style: "percent",
  }),
};

export function formatMarketAmount(value: string | null, locale: Locale) {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed)
    ? AMOUNT_FORMATTERS[locale].format(parsed)
    : "—";
}

export function formatMarketChange(value: string | null, locale: Locale) {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed)
    ? CHANGE_FORMATTERS[locale].format(parsed / 100)
    : "—";
}
