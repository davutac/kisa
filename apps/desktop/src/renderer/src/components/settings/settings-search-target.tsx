import { createContext, use, useEffect, useRef } from "react";

import { SettingsRow, SettingsSection } from "@/components/ui/settings";
import type {
  SettingsRowProps,
  SettingsSectionProps,
} from "@/components/ui/settings";

interface SettingsSearchTargetState {
  /** The setting a search result is leading to, until it is reached. */
  readonly target: string | null;
  /** The setting reached, highlighted until focus leaves it. */
  readonly highlighted: string | null;
  readonly onReach: (target: string) => void;
  readonly onLeave: (target: string) => void;
}

const ignore = (): void => undefined;

export const SettingsSearchTargetContext =
  createContext<SettingsSearchTargetState>({
    highlighted: null,
    onLeave: ignore,
    onReach: ignore,
    target: null,
  });

const prefersInstantScroll = (): boolean =>
  document.documentElement.classList.contains("reduce-animations") ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Props for the row or section a search result leads to. Once its page shows
 * it, which for a page that loads first may be later, it scrolls to the
 * middle, takes focus, and stays highlighted until focus leaves it.
 */
export const useSettingsSearchTarget = <Element extends HTMLElement>(
  id: string
) => {
  const { highlighted, onLeave, onReach, target } = use(
    SettingsSearchTargetContext
  );

  const ref = useRef<Element>(null);
  const isTarget = target === id;
  const isHighlighted = highlighted === id;

  useEffect(() => {
    const element = ref.current;

    if (!isTarget || element === null) {
      return;
    }

    element.scrollIntoView({
      behavior: prefersInstantScroll() ? "instant" : "smooth",
      block: "center",
    });
    element.focus({ preventScroll: true });
    onReach(id);
  }, [id, isTarget, onReach]);

  return {
    "data-search-highlighted": isHighlighted ? "" : undefined,
    onBlur: isHighlighted ? () => onLeave(id) : undefined,
    ref,
    tabIndex: isTarget || isHighlighted ? -1 : undefined,
  };
};

/** A settings row a search result can lead to. */
export const SearchableSettingsRow = ({
  target,
  ...props
}: SettingsRowProps & { readonly target: string }) => {
  const targetProps = useSettingsSearchTarget<HTMLDivElement>(target);

  return <SettingsRow {...props} {...targetProps} />;
};

/** A section a search result can lead to, when no one row stands for it. */
export const SearchableSettingsSection = ({
  target,
  ...props
}: SettingsSectionProps & { readonly target: string }) => {
  const targetProps = useSettingsSearchTarget<HTMLElement>(target);

  return <SettingsSection {...props} {...targetProps} />;
};
