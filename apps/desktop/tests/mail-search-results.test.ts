import { describe, expect, it } from "vitest";

import { toLoadedSearchResults } from "../src/renderer/src/mail/use-mail-search";

describe(toLoadedSearchResults, () => {
  // An empty result list reads as "no matches", so a failure has to be told
  // apart from it.
  it("keeps a failed search apart from one with no matches", () => {
    expect(
      toLoadedSearchResults("query", {
        data: { hasMore: false, threads: [] },
        ok: true,
      })
    ).toStrictEqual({ hasMore: false, key: "query", threads: [] });
    expect(
      toLoadedSearchResults("query", { error: "Index unavailable", ok: false })
    ).toMatchObject({ error: "Index unavailable", key: "query", threads: [] });
  });

  it("treats a request that never answered as failed", () => {
    expect(toLoadedSearchResults("query", undefined)).toMatchObject({
      error: "Could not search your mail",
      key: "query",
    });
  });
});
