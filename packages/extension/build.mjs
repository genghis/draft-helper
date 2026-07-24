import { cpSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

mkdirSync("dist", { recursive: true });

// Content scripts must be classic scripts (IIFE); the service worker and
// options page are ES modules.
await build({
  entryPoints: ["src/page.ts", "src/content.ts"],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: "dist",
});

await build({
  entryPoints: ["src/background.ts", "src/options.ts"],
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: "dist",
});

cpSync("manifest.json", "dist/manifest.json");
cpSync("src/options.html", "dist/options.html");

console.log("extension built into dist/ — load it unpacked from there");
