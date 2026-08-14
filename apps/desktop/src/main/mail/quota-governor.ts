import { setTimeout as delay } from "node:timers/promises";

/**
 * Gmail's binding limit is a per-user, per-project budget of quota units per
 * minute — the project-wide ceiling is far looser and never binds for a
 * desktop client. Every call costs a fixed number of units.
 *
 * "Per user" is load-bearing: each request carries that account's own
 * credentials, so connected accounts draw on entirely separate budgets and can
 * index concurrently without competing. The governor keys its buckets by
 * account id for exactly that reason.
 *
 * The governor keeps one token bucket per account and splits its two callers
 * deliberately:
 *
 * - Foreground work (opening a thread, searching, the history poll) calls
 *   `charge`, which never waits. It records what was spent and is allowed to
 *   push the bucket negative.
 * - The indexer calls `awaitBudget` before starting a page, which waits until
 *   the bucket could cover it.
 *
 * That asymmetry is the whole priority mechanism. There is no queue and no
 * fairness policy to tune: a burst of reading simply leaves the bucket in debt,
 * and the indexer — the only waiter — absorbs it by going slower. The user
 * never waits behind a backfill.
 *
 * `awaitBudget` deliberately does not deduct. Spending is recorded in exactly
 * one place — `charge`, at the point a request actually goes out — so the
 * indexer's own requests are not counted twice. It is a gate, not a
 * reservation, which is safe because only one indexer ever runs per account.
 */

/**
 * Complete Gmail API quota costs, per call, from
 * https://developers.google.com/workspace/gmail/api/reference/quota
 *
 * `threadsGet` at 40 is the number that governs everything here: it is four
 * times `threadsList` and it runs once per thread, so it is essentially the
 * entire cost of indexing.
 */
export const QUOTA_UNITS = {
  draftsCreate: 10,
  draftsDelete: 10,
  draftsGet: 20,
  draftsList: 5,
  draftsSend: 100,
  draftsUpdate: 15,
  getProfile: 1,
  historyList: 2,
  labelsCreate: 5,
  labelsDelete: 5,
  labelsGet: 1,
  labelsList: 1,
  labelsUpdate: 5,
  messagesAttachmentsGet: 20,
  messagesBatchDelete: 50,
  messagesBatchModify: 50,
  messagesDelete: 10,
  messagesGet: 20,
  messagesImport: 25,
  messagesInsert: 25,
  messagesList: 5,
  messagesModify: 5,
  messagesSend: 100,
  messagesTrash: 20,
  messagesUntrash: 5,
  settingsDelegatesCreate: 100,
  settingsDelegatesDelete: 5,
  settingsDelegatesGet: 1,
  settingsDelegatesList: 1,
  settingsFiltersCreate: 5,
  settingsFiltersDelete: 5,
  settingsFiltersGet: 1,
  settingsFiltersList: 1,
  settingsForwardingAddressesCreate: 100,
  settingsForwardingAddressesDelete: 5,
  settingsForwardingAddressesGet: 1,
  settingsForwardingAddressesList: 1,
  settingsGetAutoForwarding: 1,
  settingsGetImap: 1,
  settingsGetPop: 1,
  settingsGetVacation: 1,
  settingsSendAsCreate: 100,
  settingsSendAsDelete: 5,
  settingsSendAsGet: 1,
  settingsSendAsList: 1,
  settingsSendAsUpdate: 100,
  settingsSendAsVerify: 100,
  settingsUpdateAutoForwarding: 5,
  settingsUpdateImap: 5,
  settingsUpdatePop: 100,
  settingsUpdateVacation: 5,
  stop: 50,
  threadsDelete: 20,
  threadsGet: 40,
  threadsList: 10,
  threadsModify: 10,
  threadsTrash: 20,
  threadsUntrash: 10,
  watch: 100,
} as const;

/**
 * The per-user ceiling, read from the project's own quota page rather than the
 * docs: **15,000 quota units per minute per user** (250/second), alongside a
 * far looser 1,200,000/minute per project. Google's published default is now
 * 6,000/minute; established projects retain the older, higher allowance, and
 * the console is authoritative for the project actually being billed.
 *
 * The per-user limit is the binding one, and it is per *user*: every call is
 * made with that account's own credentials, so accounts do not share a budget
 * and can index concurrently.
 *
 * 150 units/second is 60% of the ceiling. The headroom matters because the
 * limit is enforced over a one-minute window and the indexer spends in lumps:
 * a page of 100 threads costs ~4,010 units, so at 150/second a page lands
 * every ~27 seconds and any 60-second window holds at most three — 12,030
 * units, inside the limit even if a page lands early. Running at the full 250
 * would put a window at exactly 15,000, with no room for the foreground poll
 * or a thread the user opens.
 */
const DEFAULT_UNITS_PER_SECOND = 150;

/**
 * Sized to hold exactly one indexer page (~4,010 units) plus a margin.
 *
 * This is a units figure rather than a number of seconds because the constraint
 * is structural, not temporal: the bucket must be able to cover a whole page or
 * `awaitBudget` degrades into firing pages on partial budget and running on
 * debt. Holding one page means the indexer issues a page, then waits out its
 * full cost before the next — which is exactly the pacing the one-minute
 * window requires.
 */
