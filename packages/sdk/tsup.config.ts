import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ["react"],
  },
  {
    entry: { "react/index": "src/react/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    external: ["react", "ethers"],
  },
  {
    entry: { "server/index": "src/server/index.ts" },
    format: ["cjs", "esm"],
    dts: true,
    sourcemap: true,
    external: ["react"],
  },
]);
