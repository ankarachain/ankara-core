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
  // Bundle workspace package; keep heavy peer dep external
  noExternal: ["@ankarachain/sdk"],
  external: ["ethers"],
  // Output as .js so the shebang + bin field work without .mjs extension
  outExtension: () => ({ js: ".js" }),
});
