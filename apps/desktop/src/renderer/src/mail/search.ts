import { useEffect, useState } from "react";

import { useSearchQuery } from "@/state/mailbox";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The typed query lands in the store immediately so the input stays
 * responsive; the mailbox only refetches once typing settles.
 */
export const useDebouncedSearchQuery = (): string => {
  const searchQuery = useSearchQuery();
  const [debounced, setDebounced] = useState(() => searchQuery.trim());

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebounced(searchQuery.trim());
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchQuery]);

  return debounced;
};
