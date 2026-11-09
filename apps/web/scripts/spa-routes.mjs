// Emit real files for client-side routes at build time.
//
// The app routes /demo client-side, but a static host resolves paths against
// files on disk and returns its own 404 before the SPA ever boots. Writing a
// directory index for each route means the host serves the app shell and the
// router takes over, without depending on host-specific rewrite rules.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const index = join(dist, "index.html");

if (!existsSync(index)) {
  console.error("spa-routes: dist/index.html not found — run vite build first.");
  process.exit(1);
}

// Routes without dynamic segments can be written as real directory indexes.
const routes = ["demo"];

for (const route of routes) {
  const target = join(dist, route);
  mkdirSync(target, { recursive: true });
  copyFileSync(index, join(target, "index.html"));
  console.log(`spa-routes: ${route}/index.html`);
}
