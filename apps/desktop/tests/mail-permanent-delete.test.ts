import { describe, expect, it } from "vitest";

import { canDeleteThreadForever } from "../src/main/mail/mail-permanent-delete";

describe(canDeleteThreadForever, () => {
  it("allows only cached Spam or Trash conversations", () => {
    expect(canDeleteThreadForever()).toBeFalsy();
    expect(
      canDeleteThreadForever({ isInSpam: false, isInTrash: false })
    ).toBeFalsy();
    expect(
      canDeleteThreadForever({ isInSpam: true, isInTrash: false })
    ).toBeTruthy();
    expect(
      canDeleteThreadForever({ isInSpam: false, isInTrash: true })
    ).toBeTruthy();
  });
});
