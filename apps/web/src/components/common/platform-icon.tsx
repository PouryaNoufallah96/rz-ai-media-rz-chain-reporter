import type { Platform } from "@rz-chain-reporter/contracts";
import { LogosTelegram } from "@rz-chain-reporter/ui/components/icons/logos/telegram";
import { SimpleIconsX } from "@rz-chain-reporter/ui/components/icons/simple-icons/x";
import { SkillIconsInstagram } from "@rz-chain-reporter/ui/components/icons/skill-icons/instagram";
import type { ComponentType, SVGProps } from "react";

const PLATFORM_ICONS: Record<
  Platform,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  instagram: SkillIconsInstagram,
  telegram: LogosTelegram,
  x: SimpleIconsX,
};

export function PlatformIcon({
  platform,
  ...props
}: SVGProps<SVGSVGElement> & { platform: Platform }) {
  const Icon = PLATFORM_ICONS[platform];
  return <Icon aria-hidden="true" {...props} />;
}
