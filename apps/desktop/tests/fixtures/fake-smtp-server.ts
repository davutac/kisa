import { once } from "node:events";
import { createServer } from "node:net";
import type { AddressInfo, Server, Socket } from "node:net";

/** How the server answers, set per test. */
export interface FakeSmtpBehaviour {
  readonly authFails?: boolean;
  /** Close the connection once the message has arrived, before replying. */
  readonly dropAfterData?: boolean;
  readonly dropAtGreeting?: boolean;
  /** The reply to the end of the message; `250 OK` by default. */
  readonly finalReply?: string;
  readonly refusedRecipients?: readonly string[];
}

export interface ReceivedMessage {
  readonly data: string;
  readonly from: string;
  readonly to: readonly string[];
}

export interface FakeSmtpServer {
  /** `AUTH` commands as the client sent them. */
  readonly authentications: string[];
  readonly close: () => Promise<void>;
  readonly port: number;
  readonly received: ReceivedMessage[];
}

const addressOf = (line: string): string =>
  /<(?<address>[^>]*)>/u.exec(line)?.groups?.address ?? "";

/**
 * A loopback SMTP server that speaks just enough of RFC 5321 for one
 * message per connection, without TLS.
 */
export const startFakeSmtpServer = async (
  behaviour: FakeSmtpBehaviour = {}
): Promise<FakeSmtpServer> => {
  const received: ReceivedMessage[] = [];
  const authentications: string[] = [];
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));

    if (behaviour.dropAtGreeting === true) {
      socket.destroy();

      return;
    }

    let buffer = "";
    let from = "";
    let to: string[] = [];
    let data: string[] | undefined;

    const reply = (line: string): void => {
      socket.write(`${line}\r\n`);
    };

    const handle = (line: string): void => {
      if (data !== undefined) {
        if (line !== ".") {
          data.push(line.startsWith("..") ? line.slice(1) : line);

          return;
        }

        received.push({ data: data.join("\r\n"), from, to });
        data = undefined;

        if (behaviour.dropAfterData === true) {
          socket.destroy();

          return;
        }

        reply(behaviour.finalReply ?? "250 2.0.0 OK");

        return;
      }

      const command = line.slice(0, 4).toUpperCase();

      if (command === "EHLO") {
        reply("250-localhost");
        reply("250 AUTH PLAIN LOGIN XOAUTH2");
      } else if (command === "AUTH") {
        authentications.push(line);
        reply(
          behaviour.authFails === true ? "535 5.7.8 Rejected" : "235 2.7.0 OK"
        );
      } else if (command === "MAIL") {
        from = addressOf(line);
        to = [];
        reply("250 2.1.0 OK");
      } else if (command === "RCPT") {
        const recipient = addressOf(line);

        if (behaviour.refusedRecipients?.includes(recipient) === true) {
          reply("550 5.1.1 No such user");
        } else {
          to.push(recipient);
          reply("250 2.1.5 OK");
        }
      } else if (command === "DATA") {
        data = [];
        reply("354 Go ahead");
      } else if (command === "QUIT") {
        reply("221 2.0.0 Bye");
        socket.end();
      } else {
        reply("502 5.5.2 Not implemented");
      }
    };

    reply("220 localhost ESMTP");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf-8");
      let end = buffer.indexOf("\r\n");

      while (end !== -1) {
        handle(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\r\n");
      }
    });
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    authentications,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }

      server.close();
      await once(server, "close");
    },
    // SAFETY: the server is listening on a TCP port, awaited above, and for
    // one `address()` returns an AddressInfo.
    port: (server.address() as AddressInfo).port,
    received,
  };
};
