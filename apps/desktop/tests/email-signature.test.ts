import { describe, expect, it } from "vitest";

import {
  appendEmailSignatureBody,
  createEmailSignatureBody,
  normalizeEmailSignature,
  removeEmailSignature,
} from "../src/shared/email-signature";

describe("email signatures", () => {
  it("normalizes line endings and treats textless rich content as empty", () => {
    expect(
      normalizeEmailSignature({
        html: " <p>Best,<br>Davut</p> ",
        text: "Best,\r\nDavut",
      })
    ).toStrictEqual({
      html: "<p>Best,<br>Davut</p>",
      text: "Best,\nDavut",
    });
    expect(
      normalizeEmailSignature({ html: "<p></p>", text: "\n" })
    ).toStrictEqual({ html: "", text: "" });
  });

  it("adds equivalent rich HTML and plain-text alternatives", () => {
    const signature = createEmailSignatureBody({
      html: '<p><strong>Best,</strong><br><a href="https://example.com">Davut</a></p>',
      text: "Best,\nDavut",
    });
    if (signature === undefined) {
      throw new Error("Expected a signature body");
    }
    expect(
      appendEmailSignatureBody(
        { html: "<p>Hello</p>", text: "Hello" },
        signature
      )
    ).toStrictEqual({
      html: `<p>Hello</p><p></p>${signature.html}`,
      text: "Hello\n\nBest,\nDavut",
    });
  });

  it("leaves mail unchanged when the setting is blank", () => {
    expect(
      createEmailSignatureBody({ html: "<p></p>", text: " \n " })
    ).toBeUndefined();
  });

  it("removes only the exact rich suffix", () => {
    const signature = {
      html: "<p><strong>Best,</strong><br>Davut</p>",
      text: "Best,\nDavut",
    };
    const signed = appendEmailSignatureBody(
      { html: "<p>Hello</p>", text: "Hello" },
      signature
    );

    expect(removeEmailSignature(signed, signature)).toStrictEqual({
      html: "<p>Hello</p>",
      text: "Hello",
    });
    expect(
      removeEmailSignature(
        { html: `${signed.html}!`, text: `${signed.text}!` },
        signature
      )
    ).toStrictEqual({ html: `${signed.html}!`, text: `${signed.text}!` });
  });
});
