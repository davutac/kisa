import { describe, expect, it } from "vitest";

import { claimFirstAvailableScheduledMail } from "../src/main/mail/scheduled-mail-claim-pages";

describe("scheduled mail due-claim paging", () => {
  it("continues past 25 suspended candidates to another account", async () => {
    interface Candidate {
      readonly accountId: string;
      readonly order: number;
    }
    const candidates = [
      ...Array.from({ length: 25 }, (_, index) => ({
        accountId: "paused@example.com",
        order: index,
      })),
      { accountId: "ready@example.com", order: 25 },
    ];
    const loadedCursors: (number | undefined)[] = [];

    const claimed = await claimFirstAvailableScheduledMail<
      Candidate,
      number,
      Candidate
    >({
      claim: (candidate) =>
        Promise.resolve(
          candidate.accountId === "paused@example.com" ? undefined : candidate
        ),
      loadPage: (cursor, pageSize) => {
        loadedCursors.push(cursor);
        const start = cursor === undefined ? 0 : cursor + 1;
        return Promise.resolve(candidates.slice(start, start + pageSize));
      },
      toCursor: ({ order }) => order,
    });

    expect(claimed).toStrictEqual({
      accountId: "ready@example.com",
      order: 25,
    });
    expect(loadedCursors).toStrictEqual([undefined, 24]);
  });
});
