import { XIcon } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import { useState } from "react";

import FieldErrorIndicator from "@/components/forms/field-error-indicator";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  findEmailAddressCompletion,
  mergeUniqueEmailAddresses,
  parseEmailAddressList,
} from "@/mail/address";
import { useAddressSuggestions } from "@/mail/use-mail-search";

interface EmailAddressInputProps {
  actions?: ReactNode;
  accountId: string;
  autoFocus?: boolean;
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

const EmailAddressInput = ({
  actions,
  accountId,
  autoFocus = false,
  disabled = false,
  id,
  inputRef,
  label,
  onChange,
  onFocus,
  suggestedAddresses = NO_SUGGESTED_ADDRESSES,
  value,
}: EmailAddressInputProps) => {
  const [draft, setDraft] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);
  const indexedSuggestions = useAddressSuggestions(
    accountId.length === 0 ? [] : [accountId],
    "correspondent",
    accountId.length === 0 || draft.length === 0 ? undefined : draft
  );
  const completion = findEmailAddressCompletion(
    draft,
    [
      ...suggestedAddresses,
      ...indexedSuggestions.map((suggestion) => suggestion.address),
    ],
    [accountId, ...value]
  );

  const commit = (candidate: string): boolean => {
    if (candidate.trim().length === 0) {
      return false;
    }

    const addresses = parseEmailAddressList(candidate);

    if (addresses.length === 0) {
      setIsInvalid(true);
      return false;
    }

    onChange(mergeUniqueEmailAddresses(value, addresses));
    setDraft("");
    setIsInvalid(false);
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && draft.length === 0) {
      onChange(value.slice(0, -1));
      return;
    }

    if (event.key === "Tab" && completion !== undefined) {
      event.preventDefault();
      commit(completion);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      commit(completion ?? draft);
      return;
    }

    if (event.key === "," || event.key === ";" || event.key === " ") {
      event.preventDefault();
      commit(draft);
    }
  };

  const removeAddress = (addressToRemove: string) => {
    onChange(value.filter((address) => address !== addressToRemove));
  };

  const clearInvalidDraft = (event: MouseEvent<HTMLButtonElement>): void => {
    const input = event.currentTarget
      .closest('[data-slot="input-group"]')
      ?.querySelector("input");
    setDraft("");
    setIsInvalid(false);
    input?.focus();
  };

  return (
    <InputGroup className="bg-card dark:bg-card h-auto min-h-9 rounded-none border-0 px-4 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0 has-[[data-slot][aria-invalid=true]]:border-transparent has-[[data-slot][aria-invalid=true]]:ring-0 dark:has-[[data-slot][aria-invalid=true]]:ring-0">
      <InputGroupAddon className="w-10 justify-start p-0">
        <label htmlFor={id}>{label}</label>
      </InputGroupAddon>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1">
        {value.map((address) => (
          <Badge
            className="h-6 max-w-64 px-2.5 pr-1.5 text-xs"
            key={address}
            variant="secondary"
          >
            <span className="truncate">{address}</span>
            <button
              aria-label={`Remove ${address}`}
              className="hover:bg-foreground/10 focus-visible:ring-ring/50 grid size-3.5 shrink-0 place-items-center rounded-full p-0 focus-visible:ring-2 focus-visible:outline-none [&_svg]:size-2.5!"
              disabled={disabled}
              onClick={() => removeAddress(address)}
              type="button"
            >
              <XIcon />
            </button>
          </Badge>
        ))}
        <div className="grid min-w-32 flex-1">
          <div
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 flex h-6 min-w-0 items-center overflow-hidden px-0 py-0.5 text-sm whitespace-pre md:text-sm"
          >
            <span className="invisible">{draft}</span>
            {completion === undefined ? null : (
              <span className="text-muted-foreground">
                {completion.slice(draft.length)}
              </span>
            )}
          </div>
          <InputGroupInput
            aria-describedby={isInvalid ? `${id}-error` : undefined}
            aria-invalid={isInvalid || undefined}
            aria-label={label}
            autoComplete="off"
            autoFocus={autoFocus}
            className="aria-invalid:text-destructive z-10 col-start-1 row-start-1 h-6 w-full px-0 text-sm aria-invalid:border-0 md:text-sm"
            disabled={disabled}
            id={id}
            inputMode="email"
            onBlur={() => commit(draft)}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setIsInvalid(false);
            }}
            onFocus={onFocus}
            onKeyDown={handleKeyDown}
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={draft}
          />
        </div>
      </div>
      {actions === undefined && !isInvalid ? null : (
        <InputGroupAddon align="inline-end" className="gap-0.5 p-0">
          {isInvalid ? (
            <>
              <FieldErrorIndicator
                id={`${id}-error`}
                message="Invalid email address"
              />
              <button
                aria-label="Clear invalid email address"
                className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground focus-visible:ring-ring/50 grid size-6 place-items-center rounded-md outline-none focus-visible:ring-2"
                onClick={clearInvalidDraft}
                title="Clear"
                type="button"
              >
                <XIcon className="size-3.5" />
              </button>
            </>
          ) : null}
          {actions}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
};

export default EmailAddressInput;
