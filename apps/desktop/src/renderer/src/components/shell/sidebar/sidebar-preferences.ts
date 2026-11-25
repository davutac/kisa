import { Option, Schema } from "effect";

/**
 * Sidebar layout preferences kept in the renderer's `localStorage`: whether
 * the sidebar is open, how wide it is, which accounts show their mailboxes,
 * which show their labels, and which labels are favorites. They are
 * conveniences, so unreadable or malformed values fall back to the defaults
 * instead of failing.
 */

const SIDEBAR_OPEN_KEY = "kisa.sidebar.open";
const SIDEBAR_WIDTH_KEY = "kisa.sidebar.width";
const EXPANDED_SCOPES_KEY = "kisa.sidebar.expandedScopes";
const EXPANDED_LABEL_SCOPES_KEY = "kisa.sidebar.expandedLabelScopes";
const FAVORITE_LABELS_KEY = "kisa.sidebar.favoriteLabels";

/**
 * Accounts start closed, and so do their labels, so a long label list never
 * pushes the accounts below it down.
 */
const NO_EXPANDED_SCOPES: ReadonlySet<string> = new Set();

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

const getStorage = (): PreferenceStorage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

const readPreference = (key: string): string | null => {
  try {
    return getStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const writePreference = (key: string, value: string): void => {
  try {
    getStorage()?.setItem(key, value);
  } catch {
    // A full or unavailable storage only costs the remembered layout.
  }
};

/** The sidebar starts open unless it was last hidden. */
export const parseSidebarOpen = (value: string | null): boolean =>
  value !== "false";

const decodeExpandedScopes = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(Schema.String))
);

export const parseExpandedScopes = (
  value: string | null
): ReadonlySet<string> =>
  value === null
    ? NO_EXPANDED_SCOPES
    : Option.match(decodeExpandedScopes(value), {
        onNone: () => NO_EXPANDED_SCOPES,
        onSome: (scopes) => new Set(scopes),
      });

/**
 * Keeps only scopes that still exist, so a disconnected account's address
 * does not outlive the account in storage.
 */
export const serializeExpandedScopes = (
  expandedScopes: ReadonlySet<string>,
  accountIds: readonly string[]
): string =>
  JSON.stringify(accountIds.filter((scope) => expandedScopes.has(scope)));

/** Sidebar widths in CSS pixels. */
export const DEFAULT_SIDEBAR_WIDTH = 240;
/**
 * A floor under the measured minimum, which is wherever the sidebar's
 * titlebar strip fits without truncating the app name.
 */
export const MIN_SIDEBAR_WIDTH = 160;
/** Leaves the content column usable at the window's 520-pixel minimum. */
export const MAX_SIDEBAR_WIDTH = 360;

export const clampSidebarWidth = (
  width: number,
  minWidth: number = MIN_SIDEBAR_WIDTH
): number =>
  Math.round(
    Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, minWidth, width))
  );

/**
 * A stored width outside the limits is clamped rather than dropped, so
 * changing the limits keeps the user's width as close as it can.
 */
export const parseSidebarWidth = (value: string | null): number => {
  const width =
    value === null || value.trim() === "" ? Number.NaN : Number(value);
  return Number.isFinite(width)
    ? clampSidebarWidth(width)
    : DEFAULT_SIDEBAR_WIDTH;
};

export const readSidebarOpen = (): boolean =>
  parseSidebarOpen(readPreference(SIDEBAR_OPEN_KEY));

export const writeSidebarOpen = (isOpen: boolean): void => {
  writePreference(SIDEBAR_OPEN_KEY, String(isOpen));
};

export const readSidebarWidth = (): number =>
  parseSidebarWidth(readPreference(SIDEBAR_WIDTH_KEY));

export const writeSidebarWidth = (width: number): void => {
  writePreference(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
};

export const readExpandedScopes = (): ReadonlySet<string> =>
  parseExpandedScopes(readPreference(EXPANDED_SCOPES_KEY));

export const writeExpandedScopes = (
  expandedScopes: ReadonlySet<string>,
  accountIds: readonly string[]
): void => {
  writePreference(
    EXPANDED_SCOPES_KEY,
    serializeExpandedScopes(expandedScopes, accountIds)
  );
};

export const readExpandedLabelScopes = (): ReadonlySet<string> =>
  parseExpandedScopes(readPreference(EXPANDED_LABEL_SCOPES_KEY));

export const writeExpandedLabelScopes = (
  expandedScopes: ReadonlySet<string>,
  accountIds: readonly string[]
): void => {
  writePreference(
    EXPANDED_LABEL_SCOPES_KEY,
    serializeExpandedScopes(expandedScopes, accountIds)
  );
};

/** One account's label, pinned above the accounts. */
const FavoriteLabel = Schema.Struct({
  accountId: Schema.NonEmptyString,
  label: Schema.NonEmptyString,
});
export type FavoriteLabel = typeof FavoriteLabel.Type;

const decodeFavoriteLabels = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(FavoriteLabel))
);

export const parseFavoriteLabels = (
  value: string | null
): readonly FavoriteLabel[] =>
  value === null ? [] : Option.getOrElse(decodeFavoriteLabels(value), () => []);

/** Keeps only connected accounts' favorites, in the order they were added. */
export const serializeFavoriteLabels = (
  favorites: readonly FavoriteLabel[],
  accountIds: readonly string[]
): string =>
  JSON.stringify(
    favorites.filter(({ accountId }) => accountIds.includes(accountId))
  );

export const readFavoriteLabels = (): readonly FavoriteLabel[] =>
  parseFavoriteLabels(readPreference(FAVORITE_LABELS_KEY));

export const writeFavoriteLabels = (
  favorites: readonly FavoriteLabel[],
  accountIds: readonly string[]
): void => {
  writePreference(
    FAVORITE_LABELS_KEY,
    serializeFavoriteLabels(favorites, accountIds)
  );
};
