import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: false,
  sourcemap: false,
  clean: true,
  external: ["better-sqlite3", "@stellar/stellar-sdk"],
});
