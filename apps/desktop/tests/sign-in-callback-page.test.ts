import { describe, expect, it } from "vitest";

import { renderSignInCallbackPage } from "../src/main/auth/sign-in-callback-page";

describe(renderSignInCallbackPage, () => {
  it("says the browser's part is over without claiming the account was added", () => {
    const page = renderSignInCallbackPage();

    expect(page).toContain("<title>Return to Kisa · Kisa</title>");
    expect(page).toContain("continue in Kisa");
    expect(page).not.toMatch(/account (?:connected|added)/iu);
  });

  it("renders a distinct cancellation state", () => {
    const page = renderSignInCallbackPage("access_denied");

    expect(page).toContain("<title>Sign-in canceled · Kisa</title>");
    expect(page).toContain("Nothing was changed");
  });

  it("renders other errors as failures, never echoing what the redirect said", () => {
    const page = renderSignInCallbackPage("<script>alert(1)</script>");

    expect(page).toContain("<title>Sign-in failed · Kisa</title>");
    expect(page).toContain("try again in Kisa");
    expect(page).not.toContain("alert(1)");
  });
});
