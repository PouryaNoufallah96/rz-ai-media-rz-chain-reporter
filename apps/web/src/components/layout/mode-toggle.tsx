"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@rz-chain-reporter/ui/components/dropdown-menu";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";

import { SHARED_NAMESPACE } from "@/features/shared/constants";

export function ModeToggle() {
  const { setTheme } = useTheme();
  const t = useTranslations(SHARED_NAMESPACE);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button className="max-sm:size-11" variant="outline" size="icon" />
        }
      >
        <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 opacity-100 transition-[opacity,transform] motion-reduce:transition-none dark:-rotate-90 dark:scale-95 dark:opacity-0" />
        <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-95 opacity-0 transition-[opacity,transform] motion-reduce:transition-none dark:rotate-0 dark:scale-100 dark:opacity-100" />
        <span className="sr-only">{t("theme.toggle")}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          {t("theme.light")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          {t("theme.dark")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          {t("theme.system")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
