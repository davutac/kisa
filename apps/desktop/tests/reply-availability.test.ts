import { describe, expect, it } from "vitest";

import { canCreateAiReply } from "../src/renderer/src/components/mail/reply-area/use-reply-workspace";

const selection = {
  model: "gpt-5.6-luna",
  provider: "codex",
  reasoning: "low",
} as const;

describe("reply generation availability", () => {
  it("allows replacing an existing generated reply", () => {
    expect(canCreateAiReply(selection, "reply", false)).toBeTruthy();
  });

  it("is unavailable while reply work is busy", () => {
    expect(canCreateAiReply(selection, "reply", true)).toBeFalsy();
  });

  it("is unavailable for forwards", () => {
    expect(canCreateAiReply(selection, "forward", false)).toBeFalsy();
  });

  it("requires a selected AI model", () => {
    expect(canCreateAiReply(null, "reply", false)).toBeFalsy();
  });
});
