import { describe, expect, it } from "vitest";

import {
  findAccountSetupProblem,
  getAccountSetupMode,
  INITIAL_ACCOUNT_SETUP_FORM,
  toAccountServers,
  withServerSecurity,
} from "../src/renderer/src/account-setup/account-setup-form";
import type { AccountSetupForm } from "../src/renderer/src/account-setup/account-setup-form";
import { findMailAccountPreset } from "../src/shared/mail-account-presets";

const manualForm: AccountSetupForm = {
  email: "me@example.org",
  imap: { host: "imap.example.org", port: "993", security: "tls" },
  smtp: { host: "smtp.example.org", port: "587", security: "starttls" },
};

describe("the Add account form", () => {
  it.each(["name@icloud.com", "Name@ME.com", " name@mac.com "])(
    "uses Apple's iCloud servers for %s",
    (email) => {
      const mode = getAccountSetupMode(email);

      expect(mode.kind).toBe("preset");
      expect(mode.kind === "preset" ? mode.preset : undefined).toStrictEqual({
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
        (email) => getAccountSetupMode(email).kind
      )
    ).toStrictEqual(["manual", "manual", "address", "address", "address"]);
    expect(findMailAccountPreset("name@icloud.com.example")).toBeUndefined();
  });

  it("sends Gmail addresses to Google sign-in", () => {
    expect(getAccountSetupMode("me@gmail.com").kind).toBe("gmail");
    expect(getAccountSetupMode("me@GoogleMail.com").kind).toBe("gmail");
    expect(
      findAccountSetupProblem(
        { ...INITIAL_ACCOUNT_SETUP_FORM, email: "me@gmail.com" },
        true
      )
    ).toStrictEqual({
      field: "email",
      message: "Connect Gmail with Google sign-in instead.",
    });
  });

  it("reports the first thing to fix, in reading order", () => {
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
});
