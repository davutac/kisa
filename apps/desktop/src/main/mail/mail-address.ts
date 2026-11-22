export interface ParsedMailbox {
  readonly address: string;
  readonly name?: string | undefined;
}

const BARE_ADDRESS_EXCLUDED_PATTERN = /[\s<>]/u;

/**
 * Reads the display name of `Name <address>`: an optionally quoted run with no
 * quote inside it. `undefined` means the name is malformed, not absent.
 */
const parseDisplayName = (prefix: string): string | undefined => {
  let name = prefix.trimEnd();

  if (name.startsWith('"')) {
    name = name.slice(1);
  }

  if (name.endsWith('"')) {
    name = name.slice(0, -1);
  }

  return name.includes('"') ? undefined : name.trim();
};

/**
 * Parses `Name <address>`, `"Name" <address>`, or a bare `local@domain`.
 *
 * Addresses can be sender-controlled, so this reads the string by position. A
 * single pattern for the same grammar lets its optional name and the
 * whitespace around it each claim the same spaces, and a few kilobytes of
 * them stall the main process.
 */
export const parseMailbox = (value: string): ParsedMailbox | undefined => {
  const mailbox = value.trim();
  const open = mailbox.indexOf("<");

  if (open === -1) {
    return BARE_ADDRESS_EXCLUDED_PATTERN.test(mailbox) ||
      !mailbox.slice(1, -1).includes("@")
      ? undefined
      : { address: mailbox };
  }

  // The address runs from the first `<` to the first `>` after it, which has
  // to end the value.
  if (mailbox.indexOf(">", open + 1) !== mailbox.length - 1) {
    return undefined;
  }

  const address = mailbox.slice(open + 1, -1).trim();
  const name = parseDisplayName(mailbox.slice(0, open));

  if (address.length === 0 || name === undefined) {
    return undefined;
  }

  return name.length === 0 ? { address } : { address, name };
};
