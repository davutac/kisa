import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GoogleOAuthSetupSteps } from "../src/renderer/src/components/accounts/google-oauth-setup";
import LoginScreen from "../src/renderer/src/components/accounts/login-screen";
import SettingsGoogleOAuthRow from "../src/renderer/src/routes/settings/-components/settings-google-oauth-row";

const renderLogin = (hasGoogleSetup: boolean) =>
  renderToString(
    <LoginScreen
      hasGoogleSetup={hasGoogleSetup}
      isSettingUp={false}
      isStarting={false}
      onAddOtherAccount={() => null}
      onLogin={() => null}
      onSetup={() => Promise.resolve(false)}
    />
  );

const getButton = (markup: string, label: string): string => {
  const labelIndex = markup.indexOf(label);
  const buttonStart = markup.lastIndexOf("<button", labelIndex);
  return markup.slice(buttonStart, labelIndex);
};

const getLoginButton = (markup: string): string =>
  getButton(markup, "Login with Google");

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

    expect(beforeSetup).toContain("Set up Google");
    expect(getLoginButton(beforeSetup)).toContain('disabled=""');
    expect(getLoginButton(afterSetup)).not.toContain('disabled=""');
  });

  it("offers iCloud and other accounts without Google setup", () => {
    const button = getButton(renderLogin(false), "Add iCloud or other account");

    expect(button).toContain("<button");
    expect(button).not.toContain('disabled=""');
  });

  it("provides credential replacement in authenticated settings", () => {
    const markup = renderToString(
      <SettingsGoogleOAuthRow
        authApi={{
          setupGoogleOAuthClient: () =>
            Promise.resolve({ data: false, ok: true }),
        }}
      />
    );
    expect(markup).toContain("Set up Google");
    expect(markup).toContain("Existing accounts keep");
    expect(markup).not.toContain('disabled=""');
  });
});
