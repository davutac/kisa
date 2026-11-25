/**
 * A page of the Settings dialog. Each connected account has its own page,
 * keyed by its address, so two accounts never share one.
 */
export type SettingsPage = "ai" | "data" | "general" | `account:${string}`;

const ACCOUNT_PAGE_PREFIX = "account:";

export const toAccountSettingsPage = (accountId: string): SettingsPage =>
  `${ACCOUNT_PAGE_PREFIX}${accountId}`;

export const APP_SETTINGS_PAGE_LABELS = {
  ai: "AI writing",
  data: "Data",
  general: "General",
} as const satisfies Record<Exclude<SettingsPage, `account:${string}`>, string>;

/** An account's page is named by the account's address. */
export const getSettingsPageLabel = (page: SettingsPage): string =>
  page === "ai" || page === "data" || page === "general"
    ? APP_SETTINGS_PAGE_LABELS[page]
    : page.slice(ACCOUNT_PAGE_PREFIX.length);

export interface SettingsPageAvailability {
  readonly accountIds: readonly string[];
  readonly hasAi: boolean;
  readonly hasData: boolean;
}

/** General always has Theme and Animations, so it is always there. */
export const listSettingsPages = ({
  accountIds,
  hasAi,
  hasData,
}: SettingsPageAvailability): readonly SettingsPage[] => [
  "general",
  ...(hasAi ? (["ai"] as const) : []),
  ...(hasData ? (["data"] as const) : []),
  ...accountIds.map(toAccountSettingsPage),
];

/**
 * The page to show. One that is gone, such as the page of an account that
 * was just disconnected, gives way to General.
 */
export const resolveSettingsPage = (
  page: SettingsPage,
  pages: readonly SettingsPage[]
): SettingsPage => (pages.includes(page) ? page : "general");

export const isSettingsPage = (
  value: string | null,
  pages: readonly SettingsPage[]
): value is SettingsPage =>
  value !== null && pages.some((page) => page === value);
