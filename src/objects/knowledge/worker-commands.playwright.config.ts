import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: "list",
  testDir: ".",
  testMatch: ["worker-commands.test.ts"],
  tsconfig: "./tsconfig.test.json",
  workers: 1,
});
