"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import { Hint } from "@rz-chain-reporter/ui/components/hint";
import { useTranslations } from "next-intl";
import type { ComponentProps } from "react";

import { CommandHotkeyKbd } from "@/components/hotkeys/hotkey-kbd";

import { ASSISTANT_FAB_CLASS, ASSISTANT_NAMESPACE } from "../constants";
import { AssistantOrb } from "./assistant-orb";

function AssistantFab({
  busy = false,
  ...props
}: Omit<ComponentProps<typeof Button>, "children" | "size" | "variant"> & {
  busy?: boolean;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);

  return (
    <Hint
      keys={<CommandHotkeyKbd id="assistant.toggle" />}
      label={t("fab.label")}
    >
      <Button
        aria-busy={busy || undefined}
        className={ASSISTANT_FAB_CLASS}
        data-assistant-fab
        data-assistant-surface
        size="icon-lg"
        suppressHydrationWarning
        variant="ghost"
        {...props}
      >
        <AssistantOrb busy={busy} />
        <span className="sr-only">{t("fab.label")}</span>
      </Button>
    </Hint>
  );
}

export { AssistantFab };
