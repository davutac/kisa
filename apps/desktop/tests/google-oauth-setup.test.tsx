import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GoogleOAuthSetupSteps } from "../src/renderer/src/components/accounts/google-oauth-setup";
import LoginScreen from "../src/renderer/src/components/accounts/login-screen";

const renderLogin = (hasGoogleSetup: boolean) =>
  renderToString(
    <LoginScreen
      hasGoogleSetup={hasGoogleSetup}
      isSettingUp={false}
      isStarting={false}
      onLogin={() => null}
      onSetup={() => Promise.resolve(false)}
    />
  );

const getLoginButton = (markup: string): string => {
  const labelIndex = markup.indexOf("Login with Google");
  const buttonStart = markup.lastIndexOf("<button", labelIndex);
  return markup.slice(buttonStart, labelIndex);
};

describe("Google OAuth setup guide", () => {
  it("shows every required step without exposing credentials to the renderer", () => {
    const markup = renderToString(<GoogleOAuthSetupSteps />);
    const stepTitles = [
      "Create a project",
      "Enable the Gmail API",
      "Configure Google Auth",
      "Choose External",
      "Add the required scopes",
      "Create the Desktop client",
      "Download the JSON",
      "Publish the app",
    ];

    expect(
      [
        ...stepTitles,
        "In production",
        "userinfo.email",
        "userinfo.profile",
        "https://mail.google.com/",
        "Desktop app",
        "Download JSON",
        "Kisa has no servers",
        "never enter the page",
        "encrypts the OAuth client once",
      ].filter((text) => !markup.includes(text))
    ).toStrictEqual([]);
    const stepIndices = stepTitles.map((title) => markup.indexOf(title));
    expect(stepIndices).toStrictEqual(
      stepIndices.toSorted((left, right) => left - right)
    );
  });

  it("keeps Google login disabled until setup is complete", () => {
    const beforeSetup = renderLogin(false);
    const afterSetup = renderLogin(true);

    expect(beforeSetup).toContain("Setup Google");
    expect(getLoginButton(beforeSetup)).toContain('disabled=""');
    expect(getLoginButton(afterSetup)).not.toContain('disabled=""');
  });
});
