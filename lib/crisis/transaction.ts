import type { State } from "./types";
import { AppError, command } from "./commands";
export type StatePort = {
    load(): Promise<State>;
    compareAndSwap(before: State, after: State): Promise<boolean>;
};
/** Shared CAS loop used by D1 and the deterministic concurrency test adapter. */
export async function transact(port: StatePort, action: string, body: Record<string, unknown>, citizen: string) {
    for (let attempt = 0; attempt < 24; attempt++) {
        const before = await port.load();
        const after = command(before, action, body, citizen);
        if (after === before)
            return { state: before, unchanged: true };
        if (await port.compareAndSwap(before, after))
            return { state: after, unchanged: false };
        await new Promise(resolve => setTimeout(resolve, Math.min(5 * (attempt + 1), 50)));
    }
    throw new AppError("Paralel yenilənmə davam edir. Yenidən cəhd edin.", 409);
}
