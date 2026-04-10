import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: false,
  sourcemap: false,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["ethers"],
});
