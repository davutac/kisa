const SCHEDULED_MAIL_CLAIM_PAGE_SIZE = 25;

interface ScheduledMailClaimPageOptions<Candidate, Cursor, Result> {
  readonly claim: (candidate: Candidate) => Promise<Result | undefined>;
  readonly loadPage: (
    cursor: Cursor | undefined,
    pageSize: number
  ) => Promise<readonly Candidate[]>;
  readonly toCursor: (candidate: Candidate) => Cursor;
}

export const claimFirstAvailableScheduledMail = async <
  Candidate,
  Cursor,
  Result,
>({
  claim,
  loadPage,
  toCursor,
}: ScheduledMailClaimPageOptions<Candidate, Cursor, Result>): Promise<
  Result | undefined
> => {
  let cursor: Cursor | undefined;
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- Keyset pages must be loaded and claimed in durable delivery order.
    const candidates = await loadPage(cursor, SCHEDULED_MAIL_CLAIM_PAGE_SIZE);
    for (const candidate of candidates) {
      // oxlint-disable-next-line no-await-in-loop -- Claim attempts are serialized to preserve delivery order.
      const claimed = await claim(candidate);
      if (claimed !== undefined) {
        return claimed;
      }
    }
    if (candidates.length < SCHEDULED_MAIL_CLAIM_PAGE_SIZE) {
      return;
    }
    const last = candidates.at(-1);
    if (last === undefined) {
      return;
    }
    cursor = toCursor(last);
  }
};
