import { parseHotkeyBinding } from "@/hotkeys/commands";

// Input types that aren't text fields, with the plain keys each one keeps.
const NON_TEXT_INPUTS = new Map<string, readonly string[]>([
  ["button", ["Enter"]],
  ["checkbox", []],
  ["color", ["Enter"]],
  ["file", ["Enter"]],
  ["image", ["Enter"]],
  ["radio", ["ArrowDown", "ArrowUp"]],
  ["range", ["ArrowDown", "ArrowUp"]],
  ["reset", ["Enter"]],
  ["submit", ["Enter"]],
]);

const TYPEAHEAD_ROLES = new Set([
  "combobox",
  "listbox",
  "menu",
  "menubar",
  "tree",
]);
const ENTER_ROLES = new Set([
  ...TYPEAHEAD_ROLES,
  "button",
  "grid",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "tablist",
  "treegrid",
  "treeitem",
]);
const VERTICAL_ROLES = new Set([
  ...TYPEAHEAD_ROLES,
  "grid",
  "radiogroup",
  "slider",
  "spinbutton",
  "treegrid",
]);

const roleOf = (element: Element): string =>
  element.getAttribute("role")?.trim().split(/\s+/u)[0] ?? "";

const isTextField = (element: Element): boolean => {
  if (element instanceof HTMLInputElement) {
    return !NON_TEXT_INPUTS.has(element.type) && !element.readOnly;
  }
  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly;
  }
  if (element instanceof HTMLSelectElement) {
    return true;
  }
  const role = roleOf(element);

  return (
    role === "textbox" ||
    role === "searchbox" ||
    (element instanceof HTMLElement && element.isContentEditable) ||
    element.matches("[contenteditable]:not([contenteditable='false'])")
  );
};

const inputKeeps = (element: Element, key: string): boolean =>
  element instanceof HTMLInputElement &&
  NON_TEXT_INPUTS.get(element.type)?.includes(key) === true;

const keepsEnter = (element: Element): boolean =>
  ENTER_ROLES.has(roleOf(element)) ||
  element.matches("button, summary, a[href], area[href]") ||
  inputKeeps(element, "Enter");

const keepsVerticalArrow = (element: Element, key: string): boolean => {
  const role = roleOf(element);
  const orientation = element.getAttribute("aria-orientation");

  return (
    (VERTICAL_ROLES.has(role) &&
      !(role === "listbox" && orientation === "horizontal")) ||
    ((role === "tablist" || role === "toolbar") &&
      orientation === "vertical") ||
    inputKeeps(element, key)
  );
};

// The plain keys a control handles itself, after the WAI-ARIA keyboard
// patterns, for the keys Kisa binds: Enter, the vertical arrows, and letters.
const keepsKey = (element: Element, key: string, shift: boolean): boolean => {
  if (key === "Enter") {
    return !shift && keepsEnter(element);
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    return keepsVerticalArrow(element, key);
  }

  return key.length === 1 && TYPEAHEAD_ROLES.has(roleOf(element));
};

// A text field keeps every key from the app; a control keeps the plain keys
// it handles, like Enter on a button or arrows and typeahead in a menu.
export const isBindingKeptByFocus = (binding: string): boolean => {
  const { key, modifiers } = parseHotkeyBinding(binding);
  const chord = modifiers.some((modifier) => modifier !== "Shift");
  const shift = modifiers.includes("Shift");

  for (
    let element = document.activeElement;
    element !== null;
    element = element.parentElement
  ) {
    if (isTextField(element) || (!chord && keepsKey(element, key, shift))) {
      return true;
    }
  }

  return false;
};
