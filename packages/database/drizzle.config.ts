import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  // Loading the directory duplicates tables re-exported by the barrel.
  schema: "./src/schemas/index.ts",
});
