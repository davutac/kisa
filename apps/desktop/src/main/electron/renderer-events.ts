import * as Schema from "effect/Schema";
import { BrowserWindow } from "electron";

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
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, encoded);
    }
  }
};
