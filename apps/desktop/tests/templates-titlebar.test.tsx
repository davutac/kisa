import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TEMPLATE_EDITOR_FORM_ID } from "../src/renderer/src/routes/templates/-components/template-editor";
import { TemplatesTitlebarActions } from "../src/renderer/src/routes/templates/-components/templates-titlebar";

const noop = (): void => undefined;

const renderActions = (
  editor: {
    isCreating: boolean;
    isDirty: boolean;
    isSaving: boolean;
  } | null
): string =>
  renderToString(<TemplatesTitlebarActions editor={editor} onCreate={noop} />);

const getButton = (markup: string, text: string): string => {
  const button = markup
    .split("<button")
    .slice(1)
    .map((candidate) => candidate.split("</button>")[0] ?? "")
    .find((candidate) => candidate.includes(text));
  if (button === undefined) {
    throw new Error(`No button containing ${text}`);
  }
  return button;
};

describe(TemplatesTitlebarActions, () => {
  it("offers only New while no template is open", () => {
    const markup = renderActions(null);

    expect(markup).toContain('aria-label="New template"');
    expect(markup).not.toContain('type="submit"');
  });

  // The titlebar is a portal outside the editor's form, so Save reaches the
  // form only through its `form` attribute.
  it("submits the editor's form from outside it", () => {
    const save = getButton(
      renderActions({ isCreating: false, isDirty: true, isSaving: false }),
      "Save"
    );

    expect(save).toContain(`form="${TEMPLATE_EDITOR_FORM_ID}"`);
    expect(save).toContain('type="submit"');
    expect(save).not.toContain('disabled=""');
  });

  it("rests Save, with no status, while nothing has changed", () => {
    const markup = renderActions({
      isCreating: false,
      isDirty: false,
      isSaving: false,
    });

    expect(getButton(markup, "Save")).toContain('disabled=""');
    expect(markup).not.toContain("<output");
  });

  it("adds a new template", () => {
    const markup = renderActions({
      isCreating: true,
      isDirty: true,
      isSaving: false,
    });

    expect(getButton(markup, "Add")).toContain('type="submit"');
    expect(markup).not.toContain("Unsaved changes");
  });

  it("reports unsaved changes", () => {
    expect(
      renderActions({ isCreating: false, isDirty: true, isSaving: false })
    ).toContain("Unsaved changes");
  });

  it("holds Save while a save is in flight", () => {
    const markup = renderActions({
      isCreating: false,
      isDirty: true,
      isSaving: true,
    });

    expect(markup).toContain("Saving…");
    expect(getButton(markup, "Save")).toContain('disabled=""');
  });
});
