import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [react(), sitemap()],
  site: "https://kisa.email",
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      noExternal: ["lucide-react"],
    },
  },
});
