import "server-only";

import type { Locale } from "@rz-chain-reporter/i18n";

import {
  customerTemplate,
  customerTemplateFingerprint,
} from "@/lib/customer-template.server";

import { productHelp } from "./product-help";
import { customerFactsOf } from "./read-projections";

export type AssistantCustomerFacts = ReturnType<typeof customerFactsOf>;

export function assistantReadContext(locale: Locale) {
  return {
    productHelp: productHelp(locale),
    customer: customerFactsOf(customerTemplate),
    templateFingerprint: customerTemplateFingerprint.slice(0, 16),
  };
}

export type AssistantReadContext = ReturnType<typeof assistantReadContext>;
