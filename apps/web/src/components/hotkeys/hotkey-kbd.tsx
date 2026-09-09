"use client";

import { Kbd, KbdGroup } from "@rz-chain-reporter/ui/components/kbd";
import type { RegisterableHotkey } from "@tanstack/react-hotkeys";
import { useSyncExternalStore } from "react";

import { resolveBinding } from "@/lib/hotkeys/bindings";
import type { AppCommandId } from "@/lib/hotkeys/commands";
import { hotkeyDisplayTokens, hotkeyIdentity } from "@/lib/hotkeys/display";

function subscribe() {
  return () => {};
}

function HotkeyKbd({ hotkey }: { hotkey: RegisterableHotkey }) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const identity = hotkeyIdentity(hotkey);

  if (!ready) {
    return <KbdGroup aria-hidden />;
  }

  return (
    <KbdGroup>
      {hotkeyDisplayTokens(hotkey).map((token) => (
        <Kbd key={`${identity}:${token}`}>{token}</Kbd>
      ))}
    </KbdGroup>
  );
}

function CommandHotkeyKbd({ id }: { id: AppCommandId }) {
  return <HotkeyKbd hotkey={resolveBinding(id)} />;
}

export { CommandHotkeyKbd, HotkeyKbd };
