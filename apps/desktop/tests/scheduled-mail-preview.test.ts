import { describe, expect, it } from "vitest";

import { truncateScheduledMailPreview } from "../src/main/mail/scheduled-mail-preview";
import { MAX_SCHEDULED_MAIL_PREVIEW_LENGTH } from "../src/shared/ipc/scheduled-mail";

describe("scheduled email preview", () => {
  it("bounds astral text in UTF-16 without splitting a surrogate pair", () => {
    const preview = truncateScheduledMailPreview("😀".repeat(240));

    expect(preview.length).toBeLessThanOrEqual(
      MAX_SCHEDULED_MAIL_PREVIEW_LENGTH
    );
    expect(preview).toBe("😀".repeat(120));
    expect(preview.at(-1)).not.toMatch(/[\uD800-\uDBFF]/u);
  });
});
