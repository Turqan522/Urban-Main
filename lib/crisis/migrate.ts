import type { State } from "./types";
import type { publicState } from "./engine";
function fillShelterResources(sh: State["shelters"][number], updatedAt: number) {
    sh.resources ??= { waterLiters: sh.capacity * 8, waterMax: sh.capacity * 10, foodRations: sh.capacity * 4, foodMax: sh.capacity * 5, medicalKits: 80, medicalMax: 100, batteryPercent: 85, lastSuppliedAt: updatedAt };
}
/** Upgrade a browser snapshot before any client-side route or supply calculation. */
export function migratePublicState(view: ReturnType<typeof publicState>) {
    view.volunteers ??= [];
    view.volunteerTasks ??= [];
    view.news ??= [];
    view.shelters.forEach(sh => fillShelterResources(sh, view.updatedAt));
    return view;
}
/** Upgrade persisted prototype snapshots without resetting live records. */
export function migrateState(s: State): State {
    s.safety ??= {};
    s.accessibleMode ??= {};
    s.checkins ??= [];
    s.receipts ??= {};
  s.volunteers ??= [];
  s.volunteerTasks ??= [];
  s.news ??= [];
    s.roads.forEach(r => { r.accessible ??= !["r5-6", "r6-10"].includes(r.id); });
    s.shelters.forEach(sh => {
        sh.accessible ??= sh.id !== "s3";
        sh.qrCode ??= `QR-SHELTER-${sh.id.toUpperCase()}`;
    fillShelterResources(sh, s.updatedAt);
    });
    s.sos.forEach(x => { x.priority ??= 0; x.needsAccessible ??= false; });
    return s;
}
