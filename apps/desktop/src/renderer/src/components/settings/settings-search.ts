import type { Account } from "@/shared/ipc/accounts";

import {
  getSettingsPageLabel,
  listSettingsPages,
  toAccountSettingsPage,
} from "./settings-pages";
import type { SettingsPage } from "./settings-pages";

/** A setting a search result can lead to, one per row on its page. */
export type SettingsTargetKey =
  | "animations"
  | "categorization"
  | "cleanup-instructions"
  | "disconnect"
  | "import-database"
  | "inline-images"
  | "labels"
  | "launch-at-login"
  | "mail-sync"
  | "name"
  | "notifications"
  | "provider"
  | "recovery-key"
  | "reply-instructions"
  | "run-in-background"
  | "signature"
  | "system-labels"
  | "theme"
  | "thread-windows"
  | "updates";

/** Unique across pages, so two accounts' signatures are two targets. */
export const toSettingsTarget = (
  page: SettingsPage,
  key: SettingsTargetKey
): string => `${page}#${key}`;

export interface SettingsSearchItem {
  /** The page for a page, otherwise the setting's target. */
  readonly id: string;
  readonly page: SettingsPage;
  readonly target: string | null;
  readonly terms: string;
  readonly title: string;
}

export interface SettingsSearchAvailability {
  readonly accounts: readonly Pick<
    Account,
    "displayName" | "email" | "provider"
  >[];
  readonly hasAi: boolean;
  readonly hasAppSettings: boolean;
  readonly hasLoginItem: boolean;
  readonly hasMail: boolean;
  readonly hasSettings: boolean;
  readonly hasUpdates: boolean;
  readonly hasWindow: boolean;
}

interface SettingDefinition {
  readonly isAvailable?: (availability: SettingsSearchAvailability) => boolean;
  readonly key: SettingsTargetKey;
  readonly terms: string;
  readonly title: string;
}

// Each list follows its page's order, which is the order results keep when
// they match equally well.
const PAGE_SETTINGS = {
  ai: [
    {
      key: "provider",
      terms: "claude codex opencode model reasoning variant cli subscription",
      title: "AI provider",
    },
    {
      key: "reply-instructions",
      terms: "prompt generate write replies",
      title: "Reply instructions",
    },
    {
      key: "cleanup-instructions",
      terms: "prompt clean improve draft",
      title: "Draft cleanup instructions",
    },
  ],
  data: [
    {
      key: "import-database",
      terms: "restore backup migrate",
      title: "Import database",
    },
    {
      key: "recovery-key",
      terms: "export encryption backup",
      title: "Recovery key",
    },
    {
      isAvailable: ({ hasAppSettings }) => hasAppSettings,
      key: "inline-images",
      terms: "cache storage retention pictures delete",
      title: "Keep images from opened emails",
    },
  ],
  general: [
    {
      key: "theme",
      terms: "appearance dark light mode color scheme system",
      title: "Theme",
    },
    {
      key: "animations",
      terms: "appearance motion transitions reduce lag",
      title: "Animations",
    },
    {
      isAvailable: ({ hasLoginItem }) => hasLoginItem,
      key: "launch-at-login",
      terms: "system startup start automatically",
      title: "Launch at login",
    },
    {
      isAvailable: ({ hasAppSettings }) => hasAppSettings,
      key: "run-in-background",
      terms: "system tray menu bar keep running close window notifications",
      title: "Run in background",
    },
    {
      isAvailable: ({ hasUpdates }) => hasUpdates,
      key: "updates",
      terms: "system check version download install upgrade",
      title: "Updates",
    },
    {
      isAvailable: ({ hasWindow }) => hasWindow,
      key: "thread-windows",
      terms: "conversations pop out separate",
      title: "Always open threads in new windows",
    },
  ],
} as const satisfies Record<
  Exclude<SettingsPage, `account:${string}`>,
  readonly SettingDefinition[]
>;

