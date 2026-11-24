import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { RefObject } from "react";

import { Input } from "@/components/ui/input";
import {
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { toast } from "@/components/ui/toast";
import type { AccountsApi } from "@/platform/desktop";
import type { Account } from "@/shared/ipc/accounts";
import { MAX_DISPLAY_NAME_LENGTH } from "@/shared/mail-account-presets";

import { toAccountSettingsPage } from "./settings-pages";
import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";

/** How long typing pauses before the name saves. */
export const ACCOUNT_NAME_SAVE_DELAY_MS = 500;

/**
 * What main accepts: a pasted tab or line break becomes a space, since a
 * control character would break the From header.
 */
export const toAccountName = (text: string): string =>
  // oxlint-disable-next-line no-control-regex -- Control characters are what this replaces.
  text
    .replaceAll(/\p{Cc}+/gu, " ")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH);

interface AccountNameSaves {
  readonly accountsApi: AccountsApi;
  readonly email: string;
  readonly isSavingRef: RefObject<boolean>;
  /** The name waiting to be saved. */
  readonly pendingRef: RefObject<string | null>;
  /** The name main holds, as far as the row knows. */
  readonly storedRef: RefObject<string>;
}

/**
 * Saves the waiting name, then any typed meanwhile, one at a time in typing
 * order. It uses only refs, so it finishes after the row unmounts.
 */
const saveAccountNames = async ({
  accountsApi,
  email,
  isSavingRef,
  pendingRef,
  storedRef,
}: AccountNameSaves): Promise<void> => {
  if (isSavingRef.current) {
    return;
  }
  isSavingRef.current = true;
  try {
    while (pendingRef.current !== null) {
      const name = pendingRef.current;
      pendingRef.current = null;
      if (name === storedRef.current) {
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- Saves go one at a time, in typing order.
      const reply = await accountsApi.updateAccountName({ email, name });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      storedRef.current = name;
    }
  } catch {
    toast.error("Could not save the name", {
      description: "Please try again.",
    });
  } finally {
    isSavingRef.current = false;
  }
};

interface SettingsAccountNameRowProps {
  readonly account: Account;
  readonly accountsApi: AccountsApi;
}

/**
 * The name mail from this account goes out with, saved once typing pauses,
 * and at once when the field loses focus or Settings closes or changes page,
 * so nothing typed is lost. Saves run one at a time in typing order. A name
 * changed in another window replaces the field's text unless it is being
 * edited here.
 */
const SettingsAccountNameRow = ({
  account,
  accountsApi,
}: SettingsAccountNameRowProps) => {
  const saved = account.displayName ?? "";
  const [draft, setDraft] = useState(saved);
  const [shownSaved, setShownSaved] = useState(saved);
  // What the saves share, and the pause before the next one.
  const storedRef = useRef(saved);
  const pendingRef = useRef<string | null>(null);
  const isSavingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descriptionId = `account-${account.email}-name-description`;

  if (saved !== shownSaved) {
    setShownSaved(saved);
    if (draft === shownSaved) {
      setDraft(saved);
    }
  }

  useEffect(() => {
    storedRef.current = saved;
  }, [saved]);

  const saveNow = (): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void saveAccountNames({
      accountsApi,
      email: account.email,
      isSavingRef,
      pendingRef,
      storedRef,
    });
  };

  const saveOnUnmount = useEffectEvent(() => {
    if (pendingRef.current !== null) {
      saveNow();
    }
  });

  useEffect(() => () => saveOnUnmount(), []);

  return (
    <SearchableSettingsRow
      target={toSettingsTarget(toAccountSettingsPage(account.email), "name")}
    >
      <SettingsRowContent>
        <SettingsRowTitle>Sender name</SettingsRowTitle>
        <SettingsRowDescription id={descriptionId}>
          Shown as who mail from this account is from. Leave it empty to send
          with the address alone.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Input
          aria-describedby={descriptionId}
          aria-label={`Sender name for ${account.email}`}
          autoComplete="name"
          className="w-56"
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          onBlur={() => {
            if (pendingRef.current !== null) {
              saveNow();
            }
          }}
          onValueChange={(value) => {
            setDraft(value);
            pendingRef.current = toAccountName(value);
            if (timerRef.current !== null) {
              clearTimeout(timerRef.current);
            }
            timerRef.current = setTimeout(saveNow, ACCOUNT_NAME_SAVE_DELAY_MS);
          }}
          placeholder="No name"
          spellCheck={false}
          value={draft}
        />
      </SettingsRowActions>
    </SearchableSettingsRow>
  );
};

export default SettingsAccountNameRow;
