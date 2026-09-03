import type { SourceOrigin } from "@rz-chain-reporter/contracts";
import { RssIcon } from "lucide-react";
import type { SVGProps } from "react";

import { PlatformIcon } from "./platform-icon";

export function SourceOriginIcon({
  origin,
  ...props
}: SVGProps<SVGSVGElement> & { origin: SourceOrigin }) {
  if (origin === "telegram_public") {
    return <PlatformIcon platform="telegram" {...props} />;
  }
  return <RssIcon aria-hidden="true" {...props} />;
}
