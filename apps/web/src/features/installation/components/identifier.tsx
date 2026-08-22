import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import type { ReactNode } from "react";

// Stable keys, endpoints, platforms and fingerprints are Latin technical
// identifiers; without isolation they reshuffle inside Persian copy.
export function Identifier({ children }: { children: ReactNode }) {
  return (
    <Bdi className="wrap-anywhere font-mono text-xs" dir="ltr">
      {children}
    </Bdi>
  );
}
