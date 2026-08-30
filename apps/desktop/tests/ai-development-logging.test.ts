import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureDevelopmentAiLogging,
  logDevelopmentAiCommandExit,
  logDevelopmentAiError,
} from "../src/main/ai/development-logging";

describe("AI development logging", () => {
  afterEach(() => {
    configureDevelopmentAiLogging(false);
    vi.restoreAllMocks();
  });

  it("does not print errors when development logging is disabled", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    logDevelopmentAiError("Reply generation", new Error("Provider failed"));

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("prints structured provider errors without echoed prompt content", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    configureDevelopmentAiLogging(true);

    logDevelopmentAiCommandExit({
      exitCode: 1,
      operation: "Codex generation",
      stderr:
        'user\n{"code":"private","message":"private email content"}\nERROR: {"error":{"code":"invalid_json_schema","message":"allOf is not permitted","param":"text.format.schema"},"status":400}',
    });

    expect(consoleError).toHaveBeenCalledWith(
      "[Kisa AI] Codex generation exited",
      {
        error: {
          code: "invalid_json_schema",
          message: "allOf is not permitted",
          parameter: "text.format.schema",
          status: "400",
        },
        exitCode: 1,
      }
    );
  });
});
