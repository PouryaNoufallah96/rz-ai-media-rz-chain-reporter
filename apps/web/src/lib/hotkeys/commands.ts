import type { RegisterableHotkey } from "@tanstack/react-hotkeys";

export const APP_COMMAND_IDS = [
  "assistant.toggle",
  "assistant.close",
  "editorial.sidebar.toggle",
  "hotkeys.help",
] as const;

export type AppCommandId = (typeof APP_COMMAND_IDS)[number];

export type AppCommand = {
  defaultHotkey: RegisterableHotkey;
  id: AppCommandId;
  messageKey:
    | "hotkeys.commands.assistantToggle"
    | "hotkeys.commands.assistantClose"
    | "hotkeys.commands.editorialSidebarToggle"
    | "hotkeys.commands.help";
};

export const APP_COMMANDS = {
  "assistant.toggle": {
    id: "assistant.toggle",
    defaultHotkey: "Mod+J",
    messageKey: "hotkeys.commands.assistantToggle",
  },
  "assistant.close": {
    id: "assistant.close",
    defaultHotkey: "Escape",
    messageKey: "hotkeys.commands.assistantClose",
  },
  "editorial.sidebar.toggle": {
    id: "editorial.sidebar.toggle",
    defaultHotkey: "Mod+B",
    messageKey: "hotkeys.commands.editorialSidebarToggle",
  },
  "hotkeys.help": {
    id: "hotkeys.help",
    // Shift+/ produces "?" on US layouts; typed string form is not in Hotkey.
    defaultHotkey: { key: "?", shift: true },
    messageKey: "hotkeys.commands.help",
  },
} as const satisfies Record<AppCommandId, AppCommand>;
