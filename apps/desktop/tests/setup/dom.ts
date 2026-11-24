import { cleanup } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, vi } from "vitest";

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}
globalThis.__UI_SDK_STRICT__ = true;

// jsdom has some of these without the parts ui-sdk's popups and lists use, so
// they are assigned rather than filled in with `??=`.
const ignore = (): undefined => undefined;
const noRects: DOMRectList = Object.assign([] as DOMRect[], {
  item: (): DOMRect | null => null,
});

HTMLElement.prototype.showPopover = ignore;
HTMLElement.prototype.hidePopover = ignore;
Element.prototype.getAnimations = () => [];
Element.prototype.scrollIntoView = ignore;
Element.prototype.scrollTo = ignore;
Element.prototype.checkVisibility = () => true;
Element.prototype.getClientRects = () => noRects;
document.elementFromPoint = () => null;
document.elementsFromPoint = () => [];
globalThis.ResizeObserver ??= class {
  observe = ignore;
  unobserve = ignore;
  disconnect = ignore;
};
document.head.append(
  Object.assign(document.createElement("style"), {
    textContent: "[popover] { display: block !important }",
  })
);

// NumberFlow's element is an HTMLElement only in a browser build, which
// Vitest does not resolve, so jsdom gets the text it would show.
vi.mock("@number-flow/react", () => ({
  default: ({
    prefix = "",
    suffix = "",
    value,
  }: {
    readonly prefix?: string;
    readonly suffix?: string;
    readonly value: number;
  }) => createElement("span", null, `${prefix}${value}${suffix}`),
}));

afterEach(cleanup);
