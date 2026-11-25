import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "kisa-mail",
    compatibilityDate: "2026-08-10",
    observability: {
      enabled: false,
    },
    assets: {
      notFoundHandling: "404-page",
    },
    domains: ["kisa.email"],
  },
});
