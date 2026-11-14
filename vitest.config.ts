import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const p = (d: string) => fileURLToPath(new URL(d, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@contracts": p("./contracts"),
      "@": p("./src"),
    },
  },
});
