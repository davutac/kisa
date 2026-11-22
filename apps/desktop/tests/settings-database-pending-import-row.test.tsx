import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SettingsDatabasePendingImportRow from "../src/renderer/src/routes/settings/-components/settings-database-pending-import-row";

const render = (
  props: Partial<Parameters<typeof SettingsDatabasePendingImportRow>[0]> = {}
): string =>
  renderToString(
    <SettingsDatabasePendingImportRow
      onDiscard={() => {}}
      onRestart={() => {}}
      pendingAction={undefined}
      restart="relaunch"
      {...props}
    />
  );

const disabledButtons = (html: string): number =>
  html.match(/\sdisabled=""/gu)?.length ?? 0;

describe("pending database import row", () => {
  it("says the current database is still in use and offers both ways out", () => {
    const html = render();

    expect(html).toContain("Imported database waiting");
    expect(html).toContain("Kisa is still using the current database.");
    expect(html).toContain("Discard import");
    expect(html).toContain("Restart now");
  });

  it("offers to quit where the app cannot start itself again", () => {
    const html = render({ restart: "quit" });

    expect(html).toContain("Quit now");
    expect(html).toContain("Quit and start Kisa again");
    expect(html).not.toContain("Restart now");
  });

  it("disables both actions while one is running", () => {
    expect(disabledButtons(render())).toBe(0);
    expect(disabledButtons(render({ pendingAction: "discard" }))).toBe(2);
  });
});
