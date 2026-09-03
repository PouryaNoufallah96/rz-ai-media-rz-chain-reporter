import type { ModelVendor } from "@rz-chain-reporter/contracts";
import { LogosClaudeIcon } from "@rz-chain-reporter/ui/components/icons/logos/claude-icon";
import { LogosDeepseekIcon } from "@rz-chain-reporter/ui/components/icons/logos/deepseek-icon";
import { LogosGoogleGeminiIcon } from "@rz-chain-reporter/ui/components/icons/logos/google-gemini-icon";
import { LogosOpenaiIcon } from "@rz-chain-reporter/ui/components/icons/logos/openai-icon";
import { SparklesIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

const VENDOR_ICONS: Partial<
  Record<ModelVendor, ComponentType<SVGProps<SVGSVGElement>>>
> = {
  anthropic: LogosClaudeIcon,
  deepseek: LogosDeepseekIcon,
  google: LogosGoogleGeminiIcon,
  openai: LogosOpenaiIcon,
};

export function ModelIcon({
  vendor,
  ...props
}: SVGProps<SVGSVGElement> & { vendor: ModelVendor | null }) {
  const Icon = (vendor && VENDOR_ICONS[vendor]) || SparklesIcon;
  return <Icon aria-hidden="true" {...props} />;
}
