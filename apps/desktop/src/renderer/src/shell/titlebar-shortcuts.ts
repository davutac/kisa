import type { NumberKey } from "@tanstack/react-hotkeys";

/**
 * Number-row shortcuts for the titlebar, assigned left to right the way the
 * buttons are laid out: `1` shows all accounts, then one digit per account.
 * Settings sits at the far right of the titlebar and takes `0`, the key at the
 * far end of the number row. Accounts past `9` have no shortcut.
 */
export const ALL_ACCOUNTS_SHORTCUT: NumberKey = "1";

export const SETTINGS_SHORTCUT: NumberKey = "0";

const ACCOUNT_SHORTCUTS: readonly NumberKey[] = [
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
];

export const getAccountShortcut = (
  accountIndex: number
): NumberKey | undefined => ACCOUNT_SHORTCUTS[accountIndex];
