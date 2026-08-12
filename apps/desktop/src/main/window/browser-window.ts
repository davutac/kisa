import path from "node:path";

import { BrowserWindow } from "electron";

import {
  TITLEBAR_HEIGHT,
  TRAFFIC_LIGHT_POSITION,
} from "@/shared/window-chrome";

import icon from "../../../build/icon.png?asset";

interface CreateBrowserWindowOptions {
  readonly height: number;
  readonly minHeight: number;
  readonly minWidth: number;
  readonly preload?: string;
  readonly title: string;
  readonly width: number;
  readonly x?: number;
  readonly y?: number;
}

export const createBrowserWindow = ({
  height,
  minHeight,
  minWidth,
  preload = path.join(import.meta.dirname, "../preload/index.cjs"),
  title,
  width,
  x,
  y,
}: CreateBrowserWindowOptions): BrowserWindow =>
  new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#121212",
    height,
    icon: process.platform === "linux" ? icon : undefined,
    minHeight,
    minWidth,
    show: false,
    title,
    titleBarOverlay: {
      color: "#ffffff00",
      height: TITLEBAR_HEIGHT,
      symbolColor: "#f5f5f5",
    },
    titleBarStyle: "hidden",
    trafficLightPosition:
      process.platform === "darwin" ? TRAFFIC_LIGHT_POSITION : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload,
      sandbox: true,
    },
    width,
    x,
    y,
  });
