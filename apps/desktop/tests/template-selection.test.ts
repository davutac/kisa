import { describe, expect, it } from "@effect/vitest";

import { getNextTemplateSelectionIndex } from "../src/renderer/src/routes/templates/-components/template-selection";

const templateIds = ["first", "second", "third"];

describe(getNextTemplateSelectionIndex, () => {
  it("starts at the edge matching the navigation direction", () => {
    expect(getNextTemplateSelectionIndex(templateIds, undefined, 1)).toBe(0);
    expect(getNextTemplateSelectionIndex(templateIds, undefined, -1)).toBe(2);
  });

  it("moves from the current template and stops at list edges", () => {
    expect(getNextTemplateSelectionIndex(templateIds, "second", 1)).toBe(2);
    expect(getNextTemplateSelectionIndex(templateIds, "second", -1)).toBe(0);
    expect(getNextTemplateSelectionIndex(templateIds, "first", -1)).toBe(0);
    expect(getNextTemplateSelectionIndex(templateIds, "third", 1)).toBe(2);
  });

  it("treats a template hidden by filtering like no selection", () => {
    expect(getNextTemplateSelectionIndex(templateIds, "hidden", 1)).toBe(0);
    expect(getNextTemplateSelectionIndex(templateIds, "hidden", -1)).toBe(2);
  });

  it("does not select anything from an empty result", () => {
    expect(getNextTemplateSelectionIndex([], undefined, 1)).toBeNull();
  });
});
