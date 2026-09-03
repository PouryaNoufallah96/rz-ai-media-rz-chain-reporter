"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  ChartNoAxesCombinedIcon,
  ChartSplineIcon,
  LayoutGridIcon,
  UserRoundIcon,
} from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";

export function PrimaryNav({
  accountLabel,
  dashboardLabel,
  label,
  marketAnalysisEnabled,
  marketAnalysisLabel,
  usageLabel,
}: {
  accountLabel: string;
  dashboardLabel: string;
  label: string;
  marketAnalysisEnabled: boolean;
  marketAnalysisLabel: string;
  usageLabel: string;
}) {
  const pathname = usePathname();
  const links = [
    { href: "/dashboard", label: dashboardLabel, icon: LayoutGridIcon },
    ...(marketAnalysisEnabled
      ? [
          {
            href: "/market-analysis" as const,
            label: marketAnalysisLabel,
            icon: ChartSplineIcon,
          },
        ]
      : []),
    { href: "/account", label: accountLabel, icon: UserRoundIcon },
    { href: "/usage", label: usageLabel, icon: ChartNoAxesCombinedIcon },
  ] as const;
  return (
    <nav
      aria-label={label}
      className="flex min-w-0 flex-wrap items-center gap-1"
    >
      {links.map(({ href, label: text, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Button
            aria-current={active ? "page" : undefined}
            className="min-h-9 px-3 max-sm:min-h-11"
            key={href}
            nativeButton={false}
            render={<Link href={href} />}
            variant={active ? "secondary" : "ghost"}
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
            {text}
          </Button>
        );
      })}
    </nav>
  );
}
