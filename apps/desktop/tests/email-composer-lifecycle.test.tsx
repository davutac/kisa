import { readFile } from "node:fs/promises";

import * as TiptapReact from "@tiptap/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import EmailComposer from "../src/renderer/src/components/mail/email-composer";

const tiptap = {
  hasHandleDrop: false,
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
  tiptap.hasHandleDrop = options?.editorProps?.handleDrop !== undefined;
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

  it("extends the editable surface through the available body height", () => {
    const markup = renderToString(<EmailComposer />);

    expect(markup).toContain(
      'class="flex min-h-0 flex-1 flex-col overflow-y-auto"'
    );
    expect(
      vi.mocked(TiptapReact.useEditor).mock.lastCall?.[0]?.editorProps
        ?.attributes
    ).toMatchObject({ class: expect.stringContaining("flex-1") });
  });

  it("enables shared file drop handling when attachments are configured", () => {
    renderToString(
      <EmailComposer onComposerFiles={() => Promise.resolve([])} />
    );

    expect(tiptap.hasHandleDrop).toBeTruthy();
  });

  it("allows local blob previews through the renderer policy", async () => {
    const rendererHtml = await readFile(
      new URL("../src/renderer/index.html", import.meta.url),
      "utf-8"
    );

    expect(rendererHtml).toMatch(/img-src[^";]*\bblob:/u);
  });
});
