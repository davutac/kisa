import type { Session, WebFrameMain } from "electron";

// The only subframes in Kisa's windows display message HTML, so a request
// made from a subframe was made by a message. Once the reader shows a
// message's images, those requests go to hosts the sender chose. They send no
// cookies and store none, so a cookie cannot tie one opened message to the
// next, and they send no referrer: the frame's document asks for none, but an
// element's own `referrerpolicy` overrides that, and only here is the header
// out of the message's reach. The reader's address and the HTTP cache still
// reach those hosts.

const isFromMessageFrame = (
  frame: WebFrameMain | null | undefined
): boolean => {
  try {
    return (frame?.parent ?? null) !== null;
  } catch {
    // A frame that is already gone can no longer be told apart; withholding
    // these headers from its last requests costs nothing.
    return true;
  }
};

const withoutHeaders = <Value>(
  headers: Readonly<Record<string, Value>>,
  names: ReadonlySet<string>
): Record<string, Value> =>
  Object.fromEntries(
    Object.entries(headers).filter(
      ([header]) => !names.has(header.toLowerCase())
    )
  );

const WITHHELD_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "cookie",
  "referer",
]);

const WITHHELD_RESPONSE_HEADERS: ReadonlySet<string> = new Set(["set-cookie"]);

// Electron's webRequest hooks answer through a callback by definition.
// oxlint-disable promise/prefer-await-to-callbacks
export const installMessageFrameRequestPolicy = (session: Session): void => {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    callback(
      isFromMessageFrame(details.frame)
        ? {
            requestHeaders: withoutHeaders(
              details.requestHeaders,
              WITHHELD_REQUEST_HEADERS
            ),
          }
        : {}
    );
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    callback(
      isFromMessageFrame(details.frame) && details.responseHeaders !== undefined
        ? {
            responseHeaders: withoutHeaders(
              details.responseHeaders,
              WITHHELD_RESPONSE_HEADERS
            ),
          }
        : {}
    );
  });
};
// oxlint-enable promise/prefer-await-to-callbacks
