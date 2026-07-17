/**
 * @ankarachain/sdk/server
 *
 * Server-only exports — anything that touches a secret credential
 * (currently: MoonPayProvider, which signs widget URLs with an API secret
 * key via node:crypto) lives here instead of the main entry point, which
 * already gets imported directly into "use client" browser components
 * elsewhere in this codebase. Importing this subpath into a browser bundle
 * would pull in node:crypto, which bundlers don't polyfill by default —
 * mirrors the existing @ankarachain/sdk/react split, just for the opposite
 * reason (keeping Node-only code OUT of client bundles, rather than keeping
 * React OUT of non-React apps).
 */
export { MoonPayProvider } from "../providers/MoonPayProvider";
export type { MoonPayProviderOptions } from "../providers/MoonPayProvider";
export { createRampProvider } from "../providers/createRampProvider";
export type { CreateRampProviderDeps } from "../providers/createRampProvider";
