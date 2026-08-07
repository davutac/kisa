import { describe, expect, it } from "vitest";

import { needsLightSurface } from "@/mail/email-surface";

describe(needsLightSurface, () => {
  it("lets a message without colours follow the app theme", () => {
    expect(
      needsLightSurface("<p>Sehr geehrter Herr Caliskan,</p><p>Viele Grüße</p>")
    ).toBeFalsy();
  });

  it("gives a light page to text coloured for one", () => {
    expect(
      needsLightSurface('<p style="color:#444">Mit freundlichen Grüßen</p>')
    ).toBeTruthy();
  });

  it("recognises colours in style blocks and old markup", () => {
    expect(
      needsLightSurface("<style>body { background-color: #fff; }</style>")
    ).toBeTruthy();
    expect(
      needsLightSurface('<table bgcolor="#ffffff"><tr></tr></table>')
    ).toBeTruthy();
    expect(
      needsLightSurface('<font color="#333">Signature</font>')
    ).toBeTruthy();
  });

  it("stays out of the way of a sender who styled both schemes", () => {
    expect(
      needsLightSurface(
        "<style>body { color: #111 }" +
          "@media (prefers-color-scheme: dark) { body { color: #eee } }</style>"
      )
    ).toBeFalsy();
  });
});
