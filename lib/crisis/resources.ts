import type { Shelter, State, Alert } from "./types";
export const waterPercent = (sh: Shelter) => sh.resources.waterMax > 0 ? 100 * sh.resources.waterLiters / sh.resources.waterMax : 0;
export const foodPercent = (sh: Shelter) => sh.resources.foodMax > 0 ? 100 * sh.resources.foodRations / sh.resources.foodMax : 0;
/** Stop new arrivals at the warning threshold; a supply alert remains visible. */
export function isShelterEligible(sh: Shelter, s: State) {
  return sh.open && sh.capacity > 0 && sh.occupied / sh.capacity * 100 < s.config.routeLimit && waterPercent(sh) >= 20 && foodPercent(sh) >= 10;
}
export function resourceAlerts(s: State): Alert[] {
  return s.shelters.filter(sh => sh.open && (waterPercent(sh) < 20 || foodPercent(sh) < 10)).map(sh => ({
    id: `resource:${sh.id}`, kind: "resource", title: "Məntəqədə kritik təchizat çatışmazlığı",
    detail: `${sh.name} · su ${Math.round(waterPercent(sh))}% · qida ${Math.round(foodPercent(sh))}% · təchizat göndər`,
    zone: s.nodes.find(n => n.id === sh.node)?.zone ?? "", node: sh.node, sosIds: [], shelterId: sh.id,
  }));
}
