import { env } from "cloudflare:workers";
import type { State } from "./types";
import { seed } from "./seed";
import { AppError } from "./commands";
import { migrateState } from "./migrate";
import { transact } from "./transaction";
function db() {
  if (!env.DB) throw new AppError("Məlumat bazası hazır deyil.", 503);
  return env.DB;
}
export async function loadState(): Promise<State> {
  const database = db();
  const initial = seed();
  await database.prepare("INSERT OR IGNORE INTO crisis_state (id, revision, payload) VALUES (?, ?, ?)").bind("demo", 0, JSON.stringify(initial)).run();
  const row = await database.prepare("SELECT payload FROM crisis_state WHERE id = ?").bind("demo").first<{ payload: string }>();
  if (!row) throw new AppError("Vəziyyət oxuna bilmədi.", 503);
  return migrateState(JSON.parse(row.payload));
}
export async function mutate(action: string, body: Record<string, unknown>, citizen: string) {
  return transact({ load: loadState, compareAndSwap: async (before, after) => {
    const result = await db().prepare("UPDATE crisis_state SET payload = ?, revision = ? WHERE id = ? AND revision = ?")
      .bind(JSON.stringify(after), after.revision, "demo", before.revision).run();
    return result.meta.changes === 1;
  } }, action, body, citizen);
}
