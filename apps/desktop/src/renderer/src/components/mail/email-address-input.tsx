import { XIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useState } from "react";

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
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (addresses: readonly string[]) => void;
  suggestedAddresses?: readonly string[];
  value: readonly string[];
}

const NO_SUGGESTED_ADDRESSES: readonly string[] = [];

const EmailAddressInput = ({
  actions,
  accountId,
  disabled = false,
  id,
  label,
  onChange,
  suggestedAddresses = NO_SUGGESTED_ADDRESSES,
  value,
}: EmailAddressInputProps) => {
  const [draft, setDraft] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);
  const indexedSuggestions = useAddressSuggestions(
    [accountId],
    "correspondent",
    draft.length === 0 ? undefined : draft
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

  return (
    <InputGroup className="bg-card dark:bg-card h-auto min-h-9 rounded-none border-0 px-4 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
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
            aria-invalid={isInvalid || undefined}
            aria-label={label}
            autoComplete="off"
            className="z-10 col-start-1 row-start-1 h-6 w-full px-0 text-sm md:text-sm"
            disabled={disabled}
            id={id}
            inputMode="email"
            onBlur={() => commit(draft)}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
              setIsInvalid(false);
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            type="text"
            value={draft}
          />
        </div>
      </div>
      {actions === undefined ? null : (
        <InputGroupAddon align="inline-end" className="gap-0.5 p-0">
          {actions}
        </InputGroupAddon>
      )}
    </InputGroup>
  );
};

export default EmailAddressInput;
