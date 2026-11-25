import { isProviderRequestError } from "@opencode/client";
import type { ProviderRequestError } from "@opencode/client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { connectOpenCode } from "./opencode-client";
import {
  decodeGeneratedJson,
  GENERATION_TIMEOUT_MS,
  providerFailure,
  toJsonSchemaObject,
} from "./shared";
import type {
  StructuredGenerationInput,
  StructuredGenerationResult,
} from "./shared";

export { getOpenCodeStatus } from "./opencode-catalog";

const OpenCodeGeneration = Schema.Struct({ text: Schema.String });

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

const describeRetryDelay = (milliseconds: number): string => {
  const minutes = Math.ceil(milliseconds / 60_000);
  if (minutes < 60) {
    return minutes <= 1 ? "a minute" : `${minutes} minutes`;
  }
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "an hour" : `${hours} hours`;
};

// The upstream message stays out: it is the provider's own text, may carry
// links or account details, and the typed reason already says what to do.
export const describeProviderRequestError = ({
  providerID,
  reason,
  retryAfterMs,
}: ProviderRequestError): string => {
  const source = `OpenCode (${providerID})`;
  switch (reason) {
    case "authentication": {
      return `${source} sign-in expired or was refused. Sign in again in OpenCode`;
    }
    case "rate_limit": {
      return retryAfterMs === undefined
        ? `${source} usage limit reached. Try again later`
        : `${source} usage limit reached. Try again in about ${describeRetryDelay(retryAfterMs)}`;
    }
    case "content_filter": {
      return `${source} refused this text`;
    }
    case "invalid_request": {
      return `${source} rejected the request. Check the model in AI settings`;
    }
    case "overloaded": {
      return `${source} is overloaded. Try again shortly`;
    }
    default: {
      return `${source} could not generate email text`;
    }
  }
};

export const generateWithOpenCode = Effect.fn("generateWithOpenCode")(
  function* generateWithOpenCode<S extends Schema.Top>(
    input: StructuredGenerationInput<S>
  ): StructuredGenerationResult<S> {
    const separator = input.model.indexOf("/");
    if (separator <= 0 || separator === input.model.length - 1) {
      return yield* providerFailure(
        "opencode",
        "OpenCode models must use the provider/model format"
      );
    }
    const client = yield* connectOpenCode();
    const result = yield* Effect.tryPromise({
      catch: (error) =>
        providerFailure(
          "opencode",
          isProviderRequestError(error)
            ? describeProviderRequestError(error)
            : "OpenCode could not generate email text"
        ),
      try: (signal) =>
        client.experimental.generate.text(
          {
            model: {
              id: input.model.slice(separator + 1),
              providerID: input.model.slice(0, separator),
              variant: input.reasoning,
            },
            prompt: `<system_instructions>\n${input.systemPrompt}\nReturn only JSON matching this schema:\n${JSON.stringify(toJsonSchemaObject(input.outputSchema))}\n</system_instructions>\n\n${input.userPrompt}`,
          },
          { signal }
        ),
    }).pipe(
      Effect.timeoutOrElse({
        duration: GENERATION_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(
            providerFailure("opencode", "OpenCode AI request timed out")
          ),
      })
    );
    const decoded = yield* Schema.decodeEffect(OpenCodeGeneration)(result).pipe(
      Effect.mapError(() =>
        providerFailure("opencode", "OpenCode returned an invalid response")
      )
    );
    const text = decoded.text.trim();
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
