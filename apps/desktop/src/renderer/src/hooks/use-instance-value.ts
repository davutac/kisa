import { useState } from "react";

/**
 * Creates a value on the first render and returns that same value for the
 * component instance's lifetime, even when inputs read by `create` change.
 * Unlike `useMemo`, React never discards and recomputes it.
 */
export const useInstanceValue = <T>(create: () => T): T => {
  // oxlint-disable-next-line react/hook-use-state -- The value is never replaced, so there is no setter to name.
  const [value] = useState(create);
  return value;
};
