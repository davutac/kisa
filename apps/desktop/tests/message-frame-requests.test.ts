// A stand-in session implements only the two webRequest hooks the policy
// installs, so it is passed where Electron expects a whole session.
// oxlint-disable anti-slop/no-chained-type-assertions typescript/no-unsafe-type-assertion
import type * as Electron from "electron";
import { describe, expect, it } from "vitest";

import { installMessageFrameRequestPolicy } from "../src/main/window/message-frame-requests";

interface RequestDetails {
  readonly frame: {
    readonly parent: { readonly frameToken: string } | null;
  } | null;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, readonly string[]>>;
}

type PolicyResponse =
  | Electron.BeforeSendResponse
  | Electron.HeadersReceivedResponse;

type Listener = (
  details: RequestDetails,
  callback: (response: PolicyResponse) => void
) => void;

// Installs the policy on a stand-in session and returns a way to run a
// request through either of its hooks.
const installPolicy = () => {
  const listeners = new Map<"receive" | "send", Listener>();

  const session = {
    webRequest: {
      onBeforeSendHeaders: (listener: Listener) => {
        listeners.set("send", listener);
      },
      onHeadersReceived: (listener: Listener) => {
        listeners.set("receive", listener);
      },
    },
  };

  // SAFETY: the policy only registers its two `webRequest` hooks on the
  // session, `onBeforeSendHeaders` and `onHeadersReceived`, which this has.
  installMessageFrameRequestPolicy(session as unknown as Electron.Session);

  return (event: "receive" | "send", details: RequestDetails) => {
    let response: PolicyResponse | undefined;
    listeners.get(event)?.(details, (value) => {
      response = value;
    });

    return response;
  };
};

const messageFrame = { parent: { frameToken: "app" } };
const appFrame = { parent: null };

describe(installMessageFrameRequestPolicy, () => {
  it("sends no cookies with a message frame's requests", () => {
    const respond = installPolicy();

    expect(
      respond("send", {
        frame: messageFrame,
        requestHeaders: { Accept: "image/*", Cookie: "id=reader" },
      })
    ).toStrictEqual({ requestHeaders: { Accept: "image/*" } });
  });

  it("sends no referrer with a message frame's requests, in any spelling", () => {
    const respond = installPolicy();

    expect(
      respond("send", {
        frame: messageFrame,
        requestHeaders: {
          Accept: "image/*",
          Referer: "http://localhost:5173/",
        },
      })
    ).toStrictEqual({ requestHeaders: { Accept: "image/*" } });
    expect(
      respond("send", {
        frame: messageFrame,
        requestHeaders: { referer: "http://localhost:5173/" },
      })
    ).toStrictEqual({ requestHeaders: {} });
  });

  it("stores no cookies a message frame's requests return", () => {
    const respond = installPolicy();

    expect(
      respond("receive", {
        frame: messageFrame,
        responseHeaders: {
          "content-type": ["image/png"],
          "set-cookie": ["id=reader"],
        },
      })
    ).toStrictEqual({ responseHeaders: { "content-type": ["image/png"] } });
  });

  it("leaves the app's own requests and main-process requests alone", () => {
    const respond = installPolicy();

    const requestHeaders = {
      Cookie: "session=app",
      Referer: "http://localhost:5173/",
    };

    expect(respond("send", { frame: appFrame, requestHeaders })).toStrictEqual(
      {}
    );
    expect(respond("send", { frame: null, requestHeaders })).toStrictEqual({});
    expect(
      respond("receive", {
        frame: appFrame,
        responseHeaders: { "set-cookie": ["session=app"] },
      })
    ).toStrictEqual({});
  });
});
