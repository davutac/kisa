import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { AiModel, AiProviderStatus } from "../../../shared/ipc/ai";
import { connectOpenCode } from "./opencode-client";
import {
  makeTemporaryDirectory,
  parseCliVersion,
  PROVIDER_PROBE_TIMEOUT_MS,
  providerFailure,
  runProbeCommand,
} from "./shared";

const OpenCodeModel = Schema.Struct({
  enabled: Schema.Boolean,
  id: Schema.NonEmptyString,
  name: Schema.String,
  providerID: Schema.NonEmptyString,
  variants: Schema.Array(Schema.Struct({ id: Schema.NonEmptyString })),
});
const OpenCodeInventory = Schema.Struct({
  models: Schema.Struct({ data: Schema.Array(OpenCodeModel) }),
  providers: Schema.Struct({
    data: Schema.Array(
      Schema.Struct({
        activation: Schema.Literals(["auto", "enabled", "disabled"]),
        id: Schema.NonEmptyString,
      })
    ),
  }),
});

export const inferOpenCodeDefaultVariant = (
  providerId: string,
  variants: readonly string[]
): string | undefined => {
  if (variants.length === 1) {
    return variants[0];
  }
  if (providerId === "anthropic" || providerId.startsWith("google")) {
    return variants.includes("high") ? "high" : undefined;
  }
  if (providerId === "openai" || providerId === "opencode") {
    if (variants.includes("medium")) {
      return "medium";
    }
    return variants.includes("high") ? "high" : undefined;
  }
  return undefined;
};

export const mapOpenCodeModels = (
  inventory: readonly (typeof OpenCodeModel)["Type"][]
): readonly AiModel[] => {
  const models: AiModel[] = [];
  const seen = new Set<string>();
  for (const model of inventory) {
    const id = `${model.providerID}/${model.id}`;
    if (!model.enabled || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const variants = [...new Set(model.variants.map((variant) => variant.id))];
    const defaultVariant = inferOpenCodeDefaultVariant(
      model.providerID,
      variants
    );
    models.push({
      id,
      isDefault: false,
      name: model.name.trim() || id,
      optionLabel: "Variant",
      reasoningOptions: variants.map((variant) =>
        variant === defaultVariant
          ? { id: variant, isDefault: true }
          : { id: variant }
      ),
    });
  }
  return models;
};

const catalogRequest = <A>(request: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    catch: () =>
      providerFailure("opencode", "OpenCode could not load its model catalog"),
    try: request,
  });

const loadOpenCodeModels = Effect.fn("loadOpenCodeModels")(
  function* loadOpenCodeModels() {
    const client = yield* connectOpenCode();
    const directory = yield* makeTemporaryDirectory("opencode");
    const location = { directory };
    // Release the temporary catalog's server-side resources before removing its directory.
    yield* Effect.addFinalizer(() =>
      Effect.tryPromise((signal) =>
        client.debug.location.evict({ location }, { signal })
      ).pipe(Effect.timeoutOption(5000), Effect.ignore)
    );
    const inventory = yield* Effect.gen(function* readInventory() {
      yield* catalogRequest((signal) =>
        client.plugin.awaitActivation({ location }, { signal })
      );
      return yield* Effect.all(
        {
          models: catalogRequest((signal) =>
            client.model.list({ location }, { signal })
          ),
          providers: catalogRequest((signal) =>
            client.provider.list({ location }, { signal })
          ),
        },
        { concurrency: "unbounded" }
      );
    }).pipe(
      Effect.timeoutOrElse({
        duration: PROVIDER_PROBE_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            providerFailure("opencode", "OpenCode model discovery timed out")
          ),
      })
    );
    const decoded = yield* Schema.decodeEffect(OpenCodeInventory)(
      inventory
    ).pipe(
      Effect.mapError(() =>
        providerFailure(
          "opencode",
          "OpenCode returned an invalid model catalog"
        )
      )
    );
    const providers = new Set(
      decoded.providers.data
        .filter((provider) => provider.activation !== "disabled")
        .map((provider) => provider.id)
    );
    return mapOpenCodeModels(
      decoded.models.data.filter((model) => providers.has(model.providerID))
    );
  },
  Effect.scoped
);

export const getOpenCodeStatus = Effect.fn("getOpenCodeStatus")(
  function* getOpenCodeStatus(): Effect.fn.Return<AiProviderStatus> {
    const version = yield* runProbeCommand("opencode", ["--version"]);
    if (version === undefined || version.exitCode !== 0) {
      return {
        authentication: "unknown",
        error: "OpenCode CLI is not installed or could not be started",
        installed: false,
        models: [],
        provider: "opencode",
      };
    }
    const cliVersion = parseCliVersion(`${version.stdout}\n${version.stderr}`);
    const unavailable = {
      authentication: "unknown",
      installed: true,
      models: [],
      provider: "opencode",
      version: cliVersion,
    } satisfies AiProviderStatus;
    if (!cliVersion?.startsWith("2.")) {
      return {
        ...unavailable,
        error:
          "OpenCode 2.x is required. Update OpenCode, then refresh providers.",
      };
    }
    const models = yield* loadOpenCodeModels().pipe(Effect.result);
    if (models._tag === "Failure") {
      return { ...unavailable, error: models.failure.message };
    }
    const connectedProviderCount = new Set(
      models.success.map((model) => model.id.split("/", 1)[0])
    ).size;
    return {
      ...unavailable,
      authLabel: connectedProviderCount > 0 ? "opencode" : undefined,
      authentication: connectedProviderCount > 0 ? "authenticated" : "unknown",
      message:
        connectedProviderCount > 0
          ? `${connectedProviderCount} upstream provider${connectedProviderCount === 1 ? "" : "s"} connected through OpenCode.`
          : "OpenCode is available, but it did not report any connected upstream providers.",
      models: models.success,
    };
  }
);
