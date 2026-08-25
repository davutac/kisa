import { XIcon } from "lucide-react";
import {
  AnimatePresence,
  LayoutGroup,
  m,
  useReducedMotionConfig,
} from "motion/react";
import type { CSSProperties, RefObject } from "react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { createMailboxLabelItems } from "@/mail/mailbox-labels";
import type { MailboxLabelItem } from "@/mail/mailbox-labels";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import {
  centerMailboxLabel,
  useMailboxLabelNavigation,
} from "@/mail/use-mailbox-label-navigation";
import { useGmailLabelCatalogSnapshot } from "@/state/gmail-labels";
import { useMailboxStore, useSelectedLabelNames } from "@/state/mailbox";

interface MailboxLabelBarViewProps {
  readonly emptyLabel: string;
  readonly items: readonly MailboxLabelItem[];
  readonly labelScrollRef?: RefObject<HTMLDivElement | null>;
  readonly onClearAll: () => void;
  readonly onValueChange: (value: readonly string[]) => void;
  readonly selectedLabelNames: readonly string[];
  readonly shouldReduceMotion?: boolean;
  readonly takeFocusAnimation?: () => boolean;
}

export const MailboxLabelBarView = ({
  emptyLabel,
  items,
  labelScrollRef,
  onClearAll,
  onValueChange,
  selectedLabelNames,
  shouldReduceMotion = false,
  takeFocusAnimation,
}: MailboxLabelBarViewProps) => {
  const [focusedLabel, setFocusedLabel] = useState<{
    readonly animate: boolean;
    readonly key: string;
  } | null>(null);
  const clearLabelFiltersDisplay = getHotkeyDisplay(
    "mailbox.clearLabelFilters"
  );

  return (
    <nav
      aria-label="Mailbox labels"
      className="flex h-10 shrink-0 items-center"
    >
      {items.length === 0 ? (
        <p aria-live="polite" className="text-muted-foreground px-8 text-xs">
          {emptyLabel}
        </p>
      ) : (
        <>
          <AnimatePresence initial={false}>
            {selectedLabelNames.length > 0 ? (
              <m.div
                animate={{ opacity: 1, scale: 1, width: 52, x: 0 }}
                className="flex h-full shrink-0 items-center overflow-hidden"
                exit={{ opacity: 0, scale: 0.88, width: 0, x: -4 }}
                initial={
                  shouldReduceMotion
                    ? false
                    : { opacity: 0, scale: 0.88, width: 0, x: -4 }
                }
                transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.16)}
              >
                <div className="shrink-0 pl-7">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          aria-keyshortcuts={getHotkeyAriaLabel(
                            "mailbox.clearLabelFilters"
                          )}
                          aria-label={clearLabelFiltersDisplay.label}
                          onClick={onClearAll}
                          size="icon-sm"
                          type="button"
                          variant="secondary"
                        >
                          <XIcon />
                        </Button>
                      }
                    />
                    <TooltipContent
                      className="flex items-center gap-2"
                      side="bottom"
                    >
                      {clearLabelFiltersDisplay.label}
                      <HotkeyHint command="mailbox.clearLabelFilters" />
                    </TooltipContent>
                  </Tooltip>
                </div>
              </m.div>
            ) : null}
          </AnimatePresence>
          <m.div
            animate={{
              paddingLeft: selectedLabelNames.length > 0 ? 4 : 32,
            }}
            className="scroll-fade-x no-scrollbar flex h-full min-w-0 flex-1 snap-x snap-proximity items-center overflow-x-auto overscroll-x-contain pr-8"
            ref={labelScrollRef}
            transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.16)}
          >
            <LayoutGroup id="mailbox-label-focus">
              <fieldset
                aria-label="Filter threads by label"
                className="flex w-max min-w-0 items-center gap-1 border-0 p-0"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {items.map((item) => {
                    const accountCount = item.accountIds.length;
                    const accountSuffix =
                      accountCount > 1 ? `, ${accountCount} accounts` : "";
                    const isSelected = selectedLabelNames.includes(item.key);
                    let buttonStyle: CSSProperties | undefined;
                    if (item.color !== undefined) {
                      buttonStyle = isSelected
                        ? {
                            backgroundColor: item.color.background,
                            color: item.color.text,
                          }
                        : {
                            backgroundColor: `color-mix(in oklch, ${item.color.background} 5%, transparent)`,
                            color: "var(--foreground)",
                          };
                    }

                    return (
                      <m.div
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        className="shrink-0 snap-center"
                        exit={{ opacity: 0, scale: 0.96, x: -4 }}
                        initial={
                          shouldReduceMotion
                            ? false
                            : { opacity: 0, scale: 0.96, x: -4 }
                        }
                        key={item.key}
                        layout={shouldReduceMotion ? false : "position"}
                        transition={
                          shouldReduceMotion ? NO_MOTION : easeInOut(0.16)
                        }
                      >
                        <Button
                          aria-label={`${item.name}${accountSuffix}`}
                          aria-pressed={isSelected}
                          className="relative focus-visible:ring-0"
                          data-mailbox-label={item.key}
                          onBlur={(event) => {
                            if (
                              !(event.relatedTarget instanceof HTMLElement) ||
                              event.relatedTarget.dataset.mailboxLabel ===
                                undefined
                            ) {
                              setFocusedLabel(null);
                            }
                          }}
                          onClick={(event) => {
                            centerMailboxLabel(
                              event.currentTarget,
                              shouldReduceMotion ? "auto" : "smooth"
                            );
                            onValueChange(
                              isSelected
                                ? selectedLabelNames.filter(
                                    (name) => name !== item.key
                                  )
                                : [...selectedLabelNames, item.key]
                            );
                          }}
                          onFocus={() => {
                            setFocusedLabel({
                              animate: takeFocusAnimation?.() ?? true,
                              key: item.key,
                            });
                          }}
                          size="sm"
                          style={buttonStyle}
                          title={`${item.name}${accountSuffix}`}
                          type="button"
                          variant={isSelected ? "default" : "secondary"}
                        >
                          {focusedLabel?.key === item.key ? (
                            <m.span
                              aria-hidden="true"
                              className="border-primary bg-primary/5 pointer-events-none absolute inset-0 rounded-[inherit] border"
                              layoutId="mailbox-label-focus-border"
                              transition={
                                shouldReduceMotion || !focusedLabel.animate
                                  ? NO_MOTION
                                  : easeInOut(0.16)
                              }
                            />
                          ) : null}
                          <span className="max-w-32 truncate">{item.name}</span>
                          {accountCount > 1 ? (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex size-4 items-center justify-center rounded-full text-[9px] tabular-nums",
                                isSelected
                                  ? "bg-background/20 text-inherit"
                                  : "bg-background/50 text-foreground"
                              )}
                            >
                              {accountCount}
                            </span>
                          ) : null}
                        </Button>
                      </m.div>
                    );
                  })}
                </AnimatePresence>
              </fieldset>
            </LayoutGroup>
          </m.div>
        </>
      )}
    </nav>
  );
};

