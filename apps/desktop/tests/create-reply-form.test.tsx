import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import CreateReplyForm from "../src/renderer/src/components/mail/reply-area/create-reply-form";
import { Popover } from "../src/renderer/src/components/ui/popover";

describe("create reply form", () => {
  it("offers bounded optional instructions", () => {
    const markup = renderToString(
      <Popover open>
        <CreateReplyForm
          onClose={() => null}
          onCreate={() => Promise.resolve()}
          textareaRef={createRef<HTMLTextAreaElement>()}
        />
      </Popover>
    );

    expect(markup).toContain('aria-label="Reply instructions"');
    expect(markup).toContain(
      "leave this blank to use the conversation context"
    );
    expect(markup).toContain('maxLength="4000"');
    expect(markup).toContain("max-h-[40dvh]");
    expect(markup).toContain("Say Tuesday works");
  });
});