const DEFAULT_BURST_UNITS = 4200;

/** How far a repeatedly rate-limited account can be slowed. */
const MIN_RATE_MULTIPLIER = 0.0625;
const RATE_LIMIT_BACKOFF = 0.5;

/** Recovery is slower than the cut, so a flapping account settles low. */
const RATE_RECOVERY_STEP = 1.25;
const RATE_RECOVERY_INTERVAL_MS = 30_000;

const MAX_WAIT_MS = 60_000;
const MIN_WAIT_MS = 25;

interface AccountBudget {
  availableUnits: number;
  lastRefillAt: number;
  lastRateLimitAt: number;
  rateMultiplier: number;
}

export interface QuotaGovernorOptions {
  readonly burstUnits?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly unitsPerSecond?: number;
}

export interface QuotaGovernor {
  /**
   * Background work: resolves once the budget could cover `units`. Does not
   * deduct — the caller's own requests charge as they go.
   */
  readonly awaitBudget: (accountId: string, units: number) => Promise<void>;
  /** Foreground work: records the spend without ever waiting. */
  readonly charge: (accountId: string, units: number) => void;
  /** Current units per second for the account, after any backoff. */
  readonly getRate: (accountId: string) => number;
  /** Halves the account's rate; call on a Gmail rate-limit error. */
  readonly reportRateLimited: (accountId: string) => void;
}

const defaultSleep = async (milliseconds: number): Promise<void> => {
  await delay(milliseconds);
};

export const createQuotaGovernor = (
  options: QuotaGovernorOptions = {}
): QuotaGovernor => {
  const unitsPerSecond = options.unitsPerSecond ?? DEFAULT_UNITS_PER_SECOND;
  const burstUnits = options.burstUnits ?? DEFAULT_BURST_UNITS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const budgets = new Map<string, AccountBudget>();

  const getBudget = (accountId: string): AccountBudget => {
    const existing = budgets.get(accountId);

    if (existing !== undefined) {
      return existing;
    }

    const created: AccountBudget = {
      availableUnits: burstUnits,
      lastRateLimitAt: 0,
      lastRefillAt: now(),
      rateMultiplier: 1,
    };

    budgets.set(accountId, created);

    return created;
  };

  const currentRate = (budget: AccountBudget): number =>
    unitsPerSecond * budget.rateMultiplier;

  const refill = (budget: AccountBudget): void => {
    const timestamp = now();
    const elapsed = timestamp - budget.lastRefillAt;

    budget.lastRefillAt = timestamp;

    if (
      budget.rateMultiplier < 1 &&
      timestamp - budget.lastRateLimitAt >= RATE_RECOVERY_INTERVAL_MS
    ) {
      budget.rateMultiplier = Math.min(
        1,
        budget.rateMultiplier * RATE_RECOVERY_STEP
      );
      budget.lastRateLimitAt = timestamp;
    }

    if (elapsed <= 0) {
      return;
    }

    budget.availableUnits = Math.min(
      burstUnits,
      budget.availableUnits + (currentRate(budget) * elapsed) / 1000
    );
  };

  return {
    awaitBudget: async (accountId, units) => {
      const budget = getBudget(accountId);

      for (;;) {
        refill(budget);

        // Never wait for more than the bucket can ever hold, or a caller asking
        // for an oversized amount would wait forever.
        const target = Math.min(units, burstUnits);

        if (budget.availableUnits >= target) {
          return;
        }

        // Wait for exactly the shortfall rather than a fixed tick, so the
        // indexer paces itself to the rate instead of busy-looping.
        const shortfall = target - budget.availableUnits;
        const waitMs = Math.min(
          MAX_WAIT_MS,
          Math.max(MIN_WAIT_MS, (shortfall / currentRate(budget)) * 1000)
        );

        // oxlint-disable-next-line eslint/no-await-in-loop
        await sleep(waitMs);
      }
    },

    charge: (accountId, units) => {
      const budget = getBudget(accountId);

      refill(budget);
      budget.availableUnits -= units;
    },

    getRate: (accountId) => {
      const budget = getBudget(accountId);

      // Refill first: recovery from a rate limit is applied as time passes, so
      // reading the rate without it would report a stale, still-throttled value
      // for an account that has since been left alone.
      refill(budget);

      return currentRate(budget);
    },

    reportRateLimited: (accountId) => {
      const budget = getBudget(accountId);

      refill(budget);
      budget.rateMultiplier = Math.max(
        MIN_RATE_MULTIPLIER,
        budget.rateMultiplier * RATE_LIMIT_BACKOFF
      );
      budget.lastRateLimitAt = now();
      // Drop whatever is banked as well: the limit is a moving average, so the
      // account is already over budget and spending the rest would extend it.
      budget.availableUnits = Math.min(budget.availableUnits, 0);
    },
  };
};

export const mailQuotaGovernor = createQuotaGovernor();
