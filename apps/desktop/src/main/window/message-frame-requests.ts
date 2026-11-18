import type { Session, WebFrameMain } from "electron";

// The only subframes in Kisa's windows display message HTML, so a request
// made from a subframe was made by a message. Once the reader shows a
// message's images, those requests go to hosts the sender chose. They send no
// cookies and store none, so a cookie cannot tie one opened message to the
// next; the reader's address and the HTTP cache still reach those hosts.

const isFromMessageFrame = (
  frame: WebFrameMain | null | undefined
): boolean => {
  try {
    return (frame?.parent ?? null) !== null;
  } catch {
    // A frame that is already gone can no longer be told apart; withholding
    // cookies from its last requests costs nothing.
    return true;
  }
};

const withoutHeader = <Value>(
  headers: Readonly<Record<string, Value>>,
  name: string
): Record<string, Value> =>
  Object.fromEntries(
    Object.entries(headers).filter(([header]) => header.toLowerCase() !== name)
  );

// Electron's webRequest hooks answer through a callback by definition.
// oxlint-disable promise/prefer-await-to-callbacks
export const installMessageFrameCookiePolicy = (session: Session): void => {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    callback(
      isFromMessageFrame(details.frame)
        ? { requestHeaders: withoutHeader(details.requestHeaders, "cookie") }
        : {}
    );
  });
  session.webRequest.onHeadersReceived((details, callback) => {
    callback(
      isFromMessageFrame(details.frame) && details.responseHeaders !== undefined
        ? {
            responseHeaders: withoutHeader(
              details.responseHeaders,
              "set-cookie"
            ),
          }
        : {}
    );
  });
};
// oxlint-enable promise/prefer-await-to-callbacks
