import { describe, expect, it } from "vitest";

import {
  findAccountSetupProblem,
  getAccountSetupMode,
  INITIAL_ACCOUNT_SETUP_FORM,
  toAccountName,
  toAccountServers,
  withServerSecurity,
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
  smtp: { host: "smtp.example.org", port: "587", security: "starttls" },
};

describe("the Add account form", () => {
  it.each(["name@icloud.com", "Name@ME.com", " name@mac.com "])(
    "uses Apple's iCloud servers for %s",
    (email) => {
      const mode = getAccountSetupMode(email);

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
        (email) => getAccountSetupMode(email).kind
      )
    ).toStrictEqual(["manual", "manual", "address", "address", "address"]);
    expect(findMailAccountPreset("name@icloud.com.example")).toBeUndefined();
  });

  it.each(["me@gmail.com", "Me@GoogleMail.com"])(
    "uses Google's Gmail servers for %s",
    (email) => {
      const mode = getAccountSetupMode(email);

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
