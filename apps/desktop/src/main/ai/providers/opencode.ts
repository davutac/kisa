import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { AiModel, AiProviderStatus } from "../../../shared/ipc/ai";
import type { AiProviderError } from "../errors";
import {
  aiProcessEnvironment,
  resolveAiSpawnCommand,
  terminateAiProcess,
} from "../process";
import {
  decodeGeneratedJson,
  GENERATION_TIMEOUT_MS,
  makeTemporaryDirectory,
  parseCliVersion,
  providerFailure,
  runProbeCommand,
  toJsonSchemaObject,
} from "./shared";
import type {
  StructuredGenerationInput,
  StructuredGenerationResult,
} from "./shared";

const OPENCODE_SERVER_READY_PREFIX = "opencode server listening";
const OPENCODE_START_TIMEOUT_MS = 30_000;
const OPEN_CODE_SLUG = /^(?<slug>\S+\/\S+)\s*$/u;

const OpenCodeModelMetadata = Schema.Struct({
  name: Schema.optional(Schema.String),
  variants: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({ disabled: Schema.optional(Schema.Boolean) })
    )
  ),
});
const decodeOpenCodeModelMetadata = Schema.decodeExit(
  Schema.fromJsonString(OpenCodeModelMetadata)
);

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

export const parseOpenCodeModels = (stdout: string): readonly AiModel[] => {
  const models: AiModel[] = [];
  const seen = new Set<string>();
  let currentSlug: string | undefined;
  const jsonLines: string[] = [];

  const flushModel = () => {
    if (currentSlug === undefined || jsonLines.length === 0) {
      currentSlug = undefined;
      jsonLines.length = 0;
      return;
    }
    const metadata = decodeOpenCodeModelMetadata(jsonLines.join("\n"));
    if (Exit.isSuccess(metadata) && !seen.has(currentSlug)) {
      seen.add(currentSlug);
      const variantIds = Object.entries(metadata.value.variants ?? {})
        .filter(([, variant]) => variant.disabled !== true)
        .map(([id]) => id);
      const [providerId = ""] = currentSlug.split("/", 1);
      const defaultVariant = inferOpenCodeDefaultVariant(
        providerId,
        variantIds
      );
      const reasoningOptions = variantIds.map((id) =>
        id === defaultVariant ? { id, isDefault: true } : { id }
      );
      models.push({
        id: currentSlug,
        isDefault: false,
        name: metadata.value.name?.trim() || currentSlug,
        reasoningOptions,
      });
    }
    currentSlug = undefined;
    jsonLines.length = 0;
  };

  for (const line of stdout.split(/\r?\n/gu)) {
    const match = line.trimStart().startsWith("{")
      ? null
      : OPEN_CODE_SLUG.exec(line);
    if (match?.groups?.["slug"] !== undefined) {
      flushModel();
      currentSlug = match.groups["slug"];
      continue;
    }

    if (currentSlug !== undefined) {
      jsonLines.push(line);
    }
  }
  flushModel();

  return models;
};

export const getOpenCodeStatus = Effect.fn("getOpenCodeStatus")(
  function* getOpenCodeStatus() {
    const version = yield* runProbeCommand("opencode", ["--version"]);
    if (version === undefined || version.exitCode !== 0) {
      return {
        authentication: "unknown",
        error: "OpenCode CLI is not installed or could not be started",
        installed: false,
        models: [],
        provider: "opencode",
      } satisfies AiProviderStatus;
    }

    const inventory = yield* Effect.scoped(
      Effect.gen(function* loadOpenCodeInventory() {
        const directory = yield* makeTemporaryDirectory("opencode");
        let result = yield* runProbeCommand(
          "opencode",
          ["models", "--verbose"],
          directory
        );
        if (result === undefined || result.exitCode !== 0) {
          yield* Effect.sleep(1000);
          result = yield* runProbeCommand(
            "opencode",
            ["models", "--verbose"],
            directory
          );
        }
        return result;
      })
    ).pipe(Effect.option, Effect.map(Option.getOrUndefined));
    const models =
      inventory?.exitCode === 0 ? parseOpenCodeModels(inventory.stdout) : [];
    const connectedProviderCount = new Set(
      models.map((model) => model.id.split("/", 1)[0])
    ).size;
    const cliVersion = parseCliVersion(`${version.stdout}\n${version.stderr}`);

    return {
      authLabel: models.length > 0 ? "opencode" : undefined,
      authentication: models.length > 0 ? "authenticated" : "unknown",
      installed: true,
      message:
        connectedProviderCount > 0
          ? `${connectedProviderCount} upstream provider${connectedProviderCount === 1 ? "" : "s"} connected through OpenCode.`
          : "OpenCode is available, but it did not report any connected upstream providers.",
      models,
      provider: "opencode",
      version: cliVersion,
    } satisfies AiProviderStatus;
  }
);

export const extractJsonObject = (raw: string): string => {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) {
    return trimmed;
  }

  let depth = 0;
  let escaping = false;
  let inString = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (character === "\\") {
        escaping = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return trimmed.slice(start);
};

interface OpenCodeServer {
  readonly child: ChildProcessWithoutNullStreams;
  readonly url: string;
}

const TcpAddress = Schema.Struct({ port: Schema.Finite });
const decodeTcpAddress = Schema.decodeUnknownOption(TcpAddress);

const findAvailablePort = Effect.callback<number, never>((resume) => {
  const server = createServer();
  let settled = false;
  const finish = (port: number) => {
    if (settled) {
      return;
    }
    settled = true;
    resume(Effect.succeed(port));
  };

  server.once("error", () => finish(0));
  server.listen(0, "127.0.0.1", () => {
    const address = decodeTcpAddress(server.address());
    const port = address._tag === "Some" ? address.value.port : 0;
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    server.close(() => finish(port));
  });

  return Effect.sync(() => {
    if (!settled) {
      server.close();
    }
  });
});

