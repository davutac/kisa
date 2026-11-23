import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SettingsInlineImagesRow, {
  findInlineImageRetentionOption,
} from "../src/renderer/src/components/settings/settings-inline-images-row";
import { DEFAULT_APP_SETTINGS } from "../src/shared/ipc/app";
import type { InlineImageRetentionDays } from "../src/shared/ipc/app";

const PERIODS: readonly InlineImageRetentionDays[] = [30, 90, 365, null];

describe("the setting for images kept from opened emails", () => {
  it("names each period, with forever for no limit", () => {
    expect(
      PERIODS.map((days) => findInlineImageRetentionOption(days).label)
    ).toStrictEqual(["30 days", "90 days", "1 year", "Forever"]);
  });

  it("shows the default of 90 days", () => {
    const markup = renderToString(
      <SettingsInlineImagesRow
        appSettingsApi={{
          set: (settings) => Promise.resolve({ data: settings, ok: true }),
        }}
      />
    );

    expect(DEFAULT_APP_SETTINGS.inlineImageRetentionDays).toBe(90);
    expect(markup).toContain("Keep images from opened emails, 90 days");
  });
});
