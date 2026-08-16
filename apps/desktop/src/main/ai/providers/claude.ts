import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { DEFAULT_AI_PROVIDER_MODELS } from "../../../shared/ipc/ai";
import type {
  AiAuthenticationStatus,
  AiModel,
  AiReasoningOption,
  AiProviderStatus,
} from "../../../shared/ipc/ai";
import {
  aiProcessEnvironment,
  resolveAiExecutablePath,
  runAiCommand,
} from "../process";
import {
  commandFailure,
  GENERATION_TIMEOUT_MS,
  makeTemporaryDirectory,
  parseCliVersion,
  providerFailure,
  PROVIDER_PROBE_TIMEOUT_MS,
  runProbeCommand,
  toJsonSchemaObject,
} from "./shared";
import type {
  StructuredGenerationInput,
  StructuredGenerationResult,
} from "./shared";

const claudeReasoningOptions = (
  values: readonly string[],
  defaultValue?: string
): AiReasoningOption[] =>
  values.map((id) => (id === defaultValue ? { id, isDefault: true } : { id }));

const CLAUDE_EFFORTS = ["low", "medium", "high", "max"] as const;
const CLAUDE_XHIGH_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

const claudeModel = (
  id: string,
  name: string,
  efforts: readonly string[],
  defaultEffort?: string
): AiModel => ({
  id,
  isDefault: id === DEFAULT_AI_PROVIDER_MODELS.claude,
  name,
  reasoningOptions: claudeReasoningOptions(efforts, defaultEffort),
});

export const CLAUDE_MODELS: readonly AiModel[] = [
  claudeModel("claude-fable-5", "Fable 5", CLAUDE_XHIGH_EFFORTS, "high"),
  claudeModel("claude-opus-5", "Opus 5", CLAUDE_XHIGH_EFFORTS, "high"),
  claudeModel("claude-sonnet-5", "Sonnet 5", CLAUDE_XHIGH_EFFORTS, "high"),
  claudeModel("claude-opus-4-8", "Opus 4.8", CLAUDE_XHIGH_EFFORTS, "high"),
  claudeModel("claude-opus-4-7", "Opus 4.7", CLAUDE_XHIGH_EFFORTS, "xhigh"),
  claudeModel("claude-opus-4-6", "Opus 4.6", CLAUDE_EFFORTS, "high"),
  claudeModel("claude-opus-4-5", "Opus 4.5", CLAUDE_EFFORTS, "high"),
  claudeModel("claude-sonnet-4-6", "Sonnet 4.6", CLAUDE_EFFORTS, "high"),
  claudeModel("claude-haiku-4-5", "Haiku 4.5", []),
];

const waitForAbortSignal = (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return Promise.resolve();
  }
  // oxlint-disable-next-line promise/avoid-new
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
};

const makeAbortController = (): AbortController => new AbortController();

interface ClaudeAccountProbe {
  readonly apiProvider?: string;
  readonly email?: string;
  readonly subscriptionType?: string;
  readonly tokenSource?: string;
}

const probeClaudeAccount = Effect.fn("probeClaudeAccount")(
  function* probeClaudeAccount() {
    const environment = yield* aiProcessEnvironment;
    const executablePath = resolveAiExecutablePath("claude", environment);
    if (executablePath === undefined) {
      return;
    }
    const effectSignal = yield* Effect.abortSignal;
    const abortController = makeAbortController();
    const abortProbe = () => abortController.abort();
    effectSignal.addEventListener("abort", abortProbe, { once: true });
    return yield* Effect.tryPromise(async () => {
      const probe = claudeQuery({
        options: {
          abortController,
          allowedTools: [],
          env: {
            ...environment,
            ENABLE_CLAUDEAI_MCP_SERVERS: "false",
          },
          mcpServers: {},
          pathToClaudeCodeExecutable: executablePath,
          persistSession: false,
          settingSources: ["user", "project", "local"],
          stderr: () => {
            // Provider diagnostics can contain private local information.
          },
          strictMcpConfig: true,
        },
        // Never yield because this probe only needs initialization data.
        // oxlint-disable-next-line require-yield
        prompt: (async function* prompt(): AsyncGenerator<never> {
          await waitForAbortSignal(abortController.signal);
        })(),
      });
      const initialized = await probe.initializationResult();
      return initialized.account satisfies ClaudeAccountProbe;
    }).pipe(
      Effect.timeoutOption(PROVIDER_PROBE_TIMEOUT_MS),
      Effect.option,
      Effect.map(Option.flatten),
      Effect.map(Option.getOrUndefined),
      Effect.ensuring(
        Effect.sync(() => {
          effectSignal.removeEventListener("abort", abortProbe);
          abortController.abort();
        })
      )
    );
  }
);

