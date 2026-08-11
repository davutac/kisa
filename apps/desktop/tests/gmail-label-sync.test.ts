import type { gmail_v1 } from "@googleapis/gmail";
import { LabelColor } from "@repo/gmail/models";
import { describe, expect, it, vi } from "vitest";

import {
  hydrateUserLabelDetails,
  toGmailLabel,
} from "../src/main/mail/gmail-gateway";

describe("Gmail label sync", () => {
  it("loads full user-label details and maps Gmail colors", async () => {
    const listed: readonly gmail_v1.Schema$Label[] = [
      { id: "INBOX", name: "INBOX", type: "system" },
      { id: "Label_1", name: "Receipts", type: "user" },
      { id: "Label_2", name: "Travel", type: "user" },
    ];
    const load = vi.fn<(labelId: string) => Promise<gmail_v1.Schema$Label>>(
      (labelId) =>
        Promise.resolve({
          color:
            labelId === "Label_1"
              ? { backgroundColor: "#16a766", textColor: "#ffffff" }
              : undefined,
          id: labelId,
        })
    );

    const hydrated = await hydrateUserLabelDetails(listed, load);
    const labels = hydrated.flatMap((label) => {
      const mapped = toGmailLabel(label);
      return mapped === undefined ? [] : [mapped];
    });

    expect({
      calls: load.mock.calls,
      colors: labels.map((label) => label.color),
    }).toStrictEqual({
      calls: [["Label_1"], ["Label_2"]],
      colors: [
        undefined,
        new LabelColor({ background: "#16a766", text: "#ffffff" }),
        undefined,
      ],
    });
  });

  it("does not keep a partial color pair", () => {
    expect(
      toGmailLabel({
        color: { backgroundColor: "#16a766" },
        id: "Label_1",
        name: "Receipts",
        type: "user",
      })?.color
    ).toBeUndefined();
  });
});
