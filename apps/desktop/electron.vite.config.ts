import path from "node:path";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const reactCompiler = await babel({ presets: [reactCompilerPreset()] });

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: ["@repo/database", "@repo/gmail"],
        include: ["better-sqlite3"],
      },
    },
    resolve: {
      alias: [
        { find: "@/shared", replacement: path.resolve("src/shared") },
        { find: "@/constants", replacement: path.resolve("src/constants.ts") },
      ],
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [
      tanstackRouter({
        generatedRouteTree: "./src/routeTree.gen.ts",
        routesDirectory: "./src/routes",
        target: "react",
      }),
      react(),
      reactCompiler,
      tailwindcss(),
    ],
    resolve: {
      alias: [
        { find: "@/shared", replacement: path.resolve("src/shared") },
        { find: "@/constants", replacement: path.resolve("src/constants.ts") },
        { find: "@/renderer", replacement: path.resolve("src/renderer/src") },
        { find: "@", replacement: path.resolve("src/renderer/src") },
      ],
    },
  },
});
