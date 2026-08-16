import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

import type { AiProvider } from "../../../shared/ipc/ai";
import { AiProviderError } from "../errors";
import { runAiCommand } from "../process";
import type { AiCommandError, AiCommandResult } from "../process";

export const GENERATION_TIMEOUT_MS = 180_000;
export const PROVIDER_PROBE_TIMEOUT_MS = 15_000;

export const parseCliVersion = (output: string): string | undefined =>
  /\b(?<version>\d+\.\d+\.\d+)\b/u.exec(output)?.groups?.["version"];

const PROVIDER_NAMES = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
} satisfies Record<AiProvider, string>;

export interface StructuredGenerationInput<S extends Schema.Top> {
  readonly model: string;
  readonly outputSchema: S;
  readonly reasoning?: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
}

export type StructuredGenerationResult<S extends Schema.Top> = Effect.fn.Return<
  S["Type"],
  AiProviderError,
  S["DecodingServices"] | Scope.Scope
>;

export const providerFailure = (
  provider: AiProvider,
  message: string
): AiProviderError => new AiProviderError({ message, provider });

export const commandFailure = (
  provider: AiProvider,
  error: AiCommandError
): AiProviderError => {
  if (error.kind === "not-installed") {
    return providerFailure(
      provider,
      `${PROVIDER_NAMES[provider]} CLI is not installed or is not on PATH`
    );
  }
  if (error.kind === "timeout") {
    return providerFailure(provider, `${provider} AI request timed out`);
  }
  return providerFailure(provider, `${provider} AI request failed`);
};

export const makeTemporaryDirectory = (provider: AiProvider) =>
  Effect.acquireRelease(
    Effect.tryPromise({
      catch: () =>
        providerFailure(provider, "Could not prepare the AI request"),
      try: () => mkdtemp(path.join(os.tmpdir(), "kisa-ai-")),
    }),
    (directory) =>
      Effect.tryPromise(() =>
        rm(directory, { force: true, recursive: true })
      ).pipe(Effect.ignore)
  );

export const toJsonSchemaObject = (schema: Schema.Top): unknown => {
  const document = Schema.toJsonSchemaDocument(schema);
  return document.definitions && Object.keys(document.definitions).length > 0
    ? { ...document.schema, $defs: document.definitions }
    : document.schema;
};

export const decodeGeneratedJson = <S extends Schema.Top>(
  provider: AiProvider,
  schema: S,
  raw: string
): Effect.Effect<S["Type"], AiProviderError, S["DecodingServices"]> =>
  Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(() =>
      providerFailure(provider, `${provider} returned an invalid response`)
    )
  );

export const runProbeCommand = (
  command: string,
  args: readonly string[],
  cwd = process.cwd()
): Effect.Effect<AiCommandResult | undefined> =>
  runAiCommand({
    args,
    command,
    cwd,
    timeoutMs: PROVIDER_PROBE_TIMEOUT_MS,
  }).pipe(Effect.option, Effect.map(Option.getOrUndefined));
