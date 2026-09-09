"use client";

import {
  type HotkeyCallback,
  type UseHotkeyOptions,
  useHotkey,
} from "@tanstack/react-hotkeys";
import { useTranslations } from "next-intl";

import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { resolveBinding } from "@/lib/hotkeys/bindings";
import { APP_COMMANDS, type AppCommandId } from "@/lib/hotkeys/commands";

function useCommandHotkey(
  id: AppCommandId,
  callback: HotkeyCallback,
  options?: Omit<UseHotkeyOptions, "meta">,
) {
  const t = useTranslations(SHARED_NAMESPACE);
  const command = APP_COMMANDS[id];
  const hotkey = resolveBinding(id);

  useHotkey(hotkey, callback, {
    conflictBehavior: "warn",
    ...options,
    meta: {
      name: t(command.messageKey),
      description: t(command.messageKey),
    },
  });
}

export { useCommandHotkey };
