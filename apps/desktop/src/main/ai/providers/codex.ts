import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { version as appVersion } from "../../../../package.json";
import type {
  AiAuthenticationStatus,
  AiModel,
  AiProviderStatus,
  AiReasoningOption,
} from "../../../shared/ipc/ai";
import { logDevelopmentAiCommandExit } from "../development-logging";
import {
  aiProcessEnvironment,
  resolveAiSpawnCommand,
  runAiCommand,
  terminateAiProcess,
} from "../process";
import {
  commandFailure,
  decodeGeneratedJson,
  GENERATION_TIMEOUT_MS,
  makeTemporaryDirectory,
  parseCliVersion,
  providerFailure,
  PROVIDER_PROBE_TIMEOUT_MS,
  toJsonSchemaObject,
} from "./shared";
import type {
  StructuredGenerationInput,
  StructuredGenerationResult,
} from "./shared";

const CodexRpcPayload = Schema.Record(Schema.String, Schema.Unknown);
type CodexRpcPayload = typeof CodexRpcPayload.Type;

const CodexRpcMessage = Schema.Union([
  Schema.Struct({ id: Schema.Finite, result: CodexRpcPayload }),
  Schema.Struct({
    error: Schema.Struct({ message: Schema.optional(Schema.String) }),
    id: Schema.Finite,
  }),
]);
const decodeCodexRpcMessage = Schema.decodeExit(
  Schema.fromJsonString(CodexRpcMessage)
);

const CodexAccount = Schema.Union([
  Schema.Struct({ type: Schema.Literal("apiKey") }),
  Schema.Struct({ type: Schema.Literal("amazonBedrock") }),
  Schema.Struct({
    email: Schema.NullOr(Schema.String),
    planType: Schema.String,
    type: Schema.Literal("chatgpt"),
  }),
]);
const CodexAccountResponse = Schema.Struct({
  account: Schema.optional(Schema.NullOr(CodexAccount)),
  requiresOpenaiAuth: Schema.Boolean,
});
const decodeCodexAccountResponse =
  Schema.decodeUnknownExit(CodexAccountResponse);

const CodexInitializeResponse = Schema.Struct({
  userAgent: Schema.optional(Schema.String),
});
const decodeCodexInitializeResponse = Schema.decodeUnknownExit(
  CodexInitializeResponse
);

const CodexModelListResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      defaultReasoningEffort: Schema.optional(Schema.NonEmptyString),
      displayName: Schema.String,
      hidden: Schema.Boolean,
      isDefault: Schema.Boolean,
      model: Schema.NonEmptyString,
      supportedReasoningEfforts: Schema.optional(
        Schema.Array(
          Schema.Struct({
            description: Schema.String,
            reasoningEffort: Schema.NonEmptyString,
          })
        )
      ),
    })
  ),
  nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeCodexModelListResponse = Schema.decodeUnknownExit(
  CodexModelListResponse
);

interface CodexProbe {
  readonly authentication: AiAuthenticationStatus;
  readonly authEmail?: string;
  readonly authLabel?: string;
  readonly models: readonly AiModel[];
  readonly version?: string;
}

export const mapCodexReasoningOptions = (
  supportedReasoningEfforts: readonly {
    readonly description: string;
    readonly reasoningEffort: string;
  }[],
  defaultReasoningEffort?: string
): readonly AiReasoningOption[] =>
  supportedReasoningEfforts.map((option) =>
    option.reasoningEffort === defaultReasoningEffort
      ? {
          description: option.description,
          id: option.reasoningEffort,
          isDefault: true,
        }
      : {
          description: option.description,
          id: option.reasoningEffort,
        }
  );

