import { describe, expect, it } from "vitest";

import {
  createSignInAgainForm,
  findAccountSetupProblem,
  findSetupProblem,
  findSetupSignInSwitch,
  findSignInSwitch,
  getAccountSetupMode,
  INITIAL_ACCOUNT_SETUP_FORM,
  readSignInAgain,
  toAccountName,
  toAccountServers,
  toMicrosoftSignIn,
  toMicrosoftSubmission,
  toPasswordSubmission,
  withServerSecurity,
  withSignInMethod,
} from "../src/renderer/src/account-setup/account-setup-form";
import type { AccountSetupForm } from "../src/renderer/src/account-setup/account-setup-form";
import {
  findMailAccountPreset,
  MAX_DISPLAY_NAME_LENGTH,
} from "../src/shared/mail-account-presets";

const manualForm: AccountSetupForm = {
  email: "me@example.org",
  imap: { host: "imap.example.org", port: "993", security: "tls" },
  name: "",
  prefersMicrosoft: false,
  smtp: { host: "smtp.example.org", port: "587", security: "starttls" },
};

const modeOf = (email: string) =>
  getAccountSetupMode({ ...INITIAL_ACCOUNT_SETUP_FORM, email });

describe("the Add account form", () => {
  it.each(["name@icloud.com", "Name@ME.com", " name@mac.com "])(
    "uses Apple's iCloud servers for %s",
    (email) => {
      const mode = modeOf(email);

      expect(mode.kind).toBe("preset");
      expect(mode.kind === "preset" ? mode.preset : undefined).toStrictEqual({
        appPasswordUrl: "https://support.apple.com/en-us/102654",
        imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
        provider: "icloud",
        smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
        title: "iCloud",
      });
    }
  );

  it("asks for servers for any other domain, and nothing before the address is complete", () => {
    expect(
      ["me@example.org", "me@icloud.com.example", "me@", "me@icloud", ""].map(
        (email) => modeOf(email).kind
      )
    ).toStrictEqual(["manual", "manual", "address", "address", "address"]);
    expect(findMailAccountPreset("name@icloud.com.example")).toBeUndefined();
  });

  it.each(["me@gmail.com", "Me@GoogleMail.com"])(
    "uses Google's Gmail servers for %s",
    (email) => {
      const mode = modeOf(email);

      expect(mode.kind).toBe("preset");
      expect(mode.kind === "preset" ? mode.preset : undefined).toStrictEqual({
        appPasswordUrl: "https://myaccount.google.com/apppasswords",
        imap: { host: "imap.gmail.com", port: 993, security: "tls" },
        provider: "gmail",
        smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
        title: "Gmail",
      });
      expect(
        findAccountSetupProblem({ ...INITIAL_ACCOUNT_SETUP_FORM, email }, true)
      ).toBeUndefined();
      expect(toAccountServers({ ...manualForm, email })).toBeUndefined();
    }
  );

  it("reports the first thing to fix, in reading order", () => {
    expect(
      findAccountSetupProblem(
        { ...INITIAL_ACCOUNT_SETUP_FORM, name: "Me\tToo" },
        false
      )?.field
    ).toBe("name");
    expect(
      findAccountSetupProblem(INITIAL_ACCOUNT_SETUP_FORM, false)?.field
    ).toBe("email");
    expect(
      findAccountSetupProblem(
        { ...INITIAL_ACCOUNT_SETUP_FORM, email: "name@icloud.com" },
        false
      )?.field
    ).toBe("password");
    expect(
      findAccountSetupProblem(
        { ...INITIAL_ACCOUNT_SETUP_FORM, email: "name@icloud.com" },
        true
      )
    ).toBeUndefined();
  });

  it("checks typed servers once the address and password are there", () => {
    expect(
      findAccountSetupProblem(
        { ...manualForm, imap: { ...manualForm.imap, host: "imap example" } },
        true
      )?.field
    ).toBe("imapHost");
    expect(
      findAccountSetupProblem(
        { ...manualForm, smtp: { ...manualForm.smtp, port: "70000" } },
        true
      )
    ).toStrictEqual({
      field: "smtpPort",
      message: "Enter the outgoing server's port, from 1 to 65535.",
    });
    expect(
      findAccountSetupProblem(
        { ...manualForm, smtp: { ...manualForm.smtp, port: "5e2" } },
        true
      )?.field
    ).toBe("smtpPort");
    expect(findAccountSetupProblem(manualForm, true)).toBeUndefined();
  });

  it("ignores server fields for a preset address", () => {
    expect(
      findAccountSetupProblem(
        {
          ...manualForm,
          email: "name@icloud.com",
          imap: { ...manualForm.imap, host: "" },
        },
        true
      )
    ).toBeUndefined();
    expect(
      toAccountServers({ ...manualForm, email: "name@icloud.com" })
    ).toBeUndefined();
  });

  it("sends trimmed manual servers with numeric ports", () => {
    expect(
      toAccountServers({
        ...manualForm,
        imap: { ...manualForm.imap, host: " imap.example.org ", port: " 993 " },
      })
    ).toStrictEqual({
      imap: { host: "imap.example.org", port: 993, security: "tls" },
      smtp: { host: "smtp.example.org", port: 587, security: "starttls" },
    });
  });

  it("moves a default port along with the security choice, but keeps a custom one", () => {
    expect(withServerSecurity("smtp", manualForm.smtp, "tls")).toStrictEqual({
      ...manualForm.smtp,
      port: "465",
      security: "tls",
    });
    expect(
      withServerSecurity("imap", manualForm.imap, "starttls")
    ).toStrictEqual({ ...manualForm.imap, port: "143", security: "starttls" });
    expect(
      withServerSecurity(
        "imap",
        { ...manualForm.imap, port: "1993" },
        "starttls"
      ).port
    ).toBe("1993");
  });

  it("sends a trimmed name only when one is given", () => {
    expect(toAccountName({ ...manualForm, name: "  Ada Lovelace " })).toBe(
      "Ada Lovelace"
    );
    expect(toAccountName({ ...manualForm, name: " \t " })).toBeUndefined();
    expect(toAccountName(manualForm)).toBeUndefined();
  });

  it("refuses a name the sender header cannot carry", () => {
    const longest = "a".repeat(MAX_DISPLAY_NAME_LENGTH);

    expect(
      findAccountSetupProblem({ ...manualForm, name: ` ${longest} ` }, true)
    ).toBeUndefined();
    expect(
      findAccountSetupProblem({ ...manualForm, name: `${longest}a` }, true)
    ).toStrictEqual({
      field: "name",
      message: `Keep the name to ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
    });
    expect(
      findAccountSetupProblem({ ...manualForm, name: "Ada\tLovelace" }, true)
    ).toStrictEqual({
      field: "name",
      message: "Remove tabs and line breaks from the name.",
    });
  });
});

describe("Microsoft sign-in in the Add account form", () => {
  const microsoftServerForm: AccountSetupForm = {
    ...manualForm,
    imap: { ...manualForm.imap, host: "outlook.office365.com" },
  };
  const chosenForm = withSignInMethod(manualForm, "microsoft");

  it.each(["me@outlook.com", "Me@Hotmail.co.uk ", "me@live.de"])(
    "signs %s in through Microsoft, with no way to a password",
    (email) => {
      const mode = modeOf(email);

      expect(mode).toStrictEqual({ kind: "microsoft", via: "address" });
      expect(findSignInSwitch(mode, true)).toBeUndefined();
    }
  );

  it("waits for a complete address before deciding it is Outlook's", () => {
    expect(modeOf("me@outlook.").kind).toBe("address");
  });

  it("signs in through Microsoft when the incoming server is Microsoft's", () => {
    expect(getAccountSetupMode(microsoftServerForm)).toStrictEqual({
      kind: "microsoft",
      via: "server",
    });
    expect(
      getAccountSetupMode({
        ...manualForm,
        imap: { ...manualForm.imap, host: " IMAP-Mail.Outlook.com " },
      }).kind
    ).toBe("microsoft");
  });

  it("offers Microsoft for a typed address only when this build can sign in there", () => {
    expect(findSignInSwitch({ kind: "manual" }, true)).toBe("microsoft");
    expect(findSignInSwitch({ kind: "manual" }, false)).toBeUndefined();
    expect(findSignInSwitch({ kind: "address" }, true)).toBeUndefined();
    expect(findSignInSwitch(modeOf("me@gmail.com"), true)).toBeUndefined();
  });

  it("signs a typed address in through Microsoft once chosen, and can go back", () => {
    const mode = getAccountSetupMode(chosenForm);

    expect(mode).toStrictEqual({ kind: "microsoft", via: "choice" });
    expect(findSignInSwitch(mode, true)).toBe("password");
    expect(
      getAccountSetupMode(withSignInMethod(chosenForm, "password"))
    ).toStrictEqual({ kind: "manual" });
  });

  it("keeps a chosen Microsoft sign-in while the address is edited", () => {
    expect(
      getAccountSetupMode({ ...chosenForm, email: "me@example." }).kind
    ).toBe("microsoft");
  });

  it("goes back to a password from a Microsoft server by clearing that server", () => {
    // Even without Microsoft in this build, or the form is stuck.
    expect(
      findSignInSwitch(getAccountSetupMode(microsoftServerForm), false)
    ).toBe("password");

    const back = withSignInMethod(microsoftServerForm, "password");

    expect(back.imap).toStrictEqual({ ...manualForm.imap, host: "" });
    expect(getAccountSetupMode(back)).toStrictEqual({ kind: "manual" });
  });

  it("leaves Gmail and iCloud to their presets, whatever was chosen or typed", () => {
    for (const email of ["me@gmail.com", "me@icloud.com"]) {
      const mode = getAccountSetupMode({
        ...microsoftServerForm,
        email,
        prefersMicrosoft: true,
      });

      expect(mode.kind).toBe("preset");
    }
  });

  it("needs only a valid address and name, and no password", () => {
    expect(findAccountSetupProblem(chosenForm, false)).toBeUndefined();
    expect(
      findAccountSetupProblem(
        { ...INITIAL_ACCOUNT_SETUP_FORM, email: "me@outlook.com" },
        false
      )
    ).toBeUndefined();
    expect(
      findAccountSetupProblem({ ...chosenForm, email: "me@example" }, false)
    ).toStrictEqual({ field: "email", message: "Enter your email address." });
    expect(
      findAccountSetupProblem({ ...chosenForm, name: "Ada\nLovelace" }, false)
        ?.field
    ).toBe("name");
    expect(
      findAccountSetupProblem(
        { ...chosenForm, imap: { ...chosenForm.imap, port: "0" } },
        false
      )
    ).toBeUndefined();
  });

  it("sends no servers", () => {
    expect(toAccountServers(chosenForm)).toBeUndefined();
    expect(toAccountServers(microsoftServerForm)).toBeUndefined();
    expect(
      toAccountServers({ ...manualForm, email: "me@outlook.com" })
    ).toBeUndefined();
  });

  it("asks for the trimmed address, and a trimmed name only when one is given", () => {
    expect(
      toMicrosoftSignIn({
        ...chosenForm,
        email: " me@example.org ",
        name: " Ada Lovelace ",
      })
    ).toStrictEqual({ email: "me@example.org", name: "Ada Lovelace" });
    expect(toMicrosoftSignIn({ ...chosenForm, name: " \t " })).toStrictEqual({
      email: "me@example.org",
    });
  });
});

describe("signing an account in again", () => {
  const passwordTarget = {
    email: "me@example.org",
    method: "password",
  } as const;
  const microsoftTarget = {
    email: "me@contoso.com",
    method: "microsoft",
  } as const;

  it("reads the account main named, and treats anything else as Add account", () => {
    expect(
      readSignInAgain(
        "?presentation=window&account=me%40example.org&method=password"
      )
    ).toStrictEqual(passwordTarget);
    expect(readSignInAgain("?presentation=window")).toBeUndefined();
    expect(
      readSignInAgain("?account=me%40example.org&method=imap")
    ).toBeUndefined();
    expect(
      readSignInAgain("?account=not-an-address&method=password")
    ).toBeUndefined();
  });

  // The account keeps its name and servers, so a generic account must not
  // be held up by server fields this page never shows.
  it("asks only for the password, even for an account with its own servers", () => {
    const form = createSignInAgainForm(passwordTarget);

    expect(getAccountSetupMode(form)).toStrictEqual({ kind: "manual" });
    expect(findSetupProblem(form, false, passwordTarget)).toStrictEqual({
      field: "password",
      message: "Enter the new app password.",
    });
    expect(findSetupProblem(form, true, passwordTarget)).toBeUndefined();
    expect(
      findSetupSignInSwitch(getAccountSetupMode(form), true, passwordTarget)
    ).toBeUndefined();
  });

  it("sends the account's address and the password, and nothing else", () => {
    const form = {
      ...createSignInAgainForm(passwordTarget),
      email: "someone@example.org",
      name: "Someone",
    };

    expect(toPasswordSubmission(form, "pw", passwordTarget)).toStrictEqual({
      email: "me@example.org",
      password: "pw",
    });
  });

  it("signs a Microsoft account on its own domain in with Microsoft", () => {
    const form = createSignInAgainForm(microsoftTarget);

    expect(getAccountSetupMode(form)).toStrictEqual({
      kind: "microsoft",
      via: "choice",
    });
    expect(findSetupProblem(form, false, microsoftTarget)).toBeUndefined();
    expect(toMicrosoftSubmission(form, microsoftTarget)).toStrictEqual({
      email: "me@contoso.com",
    });
  });
});
