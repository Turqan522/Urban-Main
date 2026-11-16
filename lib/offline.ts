export type QueuedAction = {
    id: string;
    path: "sos" | "safe" | "checkin" | "accessibility";
    body: Record<string, unknown>;
    createdAt: number;
};
export type StoragePort = Pick<Storage, "getItem" | "setItem">;
export const QUEUE_KEY = "urban-crisis-queue-v2";
export const SNAPSHOT_KEY = "urban-crisis-snapshot-v2";
export function readQueue(storage: StoragePort): QueuedAction[] {
    const raw = storage.getItem(QUEUE_KEY);
    if (!raw)
        return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || list.some(x => !x || typeof x.id !== "string" || !["sos", "safe", "checkin", "accessibility"].includes(x.path) || typeof x.body !== "object" || !x.body))
        throw new Error("Invalid saved queue");
    return list;
}
export function enqueue(storage: StoragePort, item: QueuedAction) {
    const queue = readQueue(storage);
    if (queue.some(x => x.id === item.id))
        return;
    if (queue.length >= 200)
        throw new Error("Queue full");
    storage.setItem(QUEUE_KEY, JSON.stringify([...queue, item]));
}
export function removeQueued(storage: StoragePort, id: string) {
    storage.setItem(QUEUE_KEY, JSON.stringify(readQueue(storage).filter(x => x.id !== id)));
}
export async function flushQueue(storage: StoragePort, send: (item: QueuedAction) => Promise<void>) {
    // Always reread after an await: another tab may have appended an item.
    while (true) {
        const item = readQueue(storage)[0];
        if (!item)
            return;
        await send(item); // Retain network errors AND rejected records for explicit review.
        removeQueued(storage, item.id);
    }
}