const codexAuthLabel = (
  account: typeof CodexAccount.Type | null | undefined
): string | undefined => {
  if (account?.type === "apiKey") {
    return "OpenAI API Key";
  }
  if (account?.type === "amazonBedrock") {
    return "Amazon Bedrock";
  }
  if (account?.type !== "chatgpt") {
    return undefined;
  }
  const labels = {
    business: "ChatGPT Business Subscription",
    edu: "ChatGPT Edu Subscription",
    edu_plus: "ChatGPT Edu Subscription",
    edu_pro: "ChatGPT Edu Subscription",
    ent26: "ChatGPT Enterprise Subscription",
    enterprise: "ChatGPT Enterprise Subscription",
    enterprise_cbp_automation: "ChatGPT Enterprise Subscription",
    enterprise_cbp_usage_based: "ChatGPT Enterprise Subscription",
    free: "ChatGPT Free Subscription",
    go: "ChatGPT Go Subscription",
    plus: "ChatGPT Plus Subscription",
    pro: "ChatGPT Pro 20x Subscription",
    prolite: "ChatGPT Pro 5x Subscription",
    self_serve_business_prolite: "ChatGPT Business Subscription",
    self_serve_business_usage_based: "ChatGPT Business Subscription",
    team: "ChatGPT Team Subscription",
    unknown: "ChatGPT Subscription",
  } satisfies Readonly<Record<string, string>>;
  return labels[account.planType] ?? "ChatGPT Subscription";
};

type CodexRpcParams =
  | {
      readonly capabilities: { readonly experimentalApi: boolean };
      readonly clientInfo: {
        readonly name: string;
        readonly title: string;
        readonly version: string;
      };
    }
  | { readonly cursor?: string };

