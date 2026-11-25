import { ArrowRightIcon, XIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useState } from "react";
import { flushSync } from "react-dom";

import FieldErrorIndicator from "@/components/forms/field-error-indicator";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxChip,
  ComboboxChipRemove,
  ComboboxChips,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxValue,
  createComboboxController,
} from "@/components/ui/combobox";
import { Kbd } from "@/components/ui/kbd";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { cn } from "@/lib/utils";
import {
  findEmailAddressSuggestions,
  mergeUniqueEmailAddresses,
  parseEmailAddressList,
} from "@/mail/address";
import { useAddressSuggestions } from "@/mail/use-mail-search";

interface EmailAddressInputProps {
  actions?: ReactNode;
  accountId: string;
  autoFocus?: boolean;
  /** Restyles the row, e.g. to sit on the page instead of a card. */
  className?: string;
  disabled?: boolean;
  id: string;
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  onChange: (addresses: readonly string[]) => void;
  onFocus?: () => void;
  suggestedAddresses?: readonly string[];
  value: readonly string[];
}

const NO_SUGGESTED_ADDRESSES: readonly string[] = [];
const SEPARATOR_KEYS = new Set([",", ";", " "]);

/**
 * A suggestion matches loosely, so `ann@corp.com` may highlight
 * `joann@corp.com`. Once the draft is a whole address with a domain, Enter
 * and Tab keep it unless the highlight merely completes it.
 */
const keepsTypedAddress = (draft: string, highlighted: string): boolean => {
  const [typed, ...rest] = parseEmailAddressList(draft);
  return (
    typed === draft &&
    rest.length === 0 &&
    typed.slice(typed.indexOf("@")).includes(".") &&
    !highlighted.toLowerCase().startsWith(draft.toLowerCase())
  );
};

