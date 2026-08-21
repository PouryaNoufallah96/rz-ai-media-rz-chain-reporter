import { DEFAULT_LOCALE, isLocale, type Locale } from "@rz-chain-reporter/i18n";
import { locale as localeRootParam } from "next/root-params";
import type { Messages, NamespaceKeys, NestedKeyOf } from "next-intl";
import {
  getFormatter as getIntlFormatter,
  getTranslations,
} from "next-intl/server";

export async function currentLocale(): Promise<Locale> {
  const value = await localeRootParam();
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getT<
  NestedKey extends NamespaceKeys<Messages, NestedKeyOf<Messages>>,
>(namespace: NestedKey) {
  return getTranslations({ locale: await currentLocale(), namespace });
}

export async function getFormatter() {
  return getIntlFormatter({ locale: await currentLocale() });
}
