export const MODEL_VENDORS = [
  "anthropic",
  "deepseek",
  "google",
  "meta",
  "mistral",
  "openai",
  "xai",
] as const;

export type ModelVendor = (typeof MODEL_VENDORS)[number];

export type ModelOption = {
  key: string;
  name: string;
  vendor: ModelVendor | null;
};

const VENDOR_BY_ROUTE_PREFIX: Record<string, ModelVendor> = {
  anthropic: "anthropic",
  deepseek: "deepseek",
  google: "google",
  "meta-llama": "meta",
  mistralai: "mistral",
  openai: "openai",
  "x-ai": "xai",
};

export function modelVendor(modelId: string | undefined): ModelVendor | null {
  const prefix = modelId?.split("/", 1)[0];
  return prefix === undefined ? null : (VENDOR_BY_ROUTE_PREFIX[prefix] ?? null);
}
