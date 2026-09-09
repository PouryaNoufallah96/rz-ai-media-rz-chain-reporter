import {
  formatForDisplay,
  type RegisterableHotkey,
} from "@tanstack/react-hotkeys";

const TOKEN_SEPARATOR = "\u0001";

export function hotkeyDisplayTokens(hotkey: RegisterableHotkey): string[] {
  return formatForDisplay(hotkey, { separatorToken: TOKEN_SEPARATOR })
    .split(TOKEN_SEPARATOR)
    .filter((token) => token.length > 0);
}

export function hotkeyIdentity(hotkey: RegisterableHotkey): string {
  return typeof hotkey === "string" ? hotkey : formatForDisplay(hotkey);
}
