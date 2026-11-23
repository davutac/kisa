import { XIcon } from "lucide-react";
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
// Closing the list would empty what was typed; a blur commits it instead.
const KEEPS_DRAFT = new Set([
  "escape-key",
  "focus-out",
  "outside-press",
  "window-blur",
]);

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
  const indexedSuggestions = useAddressSuggestions(
    accountId.length === 0 ? [] : [accountId],
    "correspondent",
    accountId.length === 0 || draft.length === 0 ? undefined : draft
  );
  const suggestions = findEmailAddressSuggestions(
    draft,
    [
      ...suggestedAddresses.map((address) => ({ address })),
      ...indexedSuggestions,
    ],
    [accountId, ...value]
  );

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
    const highlighted = combobox.getHighlighted();

    if (event.key === "Tab" && highlighted !== null && !event.shiftKey) {
      event.preventDefault();
      add([highlighted]);
      return;
    }

    const isEnter = event.key === "Enter";
    if (!isEnter && !SEPARATOR_KEYS.has(event.key)) {
      return;
    }

    if (event.altKey || event.ctrlKey || event.metaKey) {
      // A chord like Mod+Enter adds what Enter would, emptying the field first
      // so the combobox's own Enter keeps nothing and `@/hotkeys` can send.
      flushSync(() => {
        if (isEnter && highlighted !== null) {
          add([highlighted]);
        } else {
          commit(draft);
        }
      });
      return;
    }

    if (!isEnter || highlighted === null) {
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
      <Combobox
        allowCustomValue
        autoHighlight
        controller={combobox}
        disabled={disabled}
        filter={false}
        multiple
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
        }}
        onQueryChange={(query, details) => {
          if (KEEPS_DRAFT.has(details.reason)) {
            return;
          }
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
        open={isListWanted && suggestions.length > 0}
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
            className="min-w-32 flex-1"
            inputMode="email"
            onBlur={() => {
              setIsListWanted(false);
              commit(draft);
            }}
            onFocus={onFocus}
            onKeyDown={handleKeyDown}
            ref={inputRef}
          />
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
