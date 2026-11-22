import { AccountId } from "@repo/mail/ids";
import type { ImapAuth } from "@repo/mail/session";
import { Cause, Effect, Exit, Redacted } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { sendOverSmtp } from "../src/main/mail/engine/smtp-transport";
import { startFakeSmtpServer } from "./fixtures/fake-smtp-server";
import type {
  FakeSmtpBehaviour,
  FakeSmtpServer,
} from "./fixtures/fake-smtp-server";

const accountId = AccountId.make("person@example.com");
let server: FakeSmtpServer | undefined;

const passwordAuth: ImapAuth = {
  kind: "password",
  password: Redacted.make("app-password"),
  user: "person@example.com",
};

const send = async (
  behaviour: FakeSmtpBehaviour,
  to: readonly string[],
  auth: ImapAuth = passwordAuth
) => {
  server = await startFakeSmtpServer(behaviour);
  return Effect.runPromiseExit(
    sendOverSmtp(
      {
        connectionTimeout: 2000,
        greetingTimeout: 2000,
        host: "127.0.0.1",
        ignoreTLS: true,
        logger: false,
        port: server.port,
        socketTimeout: 2000,
      },
      {
        accountId,
        auth,
        envelope: { from: "person@example.com", to },
        message: Buffer.from("Subject: Hello\r\n\r\nHi there\r\n"),
        server: { host: "127.0.0.1", port: server.port, security: "tls" },
      }
    )
  );
};

const failureTag = (exit: Exit.Exit<unknown, { readonly _tag: string }>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

describe("SMTP sending", () => {
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("delivers to every envelope recipient", async () => {
    const exit = await send({}, ["a@example.com", "hidden@example.com"]);

    expect(exit).toStrictEqual(Exit.succeed({ refused: [] }));
    expect(server?.received).toStrictEqual([
      {
        data: "Subject: Hello\r\n\r\nHi there",
        from: "person@example.com",
        to: ["a@example.com", "hidden@example.com"],
      },
    ]);
  });

  it("signs in with the account's app password", async () => {
    const exit = await send({}, ["a@example.com"]);
    const [authentication = ""] = server?.authentications ?? [];
    const [method, token = ""] = authentication.split(" ").slice(1);

    expect(exit).toStrictEqual(Exit.succeed({ refused: [] }));
    expect(method).toBe("PLAIN");
    expect(Buffer.from(token, "base64").toString("utf-8")).toBe(
      "\u0000person@example.com\u0000app-password"
    );
  });

  it("signs in with XOAUTH2 and the account's access token", async () => {
    const exit = await send({}, ["a@example.com"], {
      accessToken: Redacted.make("access-token"),
      expiresAt: Date.now() + 3_600_000,
      kind: "oauth",
      user: "person@example.com",
    });
    const [authentication = ""] = server?.authentications ?? [];
    const [method, token = ""] = authentication.split(" ").slice(1);

    expect(exit).toStrictEqual(Exit.succeed({ refused: [] }));
    expect(method).toBe("XOAUTH2");
    expect(Buffer.from(token, "base64").toString("utf-8")).toBe(
      "user=person@example.com\u0001auth=Bearer access-token\u0001\u0001"
    );
  });

  it("reports recipients the server refused while sending to the rest", async () => {
    const exit = await send({ refusedRecipients: ["gone@example.com"] }, [
      "a@example.com",
      "gone@example.com",
    ]);

    expect(exit).toStrictEqual(Exit.succeed({ refused: ["gone@example.com"] }));
  });

  it.each([
    [{ refusedRecipients: ["a@example.com"] }, "MailSendRejectedError"],
    [{ finalReply: "554 5.6.0 Message refused" }, "MailSendRejectedError"],
    [{ finalReply: "451 4.3.0 Try later" }, "MailThrottledError"],
    [{ authFails: true }, "MailAuthError"],
    [{ dropAtGreeting: true }, "MailConnectionError"],
    [{ dropAfterData: true }, "MailSendUnknownError"],
  ] as const)("sorts %o as %s", async (behaviour, tag) => {
    const exit = await send(behaviour, ["a@example.com"]);

    expect(failureTag(exit)).toMatchObject({ _tag: tag });
  });
});