const probeCodex = Effect.fn("probeCodex")(function* probeCodex() {
  const environment = yield* aiProcessEnvironment;
  return yield* Effect.callback<CodexProbe, never>((resume) => {
    const resolved = resolveAiSpawnCommand(
      "codex",
      ["app-server"],
      environment
    );
    const child = spawn(resolved.command, resolved.args, {
      env: environment,
      shell: resolved.shell,
      stdio: "pipe",
      windowsHide: true,
    });
    const pending = new Map<
      number,
      {
        readonly reject: () => void;
        readonly resolve: (result: CodexRpcPayload) => void;
      }
    >();
    let buffer = "";
    let nextId = 1;
    let settled = false;

    const rejectPendingRequests = () => {
      for (const waiter of pending.values()) {
        waiter.reject();
      }
      pending.clear();
    };
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectPendingRequests();
        terminateAiProcess(child);
        resume(Effect.succeed({ authentication: "unknown", models: [] }));
      }
    }, PROVIDER_PROBE_TIMEOUT_MS);
    timeout.unref();

    const finish = (result: CodexProbe) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      rejectPendingRequests();
      terminateAiProcess(child);
      resume(Effect.succeed(result));
    };
    const fail = () => finish({ authentication: "unknown", models: [] });
    const request = (
      method: string,
      params: CodexRpcParams
    ): Promise<CodexRpcPayload> => {
      const id = nextId;
      nextId += 1;
      // oxlint-disable promise/avoid-new, promise/prefer-await-to-callbacks
      return new Promise((resolve, reject) => {
        pending.set(id, {
          reject: () => reject(new Error("request failed")),
          resolve,
        });
        child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
      });
    };
    const handleLine = (line: string) => {
      const decoded = decodeCodexRpcMessage(line);
      if (Exit.isFailure(decoded)) {
        return;
      }
      const waiter = pending.get(decoded.value.id);
      if (waiter === undefined) {
        return;
      }
      pending.delete(decoded.value.id);
      if ("error" in decoded.value) {
        waiter.reject();
      } else {
        waiter.resolve(decoded.value.result);
      }
    };

    child.stderr.resume();
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) {
        fail();
        return;
      }
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    });
    child.once("error", fail);
    child.once("close", fail);

    void (async () => {
      try {
        const initialized = decodeCodexInitializeResponse(
          await request("initialize", {
            capabilities: { experimentalApi: true },
            clientInfo: {
              name: "kisa_desktop",
              title: "Kisa Desktop",
              version: appVersion,
            },
          })
        );
        child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`);

        const version = Exit.isSuccess(initialized)
          ? parseCliVersion(initialized.value.userAgent ?? "")
          : undefined;

        const accountResult = decodeCodexAccountResponse(
          await request("account/read", {})
        );
        if (Exit.isFailure(accountResult)) {
          fail();
          return;
        }
        let authentication: AiAuthenticationStatus = "unknown";
        if (accountResult.value.account) {
          authentication = "authenticated";
        } else if (accountResult.value.requiresOpenaiAuth) {
          authentication = "unauthenticated";
        }
        if (authentication === "unauthenticated") {
          finish({
            authentication,
            models: [],
            version,
          });
          return;
        }

        const models: AiModel[] = [];
        let cursor: string | null | undefined;
        do {
          const page = decodeCodexModelListResponse(
            // Cursor pages must be fetched in order.
            // oxlint-disable-next-line eslint/no-await-in-loop
            await request("model/list", cursor ? { cursor } : {})
          );
          if (Exit.isFailure(page)) {
            fail();
            return;
          }
          models.push(
            ...page.value.data
              .filter((model) => !model.hidden)
              .map((model) => ({
                id: model.model,
                isDefault: model.isDefault,
                name: model.displayName,
                reasoningOptions: mapCodexReasoningOptions(
                  model.supportedReasoningEfforts ?? [],
                  model.defaultReasoningEffort
                ),
              }))
          );
          cursor = page.value.nextCursor;
        } while (cursor);

        const { account } = accountResult.value;
        const authLabel = codexAuthLabel(account);
        finish({
          authEmail:
            account?.type === "chatgpt" && account.email
              ? account.email
              : undefined,
          authLabel,
          authentication,
          models,
          version,
        });
      } catch {
        fail();
      }
    })();

    return Effect.sync(() => {
      clearTimeout(timeout);
      rejectPendingRequests();
      terminateAiProcess(child);
    });
  });
});

export const getCodexStatus = Effect.fn("getCodexStatus")(
  function* getCodexStatus() {
    const probe = yield* probeCodex();
    const unavailable =
      probe.authentication === "unknown" && probe.models.length === 0;
    return {
      authEmail: probe.authEmail,
      authLabel: probe.authLabel,
      authentication: probe.authentication,
      error: unavailable
        ? "Codex CLI is not installed or could not be started"
        : undefined,
      installed: !unavailable,
      models: probe.models,
      provider: "codex",
      version: probe.version,
    } satisfies AiProviderStatus;
  }
);

const makeFullPrompt = (systemPrompt: string, userPrompt: string): string =>
  ["SYSTEM INSTRUCTIONS", systemPrompt, "WRITING TASK", userPrompt].join(
    "\n\n"
  );

export const getCodexReasoningArgs = (reasoning?: string): readonly string[] =>
  reasoning === undefined
    ? []
    : ["--config", `model_reasoning_effort=${JSON.stringify(reasoning)}`];

export const generateWithCodex = Effect.fn("generateWithCodex")(
  function* generateWithCodex<S extends Schema.Top>(
    input: StructuredGenerationInput<S>
  ): StructuredGenerationResult<S> {
    const directory = yield* makeTemporaryDirectory("codex");
    const outputPath = path.join(directory, "output.json");
    const schemaPath = path.join(directory, "schema.json");
    yield* Effect.tryPromise({
      catch: () => providerFailure("codex", "Could not prepare the AI request"),
      try: () =>
        writeFile(
          schemaPath,
          JSON.stringify(toJsonSchemaObject(input.outputSchema)),
          "utf-8"
        ),
    });
    const result = yield* runAiCommand({
      args: [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--model",
        input.model,
        ...getCodexReasoningArgs(input.reasoning),
        "--output-schema",
        schemaPath,
        "--output-last-message",
        outputPath,
        "--color",
        "never",
        "-",
      ],
      command: "codex",
      cwd: directory,
      stdin: makeFullPrompt(input.systemPrompt, input.userPrompt),
      timeoutMs: GENERATION_TIMEOUT_MS,
    }).pipe(Effect.mapError((error) => commandFailure("codex", error)));
    if (result.exitCode !== 0) {
      logDevelopmentAiCommandExit({
        exitCode: result.exitCode,
        operation: "Codex generation",
        stderr: result.stderr,
      });
      return yield* providerFailure(
        "codex",
        "Codex could not generate email text. Check its login and model settings"
      );
    }
    const output = yield* Effect.tryPromise({
      catch: () => providerFailure("codex", "Codex returned no email text"),
      try: () => readFile(outputPath, "utf-8"),
    });
    return yield* decodeGeneratedJson("codex", input.outputSchema, output);
  }
);
