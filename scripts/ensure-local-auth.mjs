import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
/** Local demo credentials only. This ignored file is never included in GitHub or a Site build. */
export function ensureLocalAuth() {
  if (existsSync(".dev.vars")) return;
  const secret = randomBytes(32).toString("hex");
  writeFileSync(".dev.vars", `CRISIS_JWT_SECRET="${secret}"\nCRISIS_OPERATOR_PASSWORD="crisis2026"\nCRISIS_ADMIN_PASSWORD="admin2026"\n`);
  console.log("Created local .dev.vars for demo login (operator / crisis2026; admin / admin2026).");
}
