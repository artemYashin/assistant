import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export default defineConfig({
  root: "services/frontend",
  build: { outDir: "../../dist", emptyOutDir: true },
  plugins: [react()],
  resolve: {
    alias: [
      {
        // Refractor's browser decoder touches document at module load. Workers
        // need the DOM-free, table-based implementation selected by Node.
        find: /^decode-named-character-reference$/,
        replacement: require.resolve("decode-named-character-reference"),
      },
    ],
  },
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:43871" } },
});
