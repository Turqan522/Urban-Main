import type { State } from "./types";
import { loadState } from "./store";
let cached: { state: State; expires: number } | null = null;
let pending: Promise<State> | null = null;
export async function cachedState(): Promise<State> {
  if (cached && Date.now() < cached.expires) return cached.state;
  pending ??= loadState().then(state => { cached = { state, expires: Date.now() + 2000 }; return state; }).finally(() => { pending = null; });
  return pending;
}
export function invalidateCache() { cached = null; }
