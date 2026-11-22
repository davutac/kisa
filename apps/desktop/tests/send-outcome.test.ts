import { describe, expect, it } from "vitest";

import { describeSendOutcome } from "../src/renderer/src/mail/send-outcome";

describe("send outcome notice", () => {
  it("confirms a send every recipient accepted", () => {
    expect(describeSendOutcome({ refusedRecipients: [] })).toStrictEqual({
      message: "Message sent",
      tone: "success",
    });
  });

  it("names the recipients a server refused without calling the send failed", () => {
    expect(
      describeSendOutcome({
        refusedRecipients: ["a@example.com", "b@example.com"],
      })
    ).toStrictEqual({
      message:
        "Message sent, but the server refused a@example.com, b@example.com",
      tone: "warning",
    });
  });
});