const ACCOUNT_SETTINGS: readonly SettingDefinition[] = [
  {
    key: "name",
    terms: "mail display from rename sender",
    title: "Sender name",
  },
  {
    isAvailable: ({ hasSettings }) => hasSettings,
    key: "signature",
    terms: "mail sign-off footer",
    title: "Email signature",
  },
  {
    isAvailable: ({ hasSettings }) => hasSettings,
    key: "notifications",
    terms: "mail alerts notify",
    title: "New email notifications",
  },
  {
    isAvailable: ({ hasSettings }) => hasSettings,
    key: "categorization",
    terms: "mail ai labels sort classify automatic",
    title: "Automatic categorization",
  },
  {
    isAvailable: ({ hasMail }) => hasMail,
    key: "labels",
    terms: "create rename delete sync folders",
    title: "Labels",
  },
  {
    isAvailable: ({ hasSettings }) => hasSettings,
    key: "system-labels",
    terms: "labels inbox sent important",
    title: "System labels",
  },
  {
    isAvailable: ({ hasMail }) => hasMail,
    key: "mail-sync",
    terms: "sync now reindex index sign in again password",
    title: "Mail sync",
  },
  {
    key: "disconnect",
    terms: "remove sign out delete account",
    title: "Disconnect",
  },
];

/**
 * Every page and setting a search can find, in the order the dialog shows
 * them. Only what the runtime offers is listed, as only that is shown.
 */
export const buildSettingsSearchIndex = (
  availability: SettingsSearchAvailability
): readonly SettingsSearchItem[] => {
  const pages = listSettingsPages({
    accountIds: availability.accounts.map(({ email }) => email),
    hasAi: availability.hasAi,
    hasData: availability.hasSettings,
  });

  return pages.flatMap((page): SettingsSearchItem[] => {
    const account = availability.accounts.find(
      ({ email }) => toAccountSettingsPage(email) === page
    );
    const settings =
      page === "ai" || page === "data" || page === "general"
        ? PAGE_SETTINGS[page]
        : ACCOUNT_SETTINGS;
    const pageItem: SettingsSearchItem = {
      id: page,
      page,
      target: null,
      terms:
        account === undefined
          ? ""
          : `account ${account.displayName ?? ""} ${account.provider}`,
      title: getSettingsPageLabel(page),
    };

    return [
      pageItem,
      ...settings
        .filter(
          (setting: SettingDefinition) =>
            setting.isAvailable?.(availability) ?? true
        )
        .map((setting) => {
          const target = toSettingsTarget(page, setting.key);
          return {
            id: target,
            page,
            target,
            // A setting is found by its page's name and keywords too, so an
            // account's display name finds that account's settings.
            terms: `${setting.terms} ${pageItem.terms}`,
            title: setting.title,
          };
        }),
    ];
  });
};

const normalize = (text: string): string => text.trim().toLowerCase();

/**
 * The items whose title, page name and keywords hold every word typed. A
 * title that is the query, then one that starts with it, then one that holds
 * every word, rank first; ties keep the dialog's order.
 */
export const searchSettings = (
  items: readonly SettingsSearchItem[],
  query: string
): readonly SettingsSearchItem[] => {
  const phrase = normalize(query).replaceAll(/\s+/gu, " ");
  const words = phrase.split(" ").filter((word) => word.length > 0);

  if (words.length === 0) {
    return [];
  }

  return items
    .flatMap((item, index) => {
      const title = normalize(item.title);
      const text = `${title} ${normalize(getSettingsPageLabel(item.page))} ${normalize(item.terms)}`;

      if (!words.every((word) => text.includes(word))) {
        return [];
      }

      let rank = 0;
      if (title === phrase) {
        rank = 3;
      } else if (title.startsWith(phrase)) {
        rank = 2;
      } else if (words.every((word) => title.includes(word))) {
        rank = 1;
      }

      return [{ index, item, rank }];
    })
    .toSorted(
      (left, right) => right.rank - left.rank || left.index - right.index
    )
    .map(({ item }) => item);
};
