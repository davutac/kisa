import * as TiptapReact from "@tiptap/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import EmailComposer from "../src/renderer/src/components/mail/email-composer";

const tiptap = {
  hasOnCreate: false,
  hasOnUpdate: false,
  shouldRerenderOnTransaction: true,
};

vi.mock(import("@tiptap/react"), { spy: true });

vi.mock(import("@/components/mail/email-composer-toolbar"), () => ({
  default: () => null,
}));

// @ts-expect-error Tiptap's implementation returns null during initialization,
// but its final public overload incorrectly promises Editor unconditionally.
vi.mocked(TiptapReact.useEditor).mockImplementation((options) => {
  tiptap.hasOnCreate = options?.onCreate !== undefined;
  tiptap.hasOnUpdate = options?.onUpdate !== undefined;
  tiptap.shouldRerenderOnTransaction =
    options?.shouldRerenderOnTransaction ?? true;
  return null;
});

describe("email composer lifecycle", () => {
  it("reports document updates but not editor initialization as changes", () => {
    renderToString(<EmailComposer onChange={() => {}} />);

    expect(tiptap.hasOnCreate).toBeFalsy();
    expect(tiptap.hasOnUpdate).toBeTruthy();
    expect(tiptap.shouldRerenderOnTransaction).toBeFalsy();
  });
});