const claudeSubscriptionLabel = (
  subscriptionType: string | undefined
): string | undefined => {
  const normalized = subscriptionType
    ?.toLowerCase()
    .replaceAll(/[\s_-]+/gu, "");
  const labels = {
    claudeenterprisesubscription: "Claude Enterprise Subscription",
    claudefreesubscription: "Claude Free Subscription",
    claudemax20xsubscription: "Claude Max 20x Subscription",
    claudemax5xsubscription: "Claude Max 5x Subscription",
    claudemaxsubscription: "Claude Max Subscription",
    claudeprosubscription: "Claude Pro Subscription",
    claudeteamsubscription: "Claude Team Subscription",
    enterprise: "Claude Enterprise Subscription",
    free: "Claude Free Subscription",
    max: "Claude Max Subscription",
    max20: "Claude Max 20x Subscription",
    max5: "Claude Max 5x Subscription",
    pro: "Claude Pro Subscription",
    team: "Claude Team Subscription",
  } satisfies Readonly<Record<string, string>>;
  return normalized === undefined ? undefined : labels[normalized];
};

const claudeAuthLabel = (account: ClaudeAccountProbe): string | undefined => {
  const tokenSource = account.tokenSource
    ?.toLowerCase()
    .replaceAll(/[\s_-]+/gu, "");
  if (
    tokenSource === "apikey" ||
    tokenSource === "anthropicapikey" ||
    tokenSource === "anthropicauthtoken"
  ) {
    return "Claude API Key";
  }
  if (account.apiProvider === "bedrock") {
    return "Amazon Bedrock";
  }
  return claudeSubscriptionLabel(account.subscriptionType);
};

export const getClaudeStatus = Effect.fn("getClaudeStatus")(
  function* getClaudeStatus() {
    const version = yield* runProbeCommand("claude", ["--version"]);
    if (version === undefined || version.exitCode !== 0) {
      return {
        authentication: "unknown",
        error: "Claude Code CLI is not installed or could not be started",
        installed: false,
        models: [],
        provider: "claude",
      } satisfies AiProviderStatus;
    }

    const account = yield* probeClaudeAccount();
    const authentication: AiAuthenticationStatus =
      account === undefined ? "unknown" : "authenticated";
    const cliVersion = parseCliVersion(`${version.stdout}\n${version.stderr}`);

    return {
      authEmail: account?.email,
      authLabel: account === undefined ? undefined : claudeAuthLabel(account),
      authentication,
      installed: true,
      models: CLAUDE_MODELS,
      provider: "claude",
      version: cliVersion,
    } satisfies AiProviderStatus;
  }
);

const ClaudeOutputEnvelope = Schema.Struct({
  structured_output: Schema.Unknown,
});

const normalizeClaudeReasoning = (
  reasoning: string,
  model: string | undefined
): string => {
  if (
    reasoning === "xhigh" &&
    model !== "claude-fable-5" &&
    model !== "claude-opus-5" &&
    model !== "claude-opus-4-8" &&
    model !== "claude-sonnet-5"
  ) {
    return "max";
  }
  if (reasoning === "max" && model === "claude-sonnet-4-6") {
    return "high";
  }
  return reasoning;
};

export const getClaudeReasoningArgs = (
  reasoning?: string,
  model?: string
): readonly string[] =>
  reasoning === undefined
    ? []
    : ["--effort", normalizeClaudeReasoning(reasoning, model)];

export const generateWithClaude = Effect.fn("generateWithClaude")(
  function* generateWithClaude<S extends Schema.Top>(
    input: StructuredGenerationInput<S>
  ): StructuredGenerationResult<S> {
    const directory = yield* makeTemporaryDirectory("claude");
    const result = yield* runAiCommand({
      args: [
        "--print",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(toJsonSchemaObject(input.outputSchema)),
        "--model",
        input.model,
        ...getClaudeReasoningArgs(input.reasoning, input.model),
        "--no-session-persistence",
        "--safe-mode",
        "--strict-mcp-config",
        "--mcp-config",
        "{}",
        "--tools",
        "",
        "--permission-mode",
        "plan",
        "--system-prompt",
        input.systemPrompt,
      ],
      command: "claude",
      cwd: directory,
      stdin: input.userPrompt,
      timeoutMs: GENERATION_TIMEOUT_MS,
    }).pipe(Effect.mapError((error) => commandFailure("claude", error)));
    if (result.exitCode !== 0) {
      return yield* providerFailure(
        "claude",
        "Claude could not generate email text. Check its login and model settings"
      );
    }
    const envelope = yield* Schema.decodeEffect(
      Schema.fromJsonString(ClaudeOutputEnvelope)
    )(result.stdout).pipe(
      Effect.mapError(() =>
        providerFailure("claude", "Claude returned an invalid response")
      )
    );
    return yield* Schema.decodeUnknownEffect(input.outputSchema)(
      envelope.structured_output
    ).pipe(
      Effect.mapError(() =>
        providerFailure("claude", "Claude returned an invalid response")
      )
    );
  }
);
