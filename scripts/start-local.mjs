import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot } from "./sites-env.mjs";
import { ensureLocalAuth } from "./ensure-local-auth.mjs";

ensureLocalAuth();
// Wrangler resolves relative env files against dist/server, while its Node
// launcher resolves them against cwd. An absolute path works for both.
const result = spawnSync(process.execPath, [
  path.join(projectRoot, "node_modules/wrangler/bin/wrangler.js"),
  "dev", "--config", "dist/server/wrangler.json",
  "--env-file", path.join(projectRoot, ".dev.vars"),
  "--local", "--persist-to", ".wrangler/state",
  "--ip", "127.0.0.1", "--inspector-port", "0",
  ...process.argv.slice(2),
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
