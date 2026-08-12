import { Effect } from "effect";

type AccountMailWork = (signal: AbortSignal) => Promise<void>;

interface ActiveAccountMailWork {
  readonly completion: Promise<void>;
  readonly controller: AbortController;
  readonly token: symbol;
}

export interface AccountMailWorkSupervisor {
  readonly isSuspended: (accountId: string) => boolean;
  readonly resume: (accountId: string) => void;
  readonly run: (
    accountId: string,
    work: AccountMailWork,
    parentSignal?: AbortSignal
  ) => Promise<void>;
  readonly suspend: (accountId: string) => Effect.Effect<void>;
}

export const makeAccountMailWorkSupervisor = (): AccountMailWorkSupervisor => {
  const activeByAccount = new Map<string, Set<ActiveAccountMailWork>>();
  const suspendedAccounts = new Set<string>();

  const remove = (accountId: string, token: symbol): void => {
    const active = activeByAccount.get(accountId);
    if (active === undefined) {
      return;
    }

    for (const entry of active) {
      if (entry.token === token) {
        active.delete(entry);
        break;
      }
    }

    if (active.size === 0) {
      activeByAccount.delete(accountId);
    }
  };

  const run = (
    accountId: string,
    work: AccountMailWork,
    parentSignal?: AbortSignal
  ): Promise<void> => {
    if (suspendedAccounts.has(accountId) || parentSignal?.aborted === true) {
      return Promise.resolve();
    }

    const controller = new AbortController();
    const token = Symbol(accountId);
    const abort = (): void => {
      controller.abort();
    };
    parentSignal?.addEventListener("abort", abort, { once: true });

    const completion = (async (): Promise<void> => {
      await Promise.resolve();
      try {
        await work(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          throw error;
        }
      } finally {
        parentSignal?.removeEventListener("abort", abort);
        remove(accountId, token);
      }
    })();
    const active = activeByAccount.get(accountId) ?? new Set();
    active.add({ completion, controller, token });
    activeByAccount.set(accountId, active);

    return completion;
  };

  const suspend = Effect.fn("AccountMailWorkSupervisor.suspend")(
    function* suspendAccountMailWork(accountId: string) {
      const completions = yield* Effect.sync(() => {
        suspendedAccounts.add(accountId);
        const active = [...(activeByAccount.get(accountId) ?? [])];

        for (const entry of active) {
          entry.controller.abort();
        }

        return active.map(({ completion }) => completion);
      });

      yield* Effect.promise(() => Promise.allSettled(completions));
    },
    Effect.uninterruptible
  );

  const resume = (accountId: string): void => {
    suspendedAccounts.delete(accountId);
  };

  const isSuspended = (accountId: string): boolean =>
    suspendedAccounts.has(accountId);

  return { isSuspended, resume, run, suspend };
};

export const accountMailWorkSupervisor = makeAccountMailWorkSupervisor();
