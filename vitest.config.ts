import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["app/**", "components/**", "lib/**"],
      exclude: ["**/*.d.ts", "**/*.test.*", "tests/**"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
    exclude: ["node_modules", "tests/e2e/**", ".next/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