const MailboxLabelBar = () => {
  const { accountIds } = useMailboxAccountScope();
  const { catalogs, statuses } = useGmailLabelCatalogSnapshot();
  const shouldReduceMotion = useReducedMotionConfig() ?? false;
  const selectedLabelNames = useSelectedLabelNames();
  const retainSelectedLabels = useMailboxStore(
    (state) => state.retainSelectedLabels
  );
  const setSelectedLabels = useMailboxStore((state) => state.setSelectedLabels);
  const clearLabelFilters = (): void => {
    setSelectedLabels([]);
  };
  const items = useMemo(
    () =>
      createMailboxLabelItems(
        accountIds.flatMap((accountId) => {
          const labels = catalogs.get(accountId);
          return labels === undefined ? [] : [{ accountId, labels }];
        })
      ),
    [accountIds, catalogs]
  );
  const visibleNames = useMemo(
    () => new Set(items.map(({ key }) => key)),
    [items]
  );
  const { labelScrollRef, takeFocusAnimation } = useMailboxLabelNavigation({
    enabled: items.length > 0,
    shouldReduceMotion,
  });
  const allCatalogsReady = accountIds.every(
    (accountId) => statuses.get(accountId) === "ready"
  );
  const isLoading = accountIds.some((accountId) => {
    const status = statuses.get(accountId);
    return status === undefined || status === "loading";
  });
  const isUnavailable =
    accountIds.length > 0 &&
    accountIds.every((accountId) => statuses.get(accountId) === "unavailable");

  useEffect(() => {
    if (allCatalogsReady) {
      retainSelectedLabels(visibleNames);
    }
  }, [allCatalogsReady, retainSelectedLabels, visibleNames]);

  useAppCommand("mailbox.clearLabelFilters", clearLabelFilters, {
    enabled: selectedLabelNames.length > 0,
  });
  useAppCommand("search.clearLabelFilters", clearLabelFilters, {
    enabled: selectedLabelNames.length > 0,
  });

  let emptyLabel = "No labels";
  if (isLoading) {
    emptyLabel = "Loading labels…";
  } else if (isUnavailable) {
    emptyLabel = "Labels unavailable";
  }

  return (
    <MailboxLabelBarView
      emptyLabel={emptyLabel}
      items={items}
      labelScrollRef={labelScrollRef}
      onClearAll={clearLabelFilters}
      onValueChange={(visibleSelection) => {
        const hiddenSelection = selectedLabelNames.filter(
          (name) => !visibleNames.has(name)
        );
        setSelectedLabels([...hiddenSelection, ...visibleSelection]);
      }}
      selectedLabelNames={selectedLabelNames}
      shouldReduceMotion={shouldReduceMotion}
      takeFocusAnimation={takeFocusAnimation}
    />
  );
};

export default MailboxLabelBar;
