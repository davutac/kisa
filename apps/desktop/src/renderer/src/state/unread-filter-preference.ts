/**
 * Whether the mailbox shows only unread conversations, kept in the renderer's
 * `localStorage` so the filter survives a restart. It is a convenience, so an
 * unreadable or unexpected value leaves the filter off instead of failing.
 */

const UNREAD_FILTER_KEY = "kisa.mailbox.unreadOnly";

export const parseUnreadFilter = (value: string | null): boolean =>
  value === "true";

export const readUnreadFilter = (): boolean => {
  try {
    return parseUnreadFilter(window.localStorage.getItem(UNREAD_FILTER_KEY));
  } catch {
    return false;
  }
};

export const writeUnreadFilter = (unreadOnly: boolean): void => {
  try {
    window.localStorage.setItem(UNREAD_FILTER_KEY, String(unreadOnly));
  } catch {
    // A full or unavailable storage only costs the remembered filter.
  }
};
