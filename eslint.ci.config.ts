import { defineConfig } from "eslint/config";
import base from "./eslint.config";

export default defineConfig(...base, {
  files: ["src/**/*.{ts,tsx,mts,cts}"],
  rules: {
    "import-x/no-cycle": ["error", { maxDepth: Infinity }],
  },
});
