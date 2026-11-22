interface CoalescedReadOptions<A> {
  /** Receives every result, in order; reads never overlap. */
  readonly apply: (result: A) => void;
  /** Waits between a read and the one a burst of requests asked for. */
  readonly pause: () => Promise<void>;
  /** `undefined`, or a rejection, keeps what was last applied. */
  readonly read: () => Promise<A | undefined>;
}

export interface CoalescedRead {
  readonly request: () => void;
  readonly stop: () => void;
}

/**
 * Keeps an expensive read in step with a bursty event stream. A request while
 * idle reads at once; requests during a read, however many, ask for a single
 * read after it, after `pause`. Reads run one at a time, so each result is
 * newer than the last and is applied even when another read is already due.
 */
export const createCoalescedRead = <A>({
  apply,
  pause,
  read,
}: CoalescedReadOptions<A>): CoalescedRead => {
  let isActive = true;
  let isReading = false;
  let isStale = false;

  const readSafely = async (): Promise<A | undefined> => {
    try {
      return await read();
    } catch {
      return undefined;
    }
  };

  const step = async (): Promise<void> => {
    isStale = false;
    const result = await readSafely();

    if (!isActive) {
      return;
    }
    if (result !== undefined) {
      apply(result);
    }
    if (!isStale) {
      isReading = false;
      return;
    }
    await pause();
    if (isActive) {
      await step();
    }
  };

  return {
    request: () => {
      if (!isActive) {
        return;
      }
      if (isReading) {
        isStale = true;
        return;
      }
      isReading = true;
      void step();
    },
    stop: () => {
      isActive = false;
    },
  };
};
