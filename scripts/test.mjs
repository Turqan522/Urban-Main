import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const out = "outputs/test-build";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const compile = spawnSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "--target",
    "ES2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--strict",
    "--skipLibCheck",
    "--outDir",
    out,
    "--rootDir",
    "lib",
    "lib/crisis/types.ts",
    "lib/crisis/seed.ts",
    "lib/crisis/engine.ts",
    "lib/crisis/commands.ts",
    "lib/crisis/migrate.ts",
    "lib/crisis/transaction.ts",
    "lib/crisis/circuit-breaker.ts",
    "lib/crisis/rate-limiter.ts",
    "lib/crisis/spam-detector.ts",
    "lib/crisis/auth.ts",
    "lib/crisis/resources.ts",
    "lib/crisis/volunteers.ts",
    "lib/crisis/news.ts",
    "lib/offline.ts",
    "lib/voice.ts",
    "lib/i18n.ts",
  ],
  { stdio: "inherit" },
);
if (compile.status !== 0) process.exit(compile.status ?? 1);
writeFileSync(out + "/package.json", '{"type":"commonjs"}');
const tests = spawnSync(process.execPath, ["--test", "tests/engine.test.cjs", "tests/extensions.test.cjs", "tests/pwa.test.cjs", "tests/expansion.test.cjs", "tests/security.test.cjs"], {
  stdio: "inherit",
});
process.exit(tests.status ?? 1);
