import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ensureLocalAuth } from "./ensure-local-auth.mjs";
const root = process.cwd();
ensureLocalAuth();
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync("dist/server/wrangler.json")) run(["scripts/run-framework.mjs", "build"]);
const config = JSON.parse(readFileSync("dist/server/wrangler.json", "utf8"));
config.main = resolve("dist/server", config.main ?? "index.js");
config.d1_databases = (config.d1_databases ?? []).map(binding => ({ ...binding, migrations_dir: resolve("drizzle") }));
if (!config.d1_databases.length) throw new Error("DB binding missing in .openai/hosting.json");
delete config.assets;
mkdirSync(".sites-runtime", { recursive: true });
writeFileSync(".sites-runtime/migrations.json", JSON.stringify(config, null, 2));
run(["--import", "./scripts/sites-env.mjs", "node_modules/wrangler/bin/wrangler.js", "d1", "migrations", "apply", "DB", "--local", "--config", ".sites-runtime/migrations.json", "--persist-to", ".wrangler/state"]);
console.log("Local D1 database is ready.");
