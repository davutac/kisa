import { describe, expect, it } from "vitest";

import { canApplySenderTrust } from "@/shared/sender-trust";

describe(canApplySenderTrust, () => {
  it("applies to an authenticated sender outside Spam", () => {
    expect(
      canApplySenderTrust({ labelIds: ["INBOX"], senderAuthenticated: true })
    ).toBeTruthy();
  });

  it("never applies to an unauthenticated sender or in Spam", () => {
    expect(
      canApplySenderTrust({ labelIds: ["INBOX"], senderAuthenticated: false })
    ).toBeFalsy();
    expect(
      canApplySenderTrust({ labelIds: ["SPAM"], senderAuthenticated: true })
    ).toBeFalsy();
  });
});
