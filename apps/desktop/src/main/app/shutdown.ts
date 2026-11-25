interface QuitRequest {
  readonly preventDefault: () => void;
}

type ShutdownStep = () => Promise<void>;

/**
 * `running` until the first quit request, `cleaning` while the stages run,
 * `exiting` once the app may really quit.
 */
type ShutdownPhase = "cleaning" | "exiting" | "running";

interface ShutdownOptions {
  /** Runs once, synchronously, when the first quit request arrives. */
  readonly begin: () => void;
  readonly quit: () => void;
  readonly scheduleDeadline: (
    run: () => void,
    delayMs: number
  ) => { readonly cancel: () => void };
  /** How long one stage may take before cleanup moves on without it. */
  readonly stageDeadlineMs: number;
  /** Stages run in order; the steps of one stage run together. */
  readonly stages: readonly (readonly ShutdownStep[])[];
}

interface Shutdown {
  readonly handleQuitRequest: (request: QuitRequest) => void;
}

/**
 * Owns the app's quit: the first request is held while cleanup runs, and so
 * is every further request until cleanup has ended, so a second Quit cannot
 * cut the database close short. A step that fails does not stop the steps
 * after it. A stage that hangs is left behind at its deadline, so the later
 * stages still get their turn and the app still quits.
 */
export const createShutdown = ({
  begin,
  quit,
  scheduleDeadline,
  stageDeadlineMs,
  stages,
}: ShutdownOptions): Shutdown => {
  let phase: ShutdownPhase = "running";

  const runStage = async (stage: readonly ShutdownStep[]): Promise<void> => {
    const ended = Promise.withResolvers<null>();

    const deadline = scheduleDeadline(() => {
      ended.resolve(null);
    }, stageDeadlineMs);

    const settle = async (): Promise<void> => {
      await Promise.allSettled(stage.map(async (step) => await step()));
      deadline.cancel();
      ended.resolve(null);
    };

    void settle();
    await ended.promise;
  };

  const clean = async (): Promise<void> => {
    for (const stage of stages) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Stages are ordered: each stops what the next one depends on.
      await runStage(stage);
    }

    phase = "exiting";
    quit();
  };

  return {
    handleQuitRequest: (request) => {
      if (phase === "exiting") {
        return;
      }

      request.preventDefault();

      if (phase === "cleaning") {
        return;
      }

      phase = "cleaning";
      begin();
      void clean();
    },
  };
};
