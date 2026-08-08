import * as Schema from "effect/Schema";

export const UpdateStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("idle") }),
  Schema.Struct({ state: Schema.Literal("checking") }),
  Schema.Struct({
    percent: Schema.Finite,
    state: Schema.Literal("downloading"),
    version: Schema.String,
  }),
  Schema.Struct({ state: Schema.Literal("ready"), version: Schema.String }),
  Schema.Struct({ state: Schema.Literal("unsupported") }),
]);
export type UpdateStatus = typeof UpdateStatus.Type;

const MIN_PROGRESS = 0;
const MAX_PROGRESS = 100;

export const clampUpdateProgress = (percent: number): number =>
  Math.min(MAX_PROGRESS, Math.max(MIN_PROGRESS, Math.round(percent)));

export const normalizeUpdateStatus = (status: UpdateStatus): UpdateStatus => {
  if (status.state !== "downloading") {
    return status;
  }

  return {
    ...status,
    percent: clampUpdateProgress(status.percent),
  };
};
