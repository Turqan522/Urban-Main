import type { Point, State, Route, Alert } from "./types";
import { isShelterEligible, resourceAlerts } from "./resources";
export function distance(a: Point, b: Point) {
    const r = Math.PI / 180;
    const dlat = (b.lat - a.lat) * r, dlng = (b.lng - a.lng) * r;
    const h = Math.sin(dlat / 2) ** 2 +
        Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function nearestNode(s: State, p: Point) {
    return s.nodes.reduce((a, b) => (distance(a, p) <= distance(b, p) ? a : b));
}
export function shortestPath(s: State, start: string, end: string, accessible = false) {
    if (!s.nodes.some(n => n.id === start) || !s.nodes.some(n => n.id === end))
        return null;
    const dist = new Map<string, number>([[start, 0]]), prev = new Map<string, {
        node: string;
        road: string;
    }>(), todo = new Set(s.nodes.map((n) => n.id));
    while (todo.size) {
        const u = [...todo].sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity))[0];
        if (!Number.isFinite(dist.get(u) ?? Infinity))
            break;
        todo.delete(u);
        if (u === end)
            break;
        for (const road of s.roads.filter((r) => !r.closed && (!accessible || r.accessible) && (r.a === u || r.b === u))) {
            const v = road.a === u ? road.b : road.a;
            if (!todo.has(v))
                continue;
            const a = s.nodes.find((n) => n.id === u)!, b = s.nodes.find((n) => n.id === v)!;
            const next = dist.get(u)! + distance(a, b) * road.congestion;
            if (next < (dist.get(v) ?? Infinity)) {
                dist.set(v, next);
                prev.set(v, { node: u, road: road.id });
            }
        }
    }
    if (!dist.has(end))
        return null;
    const nodeIds = [end], roadIds: string[] = [];
    let c = end;
    while (c !== start) {
        const p = prev.get(c);
        if (!p)
            return null;
        roadIds.unshift(p.road);
        nodeIds.unshift(p.node);
        c = p.node;
    }
    const meters = roadIds.reduce((sum, id) => {
        const r = s.roads.find((r) => r.id === id)!;
        return (sum +
            distance(s.nodes.find((n) => n.id === r.a)!, s.nodes.find((n) => n.id === r.b)!));
    }, 0);
    return { nodeIds, roadIds, meters, weightedMeters: dist.get(end)! };
}
export function routes(s: State, p: Point, accessible = false): Route[] {
    if (!s.nodes.length)
        return [];
    const start = nearestNode(s, p);
    const access = distance(p, start);
    return s.shelters
        .filter((sh) => isShelterEligible(sh,s) && (!accessible || sh.accessible))
        .flatMap((shelter) => {
        const path = shortestPath(s, start.id, shelter.node, accessible);
        if (!path)
            return [];
        return [
            {
                shelter,
                ...path,
                meters: Math.round(path.meters + access),
                minutes: Math.max(1, Math.ceil((path.weightedMeters + access) / (accessible ? 50 : 75))),
                occupancy: Math.round((100 * shelter.occupied) / shelter.capacity),
            },
        ];
    })
        .sort((a, b) => a.minutes - b.minutes || a.meters - b.meters);
}
export function alerts(s: State, now = Date.now()): Alert[] {
    const result: Alert[] = [];
    const recent = s.sos.filter((x) => x.status === "active" &&
        x.createdAt <= now &&
        x.createdAt >= now - s.config.windowSeconds * 1000);
    // Same-zone groups OR an actual 500m circle centered on an SOS; no chain clustering.
    const candidates = recent.flatMap((anchor) => [
        {
            group: recent.filter((x) => x.zone === anchor.zone),
            key: `zone:${anchor.zone}`,
        },
        {
            group: recent.filter((x) => distance(anchor, x) <= s.config.radiusMeters),
            key: `radius:${anchor.id}`,
        },
    ]);
    const used = new Set<string>();
    for (const { group, key: groupKey } of candidates.sort((a, b) => b.group.length - a.group.length)) {
        const unique = [...new Map(group.map((x) => [x.citizenId, x])).values()];
        if (unique.length < s.config.sosThreshold)
            continue;
        const ids = unique.map((x) => x.id).sort();
        const key = ids.join(",");
        if (used.has(key))
            continue;
        if (result.some((a) => a.kind === "cluster" && ids.every((id) => a.sosIds.includes(id))))
            continue;
        used.add(key);
        const a = unique[0];
        const id = `cluster:${groupKey}`;
        result.push({
            id,
            kind: "cluster",
            title: "Kritik SOS toplanması",
            detail: `${unique.length} fərqli vətəndaş • son ${s.config.windowSeconds / 60} dəqiqə • əlavə briqada göndər`,
            zone: a.zone,
            node: nearestNode(s, a).id,
            sosIds: ids,
            hasPriority: unique.some(x => x.priority === 1),
        });
    }
    for (const sh of s.shelters.filter((x) => x.open && (x.occupied / x.capacity) * 100 > s.config.alertLimit)) {
        result.push({
            id: `capacity:${sh.id}`,
            kind: "capacity",
            title: "Toplanış məntəqəsi kritik doludur",
            detail: `${sh.name} • ${Math.round((sh.occupied / sh.capacity) * 100)}% • yeni məntəqə aç`,
            zone: s.nodes.find((n) => n.id === sh.node)!.zone,
            node: sh.node,
            sosIds: [],
            shelterId: sh.id,
        });
    }
    result.push(...resourceAlerts(s));
    return result.sort((a, b) => Number(b.hasPriority ?? false) - Number(a.hasPriority ?? false));
}
export const accessibleRoutes = (s: State, p: Point) => routes(s, p, true);
export function teamRoute(s: State, team: State["teams"][number], targetNode: string) {
    const path = shortestPath(s, team.node, targetNode);
    return path ? { ...path, etaMinutes: Math.max(1, Math.ceil(path.weightedMeters / 300)) } : null;
}
export function zoneStats(s: State) {
    return [...new Set(s.nodes.map(n => n.zone))].map(zone => {
        const reports = s.sos.filter(x => x.zone === zone);
        const shelters = s.shelters.filter(sh => sh.open && s.nodes.find(n => n.id === sh.node)?.zone === zone);
        return { zone, activeSos: reports.filter(x => x.status === "active").length,
            prioritySos: reports.filter(x => x.status === "active" && x.priority === 1).length,
            occupancy: shelters.length ? Math.round(shelters.reduce((sum, sh) => sum + 100 * sh.occupied / sh.capacity, 0) / shelters.length) : null,
            latestAt: reports.length ? Math.max(...reports.map(x => x.createdAt)) : null };
    });
}
export function publicState(s: State, citizenId: string, now = Date.now(), operator = false) {
    const current = alerts(s, now);
    const { safety, accessibleMode, checkins, receipts: _receipts, volunteers, ...visible } = s;
    return {
        ...visible,
        audit: operator ? visible.audit : [],
        decisions: operator ? visible.decisions : [],
        sessionId: citizenId,
        mySafety: safety[citizenId] ?? null,
        safetyCount: Object.keys(safety).length,
        myAccessibleMode: accessibleMode[citizenId] ?? false,
        myCheckin: checkins.find(x => x.citizenId === citizenId) ? (({ shelterId, at }) => ({ shelterId, at }))(checkins.find(x => x.citizenId === citizenId)!) : null,
        myVolunteer: volunteers.find(v=>v.citizenId===citizenId) ? (({citizenId:_owner,phone:_phone,...rest})=>rest)(volunteers.find(v=>v.citizenId===citizenId)!) : null,
        volunteers: volunteers.map(({citizenId:_owner,phone:_phone,...rest})=>rest),
        zones: zoneStats(s),
        sos: s.sos.map(({ citizenId: owner, details, voiceTranscript, ...rest }) => ({
            ...rest,
            ...(operator || owner === citizenId ? { details, voiceTranscript } : {}),
            mine: owner === citizenId,
        })),
        alerts: current.map((a) => ({
            ...a,
            decision: s.decisions.find((d) => d.alertId === a.id),
        })),
        serverTime: now,
    };
}
