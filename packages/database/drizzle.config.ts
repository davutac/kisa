import { defineConfig } from "drizzle-kit";

export default defineConfig({
  casing: "snake_case",
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/schemas",
});
