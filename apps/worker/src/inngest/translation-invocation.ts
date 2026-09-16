import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";

export function getTranslationInvocationKeys(
  template: CustomerTemplate,
): Array<"primary" | "retry-1" | "fallback"> {
  return template.models.tasks["text-translation"]?.fallback
    ? ["primary", "retry-1", "fallback"]
    : ["primary", "retry-1"];
}
