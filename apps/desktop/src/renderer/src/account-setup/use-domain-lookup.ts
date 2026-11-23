import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AccountSetupBridge } from "@/shared/ipc/account-setup";

import { withDomainLookup } from "./account-setup-form";
import type { AccountSetupForm } from "./account-setup-form";

/**
 * How long the address rests before main is asked who hosts its domain, so
 * each partial domain typed on the way is not sent to DNS.
 */
const DOMAIN_LOOKUP_DELAY_MS = 300;

/**
 * Asks main who hosts `domain`'s mail once typing rests, and records the
 * answer in the form. Every way this can fail answers "nobody Kisa knows",
 * so the form falls back to server fields rather than waiting. A reply for a
 * domain the address has since left is dropped.
 */
export const useDomainLookup = (
  bridge: AccountSetupBridge | undefined,
  domain: string | undefined,
  setForm: Dispatch<SetStateAction<AccountSetupForm>>
): void => {
  useEffect(() => {
    if (domain === undefined) {
      return;
    }
    let isCurrent = true;
    const settle = (provider: "gmail" | null | undefined): void => {
      if (isCurrent) {
        setForm((current) =>
          withDomainLookup(current, { domain, provider: provider ?? undefined })
        );
      }
    };
    const lookUp = async (): Promise<void> => {
      if (bridge === undefined) {
        settle(undefined);
        return;
      }
      try {
        const reply = await bridge.lookupMailDomain({ domain });
        settle(reply.ok ? reply.data : undefined);
      } catch {
        settle(undefined);
      }
    };
    const timer = window.setTimeout(() => {
      void lookUp();
    }, DOMAIN_LOOKUP_DELAY_MS);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [bridge, domain, setForm]);
};