const EmailAddressInput = ({
  actions,
  accountId,
  autoFocus = false,
  className,
  disabled = false,
  id,
  inputRef,
  label,
  onChange,
  onFocus,
  suggestedAddresses = NO_SUGGESTED_ADDRESSES,
  value,
}: EmailAddressInputProps) => {
  const combobox = useInstanceValue(createComboboxController<string, true>);
  const [draft, setDraft] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);
  const [isListWanted, setIsListWanted] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // The last answer stays, narrowed to the new draft below, until the next
  // one arrives, so the hint doesn't blink and Tab never finds a gap.
  const indexedSuggestions = useAddressSuggestions(
    accountId.length === 0 ? [] : [accountId],
    "correspondent",
    accountId.length === 0 || draft.length === 0 ? undefined : draft,
    { whileLoading: "previous" }
  );
  const suggestions = findEmailAddressSuggestions(
    draft,
    [
      ...suggestedAddresses.map((address) => ({ address })),
      ...indexedSuggestions,
    ],
    [accountId, ...value]
  );
  const isListOpen = isListWanted && suggestions.length > 0;
  // What Tab takes: the highlighted suggestion, shown after the draft. A
  // whole typed address it doesn't complete has none, so Tab leaves the
  // field and adds what was typed, as Enter does.
  const hinted =
    !isListOpen || highlighted === null || keepsTypedAddress(draft, highlighted)
      ? undefined
      : suggestions.find(({ address }) => address === highlighted);

  const add = (addresses: readonly string[]) => {
    onChange(mergeUniqueEmailAddresses(value, addresses));
    setDraft("");
    setIsInvalid(false);
  };

  const commit = (candidate: string): boolean => {
    if (candidate.trim().length === 0) {
      return false;
    }

    const addresses = parseEmailAddressList(candidate);

    if (addresses.length === 0) {
      setIsInvalid(true);
      return false;
    }

    add(addresses);
    return true;
  };

  // Enter chooses a highlighted suggestion through the combobox; without one
  // it commits the typed text and must never submit the surrounding form.
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && hinted !== undefined && !event.shiftKey) {
      event.preventDefault();
      add([hinted.address]);
      return;
    }

    const isEnter = event.key === "Enter";
    if (!isEnter && !SEPARATOR_KEYS.has(event.key)) {
      return;
    }

    const current = combobox.getHighlighted();
    const chosen =
      current === null || keepsTypedAddress(draft, current) ? null : current;

    if (event.altKey || event.ctrlKey || event.metaKey) {
      // A chord like Mod+Enter adds what Enter would, emptying the field first
      // so the combobox's own Enter keeps nothing and `@/hotkeys` can send.
      flushSync(() => {
        if (isEnter && chosen !== null) {
          add([chosen]);
        } else {
          commit(draft);
        }
      });
      return;
    }

    if (!isEnter || chosen === null) {
      event.preventDefault();
      commit(draft);
    }
  };

  return (
    <div
      className={cn(
        "bg-card dark:bg-card flex min-h-9 w-full min-w-0 items-center px-4",
        className
      )}
      id={id}
    >
      {/* `keepQuery` leaves the draft to this field: it empties only once
          an address is added. Otherwise the combobox would empty it whenever
          the list closes, including when the draft stops matching anyone. */}
      <Combobox
        allowCustomValue
        autoHighlight
        controller={combobox}
        disabled={disabled}
        filter={false}
        keepQuery
        multiple
        onHighlight={setHighlighted}
        onOpenChange={(open, details) => {
          // Typing asks before its suggestions load; anything else opens now.
          if (
            open &&
            suggestions.length === 0 &&
            details.reason !== "input-change"
          ) {
            details.cancel();
            return;
          }
          setIsListWanted(open);
          // The combobox drops its highlight on close without reporting it.
          if (!open) {
            setHighlighted(null);
          }
        }}
        onQueryChange={(query) => {
          setDraft(query);
          setIsInvalid(false);
        }}
        onValueChange={(next, details) => {
          const kept = next.filter((address) => value.includes(address));
          const added = next.filter((address) => !value.includes(address));
          const addresses = parseEmailAddressList(added.join(","));

          if (added.length > 0 && addresses.length === 0) {
            details.cancel();
            setIsInvalid(true);
            return;
          }

          onChange(mergeUniqueEmailAddresses(kept, addresses));
          if (added.length > 0) {
            setDraft("");
            setIsInvalid(false);
          }
        }}
        items={suggestions.map(({ address }) => ({
          label: address,
          value: address,
        }))}
        open={isListOpen}
        query={draft}
        value={[...value]}
      >
        <ComboboxLabel className="text-muted-foreground w-10 shrink-0 text-xs/relaxed font-medium">
          {label}
        </ComboboxLabel>
        <ComboboxChips className="py-1">
          <ComboboxValue>
            {(state) =>
              (state.value as string[]).map((address) => (
                <ComboboxChip key={address} value={address}>
                  <span className="truncate">{address}</span>
                  <ComboboxChipRemove aria-label={`Remove ${address}`}>
                    <XIcon aria-hidden="true" />
                  </ComboboxChipRemove>
                </ComboboxChip>
              ))
            }
          </ComboboxValue>
          <ComboboxInput
            aria-describedby={isInvalid ? `${id}-error` : undefined}
            aria-invalid={isInvalid || undefined}
            autoFocus={autoFocus}
            className={
              hinted === undefined
                ? "min-w-32 flex-1"
                : "field-sizing-content w-auto min-w-1 flex-none"
            }
            inputMode="email"
            onBlur={() => {
              setIsListWanted(false);
              commit(draft);
            }}
            onFocus={onFocus}
            onKeyDown={handleKeyDown}
            ref={inputRef}
          />
          {hinted === undefined ? null : (
            // The list already names the option for assistive technology.
            <span
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none flex min-w-0 flex-1 items-center gap-1.5 text-sm select-none"
              data-slot="recipient-hint"
            >
              <span className="flex min-w-0 items-center gap-1.5 opacity-60">
                <ArrowRightIcon className="size-3 shrink-0" />
                <span className="truncate">{hinted.address}</span>
              </span>
              <Kbd className="shrink-0">Tab</Kbd>
            </span>
          )}
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxList>
            {suggestions.map((suggestion) => (
              <ComboboxItem
                key={suggestion.address}
                label={suggestion.address}
                value={suggestion.address}
              >
                {suggestion.name === undefined ? null : (
                  <span className="truncate font-medium">
                    {suggestion.name}
                  </span>
                )}
                <span className="text-muted-foreground truncate">
                  {suggestion.address}
                </span>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {actions === undefined && !isInvalid ? null : (
        <div className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs/relaxed font-medium">
          {isInvalid ? (
            <>
              <FieldErrorIndicator
                id={`${id}-error`}
                message="Invalid email address"
              />
              <Button
                aria-label="Clear invalid email address"
                onClick={() => {
                  setDraft("");
                  setIsInvalid(false);
                  combobox.focus();
                }}
                size="icon-xs"
                title="Clear"
                type="button"
                variant="ghost"
              >
                <XIcon />
              </Button>
            </>
          ) : null}
          {actions}
        </div>
      )}
    </div>
  );
};

export default EmailAddressInput;
