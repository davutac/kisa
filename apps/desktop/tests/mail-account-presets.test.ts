import { describe, expect, it } from "vitest";

import {
  ACCOUNT_SETUP_HELP_URLS,
  findMailAccountPreset,
  isMicrosoftConsumerAddress,
  isMicrosoftMailHost,
  microsoftServersFor,
  OUTLOOK_IMAP_HELP_URL,
} from "../src/shared/mail-account-presets";

describe(isMicrosoftConsumerAddress, () => {
  it.each([
    "me@outlook.com",
    "me@Hotmail.co.uk",
    "me@live.de",
    "me@msn.com",
    "me@windowslive.com",
    "me@outlook.com.au",
  ])("knows %s as one of Microsoft's own addresses", (address) => {
    expect(isMicrosoftConsumerAddress(address)).toBeTruthy();
  });

  it.each([
    "me@gmail.com",
    "me@contoso.example",
    // A name that only contains or ends with one of Microsoft's.
    "me@notoutlook.com",
    "me@mail.outlook-fans.example",
    "me@sub.hotmail.example.org",
    "outlook",
    "me@outlook",
  ])("does not take %s for one", (address) => {
    expect(isMicrosoftConsumerAddress(address)).toBeFalsy();
  });
});

describe(microsoftServersFor, () => {
  it("reads every Microsoft mailbox from one server and sends by kind of account", () => {
    expect(microsoftServersFor("me@outlook.com")).toStrictEqual({
      imap: { host: "outlook.office365.com", port: 993, security: "tls" },
      smtp: { host: "smtp-mail.outlook.com", port: 587, security: "starttls" },
    });
    expect(microsoftServersFor("me@contoso.example").smtp.host).toBe(
      "smtp.office365.com"
    );
  });
});

describe(isMicrosoftMailHost, () => {
  it("knows Microsoft's servers, however they are typed", () => {
    expect(isMicrosoftMailHost(" Outlook.Office365.com ")).toBeTruthy();
    expect(isMicrosoftMailHost("imap-mail.outlook.com")).toBeTruthy();
  });

  it("does not take a look-alike for one", () => {
    expect(
      isMicrosoftMailHost("outlook.office365.com.example.org")
    ).toBeFalsy();
    expect(isMicrosoftMailHost("notoutlook.com")).toBeFalsy();
    expect(isMicrosoftMailHost("imap.gmail.com")).toBeFalsy();
  });
});

describe("the setup window's links", () => {
  it("are the presets' app password pages and Microsoft's IMAP page, all over https", () => {
    const gmail = findMailAccountPreset("me@gmail.com");
    const icloud = findMailAccountPreset("me@icloud.com");

    expect([...ACCOUNT_SETUP_HELP_URLS].toSorted()).toStrictEqual(
      [
        gmail?.appPasswordUrl,
        icloud?.appPasswordUrl,
        OUTLOOK_IMAP_HELP_URL,
      ].toSorted()
    );
    expect(
      [...ACCOUNT_SETUP_HELP_URLS].every((url) => url.startsWith("https://"))
    ).toBeTruthy();
  });

  it("offer no password preset for a Microsoft address", () => {
    expect(findMailAccountPreset("me@outlook.com")).toBeUndefined();
  });
});
