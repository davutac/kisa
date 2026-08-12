import * as Schema from "effect/Schema";
import { BrowserWindow } from "electron";

export interface RendererEventOwner {
  readonly id: number;
  readonly once: (event: "destroyed", listener: () => void) => unknown;
}

const canReceiveEvents = (window: BrowserWindow): boolean =>
  !(window.isDestroyed() || window.webContents.isDestroyed());

export const sendRendererEvent = <A, I>(
  channel: string,
  schema: Schema.Codec<A, I, never, never>,
  payload: A,
  targetWindow?: BrowserWindow
): void => {
  const encoded = Schema.encodeUnknownSync(schema)(payload);
  const windows =
    targetWindow === undefined ? BrowserWindow.getAllWindows() : [targetWindow];

  for (const window of windows) {
    if (canReceiveEvents(window)) {
      window.webContents.send(channel, encoded);
    }
  }
};

export const sendRendererEventToEachWindow = <A, I>(
  channel: string,
  schema: Schema.Codec<A, I, never, never>,
  makePayload: (owner: RendererEventOwner) => A
): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (canReceiveEvents(window)) {
      sendRendererEvent(
        channel,
        schema,
        makePayload(window.webContents),
        window
      );
    }
  }
};
