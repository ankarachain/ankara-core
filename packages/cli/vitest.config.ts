import { defineConfig } from "vitest/config";

// config.ts tests use process.chdir(), which worker_threads (vitest's default
// pool) doesn't support — run tests in forked subprocesses instead.
export default defineConfig({
  test: {
    pool: "forks",
  },
});
