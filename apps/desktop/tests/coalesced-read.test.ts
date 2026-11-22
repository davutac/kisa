import { describe, expect, it } from "vitest";

import { createCoalescedRead } from "../src/renderer/src/mail/coalesced-read";

/** Lets every settled promise run its continuations. */
const settle = (): Promise<undefined> => {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  setImmediate(() => {
    resolve(undefined);
  });
  return promise;
};

const createHarness = () => {
  const reads: PromiseWithResolvers<number | undefined>[] = [];
  const pauses: PromiseWithResolvers<undefined>[] = [];
  const applied: number[] = [];
  const reader = createCoalescedRead<number>({
    apply: (result) => {
      applied.push(result);
    },
    pause: () => {
      const pause = Promise.withResolvers<undefined>();
      pauses.push(pause);
      return pause.promise;
    },
    read: () => {
      const read = Promise.withResolvers<number | undefined>();
      reads.push(read);
      return read.promise;
    },
  });
  return { applied, pauses, reader, reads };
};

describe("coalesced read", () => {
  it("answers a burst during a read with one read, after a pause", async () => {
    const { pauses, reader, reads } = createHarness();

    reader.request();
    reader.request();
    reader.request();
    expect(reads).toHaveLength(1);

    reads[0]?.resolve(1);
    await settle();
    expect(reads).toHaveLength(1);

    pauses[0]?.resolve(undefined);
    await settle();
    reads[1]?.resolve(2);
    await settle();
    expect(reads).toHaveLength(2);
    expect(pauses).toHaveLength(1);
  });

  it("applies a result even when a burst already asked for the next read", async () => {
    const { applied, pauses, reader, reads } = createHarness();

    reader.request();
    reader.request();
    reads[0]?.resolve(1);
    await settle();
    expect(applied).toStrictEqual([1]);

    pauses[0]?.resolve(undefined);
    await settle();
    reads[1]?.resolve(2);
    await settle();
    expect(applied).toStrictEqual([1, 2]);
  });

  it("reads again at once when a request comes after the last read settled", async () => {
    const { applied, pauses, reader, reads } = createHarness();

    reader.request();
    reads[0]?.resolve(1);
    await settle();
    reader.request();

    expect(reads).toHaveLength(2);
    expect(pauses).toHaveLength(0);
    reads[1]?.resolve(2);
    await settle();
    expect(applied).toStrictEqual([1, 2]);
  });

  it("keeps the last result through a failed or empty read and is not stuck after it", async () => {
    const { applied, reader, reads } = createHarness();

    reader.request();
    reads[0]?.reject(new Error("closed"));
    await settle();
    reader.request();
    reads[1]?.resolve(undefined);
    await settle();
    reader.request();
    reads[2]?.resolve(3);
    await settle();

    expect(applied).toStrictEqual([3]);
  });

  it("applies nothing and reads no more once stopped", async () => {
    const { applied, pauses, reader, reads } = createHarness();

    reader.request();
    reader.request();
    reader.stop();
    reads[0]?.resolve(1);
    await settle();
    reader.request();

    expect(applied).toStrictEqual([]);
    expect(pauses).toHaveLength(0);
    expect(reads).toHaveLength(1);
  });
});
