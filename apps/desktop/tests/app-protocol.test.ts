import { describe, expect, it } from "vitest";

import {
  findAppProtocolUrl,
  GOOGLE_AUTH_CALLBACK_URL,
  parseGoogleAuthCallback,
} from "../src/shared/app-protocol";

describe(parseGoogleAuthCallback, () => {
  it("parses a successful Google callback", () => {
    expect(
      parseGoogleAuthCallback(
        `${GOOGLE_AUTH_CALLBACK_URL}?code=handoff-code&attempt=pkce-challenge`
      )
    ).toStrictEqual({ attempt: "pkce-challenge", code: "handoff-code" });
  });

  it("parses an OAuth error callback", () => {
    expect(
      parseGoogleAuthCallback(
        `${GOOGLE_AUTH_CALLBACK_URL}?error=access_denied&attempt=pkce-challenge`
      )
    ).toStrictEqual({ attempt: "pkce-challenge", error: "access_denied" });
  });

  it("rejects unrelated and incomplete URLs", () => {
    expect(parseGoogleAuthCallback("https://example.com")).toBeUndefined();
    expect(
      parseGoogleAuthCallback("kisa://oauth/google/callback")
    ).toBeUndefined();
    expect(
      parseGoogleAuthCallback(`${GOOGLE_AUTH_CALLBACK_URL}?code=handoff-code`)
    ).toBeUndefined();
    expect(parseGoogleAuthCallback("kisa://settings")).toBeUndefined();
    expect(parseGoogleAuthCallback("not a url")).toBeUndefined();
  });
});

describe(findAppProtocolUrl, () => {
  it("finds a kisa URL in process arguments", () => {
    expect(
      findAppProtocolUrl([
        "/Applications/Kisa.app/Contents/MacOS/Kisa",
        `${GOOGLE_AUTH_CALLBACK_URL}?code=handoff-code`,
      ])
    ).toBe(`${GOOGLE_AUTH_CALLBACK_URL}?code=handoff-code`);
  });

  it("ignores unrelated process arguments", () => {
    expect(findAppProtocolUrl(["--inspect", "file.txt"])).toBeUndefined();
  });
});
