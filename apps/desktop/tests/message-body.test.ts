import { describe, expect, it } from "vitest";

import { resizeEmailFrame } from "../src/renderer/src/components/mail/message-body";

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
