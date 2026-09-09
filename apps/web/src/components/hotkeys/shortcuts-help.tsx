"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@rz-chain-reporter/ui/components/dialog";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { useCommandHotkey } from "@/hooks/use-command-hotkey";
import { resolveBinding } from "@/lib/hotkeys/bindings";
import { APP_COMMAND_IDS, APP_COMMANDS } from "@/lib/hotkeys/commands";

import { HotkeyKbd } from "./hotkey-kbd";

function ShortcutsHelp() {
  const t = useTranslations(SHARED_NAMESPACE);
  const [open, setOpen] = useState(false);

  useCommandHotkey("hotkeys.help", () => setOpen(true));

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent className="max-w-md" closeLabel={t("hotkeys.close")}>
        <DialogHeader>
          <DialogTitle>{t("hotkeys.title")}</DialogTitle>
          <DialogDescription>{t("hotkeys.description")}</DialogDescription>
        </DialogHeader>
        <ul className="grid gap-3">
          {APP_COMMAND_IDS.map((id) => {
            const command = APP_COMMANDS[id];
            return (
              <li className="flex items-center justify-between gap-4" key={id}>
                <span>{t(command.messageKey)}</span>
                <HotkeyKbd hotkey={resolveBinding(id)} />
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export { ShortcutsHelp };