const startOpenCodeServer = Effect.fn("startOpenCodeServer")(
  function* startOpenCodeServer(cwd: string) {
    const port = yield* findAvailablePort;
    if (port === 0) {
      return yield* providerFailure("opencode", "Could not start OpenCode");
    }
    const processEnvironment = yield* aiProcessEnvironment;
    const environment = {
      ...processEnvironment,
      OPENCODE_CONFIG_CONTENT: "{}",
    };
    const resolved = resolveAiSpawnCommand(
      "opencode",
      ["serve", "--pure", "--hostname=127.0.0.1", `--port=${port}`],
      environment
    );

    return yield* Effect.callback<OpenCodeServer, AiProviderError>((resume) => {
      const child = spawn(resolved.command, resolved.args, {
        cwd,
        env: environment,
        shell: resolved.shell,
        stdio: "pipe",
        windowsHide: true,
      });
      let output = "";
      let settled = false;

      const timeout = setTimeout(() => {
        terminateAiProcess(child);
        if (!settled) {
          settled = true;
          resume(
            Effect.fail(
              providerFailure("opencode", "OpenCode startup timed out")
            )
          );
        }
      }, OPENCODE_START_TIMEOUT_MS);
      timeout.unref();

      const finish = (
        effect: Effect.Effect<OpenCodeServer, AiProviderError>
      ) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resume(effect);
      };

      child.stderr.resume();
      child.stdout.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
        if (output.includes(OPENCODE_SERVER_READY_PREFIX)) {
          finish(Effect.succeed({ child, url: `http://127.0.0.1:${port}` }));
        } else if (output.length > 64_000) {
          terminateAiProcess(child);
          finish(
            Effect.fail(providerFailure("opencode", "OpenCode startup failed"))
          );
        }
      });
      child.once("error", () =>
        finish(
          Effect.fail(
            providerFailure(
              "opencode",
              "OpenCode CLI is not installed or is not on PATH"
            )
          )
        )
      );
      child.once("close", () =>
        finish(
          Effect.fail(providerFailure("opencode", "OpenCode startup failed"))
        )
      );

      return Effect.sync(() => {
        clearTimeout(timeout);
        terminateAiProcess(child);
      });
    });
  }
);

const parseOpenCodeModel = (model: string) => {
  const separator = model.indexOf("/");
  return separator <= 0 || separator === model.length - 1
    ? undefined
    : {
        modelID: model.slice(separator + 1),
        providerID: model.slice(0, separator),
      };
};

const OpenCodeTextPart = Schema.Struct({
  text: Schema.String,
  type: Schema.Literal("text"),
});
const decodeOpenCodeTextPart = Schema.decodeUnknownOption(OpenCodeTextPart);

export const getOpenCodeReasoningInput = (
  reasoning?: string
): { readonly variant?: string } =>
  reasoning === undefined ? {} : { variant: reasoning };

export const generateWithOpenCode = Effect.fn("generateWithOpenCode")(
  function* generateWithOpenCode<S extends Schema.Top>(
    input: StructuredGenerationInput<S>
  ): StructuredGenerationResult<S> {
    const model = parseOpenCodeModel(input.model);
    if (model === undefined) {
      return yield* providerFailure(
        "opencode",
        "OpenCode models must use the provider/model format"
      );
    }
    const directory = yield* makeTemporaryDirectory("opencode");
    const server = yield* Effect.acquireRelease(
      startOpenCodeServer(directory),
      ({ child }) => Effect.sync(() => terminateAiProcess(child))
    );
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory,
      throwOnError: true,
    });
    const session = yield* Effect.tryPromise({
      catch: () =>
        providerFailure("opencode", "OpenCode could not create a session"),
      try: () =>
        client.session.create({
          permission: [{ action: "deny", pattern: "*", permission: "*" }],
          title: "Kisa email writing",
        }),
    });
    if (session.data === undefined) {
      return yield* providerFailure(
        "opencode",
        "OpenCode could not create a session"
      );
    }
    const sessionId = session.data.id;
    const schemaInstruction = `Return only JSON matching this schema:\n${JSON.stringify(
      toJsonSchemaObject(input.outputSchema)
    )}`;
    const result = yield* Effect.tryPromise({
      catch: () =>
        providerFailure("opencode", "OpenCode could not generate email text"),
      try: () =>
        client.session.prompt({
          model,
          parts: [
            {
              text: `${input.userPrompt}\n\n${schemaInstruction}`,
              type: "text",
            },
          ],
          sessionID: sessionId,
          system: input.systemPrompt,
          tools: {},
          ...getOpenCodeReasoningInput(input.reasoning),
        }),
    }).pipe(
      Effect.ensuring(
        Effect.tryPromise(() =>
          client.session.delete({ sessionID: sessionId })
        ).pipe(Effect.timeoutOption(5000), Effect.ignore)
      ),
      Effect.timeoutOrElse({
        duration: GENERATION_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            providerFailure("opencode", "OpenCode AI request timed out")
          ),
      })
    );
    const text = (result.data?.parts ?? [])
      .flatMap((part) => {
        const decoded = decodeOpenCodeTextPart(part);
        return decoded._tag === "Some" ? [decoded.value.text] : [];
      })
      .join("")
      .trim();
    if (text.length === 0) {
      return yield* providerFailure(
        "opencode",
        "OpenCode returned no email text"
      );
    }
    return yield* decodeGeneratedJson(
      "opencode",
      input.outputSchema,
      extractJsonObject(text)
    );
  }
);
