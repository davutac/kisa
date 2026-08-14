import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CleanDraftVersion } from "../src/renderer/src/components/mail/clean-draft-history";
import CleanDraftHistoryStrip from "../src/renderer/src/components/mail/clean-draft-history-strip";

const original: CleanDraftVersion = {
  body: "original",
  id: "original",
  label: "Original",
  status: "ready",
  subject: "original",
};

const clean = (status: CleanDraftVersion["status"]): CleanDraftVersion => ({
  body: status === "ready" ? "clean" : original.body,
  id: "clean-1-request",
  label: "#1 Clean",
  status,
  subject: status === "ready" ? "clean" : original.subject,
});

const renderHistory = ({
  selectedVersionId = "original",
  versions,
}: {
  selectedVersionId?: string | null;
  versions: readonly CleanDraftVersion[];
}): string =>
  renderToString(
    <CleanDraftHistoryStrip
      disabled={false}
      onDismiss={() => null}
      onSelect={() => null}
      selectedVersionId={selectedVersionId}
      versions={versions}
    />
  );

describe("clean draft history strip", () => {
  it("shows selectable versions after the first clean", () => {
    const markup = renderHistory({ versions: [original, clean("ready")] });

    expect(markup).toContain('aria-label="Draft history"');
    expect(markup).toContain('aria-label="Use Original draft"');
    expect(markup).toContain("#1 Clean");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("offers dismissal for cleans but not the original", () => {
    const version = clean("ready");
    const markup = renderHistory({
      selectedVersionId: version.id,
      versions: [original, version],
    });

    expect(markup).not.toContain('aria-label="Dismiss Original draft"');
    expect(markup).toContain('aria-label="Dismiss #1 Clean draft"');
  });

  it("renders pending versions as unselected and unavailable", () => {
    const version = clean("loading");
    const markup = renderHistory({ versions: [original, version] });
    const loadingButton = markup.match(
      /<button[^>]*aria-label="Use #1 Clean draft"[^>]*>/u
    )?.[0];

    expect(markup).toContain("#1 Cleaning…");
    expect(markup).toContain("animate-spin");
    expect(loadingButton).toContain(' disabled=""');
    expect(loadingButton).toContain('aria-pressed="false"');
  });

  it("stays hidden when only the original remains", () => {
    expect(renderHistory({ versions: [original] })).toBe("");
  });
});
