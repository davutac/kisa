export const HOTKEY_LAYERS = [
  "mailbox",
  "thread",
  "settings",
  "composer",
  "search",
] as const;

export type HotkeyLayer = (typeof HOTKEY_LAYERS)[number];

export type HotkeyScope = "always" | "app" | HotkeyLayer;

export interface LayerRegistration {
  readonly activatedAt: number;
  readonly id: string;
  readonly layer: HotkeyLayer;
}

export const LAYER_PRIORITY = {
  composer: 100,
  mailbox: 10,
  search: 100,
  settings: 10,
  thread: 20,
} as const satisfies Record<HotkeyLayer, number>;

export const registerHotkeyLayer = (
  registrations: readonly LayerRegistration[],
  registration: LayerRegistration
): readonly LayerRegistration[] => [
  ...registrations.filter(({ id }) => id !== registration.id),
  registration,
];

export const removeHotkeyLayer = (
  registrations: readonly LayerRegistration[],
  id: string
): readonly LayerRegistration[] =>
  registrations.filter((registration) => registration.id !== id);

export const getTopHotkeyLayer = (
  registrations: readonly LayerRegistration[]
): HotkeyLayer | null => {
  let top: LayerRegistration | undefined;

  for (const registration of registrations) {
    if (
      top === undefined ||
      LAYER_PRIORITY[registration.layer] > LAYER_PRIORITY[top.layer] ||
      (LAYER_PRIORITY[registration.layer] === LAYER_PRIORITY[top.layer] &&
        registration.activatedAt > top.activatedAt)
    ) {
      top = registration;
    }
  }

  return top?.layer ?? null;
};

export const isHotkeyScopeActive = (
  scope: HotkeyScope,
  topLayer: HotkeyLayer | null
): boolean => {
  if (scope === "always") {
    return true;
  }

  if (topLayer === null) {
    return scope === "app";
  }

  if (topLayer === "composer" || topLayer === "search") {
    return scope === topLayer;
  }

  return scope === "app" || scope === topLayer;
};
