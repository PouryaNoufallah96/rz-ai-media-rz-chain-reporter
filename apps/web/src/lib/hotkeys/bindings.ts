import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

import type { AppCommandId } from "./commands";
import { APP_COMMANDS } from "./commands";

const bindingOverrides = new Map<AppCommandId, RegisterableHotkey>();

export function resolveBinding(id: AppCommandId): RegisterableHotkey {
  return bindingOverrides.get(id) ?? APP_COMMANDS[id].defaultHotkey;
}

export function setBindingOverride(
  id: AppCommandId,
  hotkey: RegisterableHotkey | null,
) {
  if (hotkey === null) {
    bindingOverrides.delete(id);
    return;
  }

  bindingOverrides.set(id, hotkey);
}
