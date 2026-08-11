import { describe, expect, it } from "vitest";

import {
  applyComposerTemplate,
  createTemplateVariableContext,
} from "../src/renderer/src/templates/apply-composer-template";

describe(applyComposerTemplate, () => {
  it("fully replaces template-owned fields while preserving the current account and attachments", () => {
    const result = applyComposerTemplate(
      {
        accountId: "current@example.com",
        attachments: [
          {
            filename: "notes.txt",
            id: "attachment-1",
            mediaType: "text/plain",
            path: "/tmp/notes.txt",
            size: 12,
          },
        ],
        bcc: ["old-bcc@example.com"],
        body: { html: "<p>Old body</p>", text: "Old body" },
        cc: ["old-cc@example.com"],
        subject: "Old subject",
        to: ["old-to@example.com"],
      },
      {
        accountId: null,
        bcc: [],
        body: { html: "", text: "" },
        cc: [],
        id: "template-1",
        name: "Empty follow-up",
        subject: "",
        to: [],
      }
    );

    expect(result).toStrictEqual({
      accountId: "current@example.com",
      attachments: [
        {
          filename: "notes.txt",
          id: "attachment-1",
          mediaType: "text/plain",
          path: "/tmp/notes.txt",
          size: 12,
        },
      ],
      bcc: [],
      body: { html: "", text: "" },
      cc: [],
      subject: "",
      to: [],
    });
  });

  it("switches to the account stored by the template", () => {
    const result = applyComposerTemplate(
      {
        accountId: "current@example.com",
        attachments: [],
        bcc: [],
        body: { html: "", text: "" },
        cc: [],
        subject: "",
        to: [],
      },
      {
        accountId: "template@example.com",
        bcc: ["bcc@example.com"],
        body: { html: "<p>Hello</p>", text: "Hello" },
        cc: ["cc@example.com"],
        id: "template-1",
        name: "Introduction",
        subject: "Hello",
        to: ["friend@example.com"],
      }
    );

    expect(result.accountId).toBe("template@example.com");
  });

  it("builds variables from the final template account and sole To recipient", () => {
    expect(
      createTemplateVariableContext(
        "current@example.com",
        {
          accountId: null,
          bcc: [],
          body: { html: "", text: "" },
          cc: [],
          id: "template-1",
          name: "Introduction",
          subject: "",
          to: ["friend@example.com"],
        },
        123
      )
    ).toStrictEqual({
      accountEmail: "current@example.com",
      now: 123,
      toEmail: "friend@example.com",
    });
  });
});
