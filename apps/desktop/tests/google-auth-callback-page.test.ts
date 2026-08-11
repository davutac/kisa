import { describe, expect, it } from "vitest";

import { renderGoogleAuthCallbackPage } from "../src/main/auth/google-auth-callback-page";

describe("Google auth callback page", () => {
  it("renders the received handoff without overstating account connection", () => {
    const page = renderGoogleAuthCallbackPage();

    expect(page).toContain("<title>Return to Kisa · Kisa</title>");
    expect(page).toContain("Google sent you back safely");
    expect(page).not.toContain("Account connected");
  });

  it("renders a distinct cancellation state", () => {
    const page = renderGoogleAuthCallbackPage("access_denied");

    expect(page).toContain("<title>Sign-in canceled · Kisa</title>");
    expect(page).toContain("Nothing was changed");
  });

  it("renders other OAuth errors as failures", () => {
    const page = renderGoogleAuthCallbackPage("server_error");

    expect(page).toContain("<title>Sign-in failed · Kisa</title>");
    expect(page).toContain("try again in Kisa");
  });
});
