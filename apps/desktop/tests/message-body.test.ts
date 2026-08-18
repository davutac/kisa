import { describe, expect, it } from "vitest";

import {
  resizeEmailFrame,
  resolveMessageBodyCopyText,
} from "../src/renderer/src/components/mail/message-body";

describe("message body copy", () => {
  const frame = {
    contentDocument: { body: { innerText: "Rendered HTML message" } },
  };

  it("uses the plain-text MIME body when available", () => {
    expect(resolveMessageBodyCopyText("Plain message", frame, "Snippet")).toBe(
      "Plain message"
    );
  });

  it("copies rendered HTML text and falls back while the frame is unavailable", () => {
    expect(resolveMessageBodyCopyText(undefined, frame, "Snippet")).toBe(
      "Rendered HTML message"
    );
    expect(resolveMessageBodyCopyText(undefined, null, "Snippet")).toBe(
      "Snippet"
    );
  });
});

describe("email message body sizing", () => {
  it("shrinks the frame when reflow makes the message shorter", () => {
    const style = { height: "96px" };
    let contentHeight = 240;
    const viewportHeight = (): number =>
      Math.trunc(Number(style.height.slice(0, -2)));
    const frame = {
      contentDocument: {
        body: {
          get offsetHeight() {
            return contentHeight;
          },
          get scrollHeight() {
            return contentHeight;
          },
        },
        documentElement: {
          get offsetHeight() {
            return viewportHeight();
          },
          get scrollHeight() {
            return Math.max(viewportHeight(), contentHeight);
          },
        },
      },
      style,
    };

    resizeEmailFrame(frame);
    expect(style.height).toBe("241px");

    contentHeight = 120;
    resizeEmailFrame(frame);
    expect(style.height).toBe("121px");

    resizeEmailFrame(frame);
    expect(style.height).toBe("121px");
  });
});
