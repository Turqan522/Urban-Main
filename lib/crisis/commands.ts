import type { State, Point, Sos, Audit, VolunteerSkill } from "./types";
import { alerts, distance, nearestNode, shortestPath, teamRoute } from "./engine";
import { seed } from "./seed";
import { matchingVolunteers } from "./volunteers";
import { clusterNews, roadNews } from "./news";
export class AppError extends Error {
    status: number;
    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}
const TYPES = ["fire", "collapse", "flood", "medical"];
function check(v: unknown, message: string): asserts v {
    if (!v)
        throw new AppError(message);
}
export function coordinates(body: Record<string, unknown>): Point {
    const { lat, lng } = body;
    check(typeof lat === "number" &&
        typeof lng === "number" &&
        Number.isFinite(lat) &&
        Number.isFinite(lng), "Koordinat rəqəm olmalıdır.");
    check(lat >= 40.35 && lat <= 40.41 && lng >= 49.81 && lng <= 49.88, "Koordinat simulyasiya ərazisindən kənardadır (40.35–40.41, 49.81–49.88).");
    return { lat, lng };
}
export function command(state: State, action: string, b: Record<string, unknown>, citizenId: string, now = Date.now()): State {
    let s = structuredClone(state);
    s.safety ??= {};
    s.accessibleMode ??= {};
    s.checkins ??= [];
    s.receipts ??= {};
    s.volunteers ??= []; s.volunteerTasks ??= []; s.news ??= [];
    if (b.sessionId !== undefined)
        check(b.sessionId === citizenId, "SESSION_EXPIRED");
    const receipt = typeof b.requestId === "string" ? `${citizenId}:${b.requestId}` : undefined;
    if (b.requestId !== undefined)
        check(typeof b.requestId === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(b.requestId), "Sorğu identifikatoru düzgün deyil.");
    if (receipt && s.receipts[receipt] !== undefined)
        return state;
    const nearestReserve = (node: string) => s.shelters
        .filter(x => x.reserve && !x.open)
        .flatMap(shelter => { const path = shortestPath(s, node, shelter.node); return path ? [{ shelter, meters: path.weightedMeters }] : []; })
        .sort((a, b) => a.meters - b.meters)[0]?.shelter;
    const log = (action: string, detail: string, data?: Audit["data"]) => s.audit.unshift({ id: crypto.randomUUID(), at: now, action, detail, data });
    // Retain acknowledgement only while the actual condition remains active.
    const live = new Set(alerts(s, now).map((a) => a.id));
    s.decisions = s.decisions.filter((d) => live.has(d.alertId));
    if (action === "sos") {
        check(TYPES.includes(String(b.type)), "Təhlükə növü düzgün deyil.");
        const p = coordinates(b);
        let details: Sos["details"];
        if (b.details !== undefined) {
            check(!!b.details && typeof b.details === "object" && !Array.isArray(b.details), "SOS detalları düzgün deyil.");
            const d = b.details as Record<string, unknown>;
            check(d.people === undefined || Number.isInteger(d.people) && Number(d.people) >= 1 && Number(d.people) <= 1000, "İnsan sayı 1–1000 olmalıdır.");
            check(d.injured === undefined || typeof d.injured === "boolean", "Yaralı seçimi düzgün deyil.");
            check(d.setting === undefined || d.setting === "indoors" || d.setting === "outdoors", "Məkan seçimi düzgün deyil.");
            check(d.note === undefined || typeof d.note === "string" && d.note.length <= 300, "Qeyd 300 simvoldan çox ola bilməz.");
            details = { people: d.people as number | undefined, injured: d.injured as boolean | undefined, setting: d.setting as "indoors" | "outdoors" | undefined, note: typeof d.note === "string" ? d.note.trim() : undefined };
        }
        check(distance(p, nearestNode(s, p)) <= 1500, "SOS demo yol şəbəkəsindən çox uzaqdadır.");
        const active = s.sos.find((x) => x.citizenId === citizenId && x.status === "active");
        if (active) {
            if (!receipt)
                return state;
            s.receipts[receipt] = now;
            s.revision = state.revision + 1;
            s.updatedAt = now;
            return s;
        }
        check(s.sos.filter((x) => x.status === "active").length < 1000, "SOS limiti dolub. Operator müdaxiləsi tələb olunur.");
        s.sos = s.sos.filter((x) => x.status === "active" || now - x.createdAt < 24 * 3600000);
        delete s.safety[citizenId];
        s.sos.push({
            ...p,
            id: crypto.randomUUID(),
            citizenId,
            zone: nearestNode(s, p).zone,
            type: b.type as Sos["type"],
            ...(details ? { details } : {}),
            priority: s.accessibleMode[citizenId] ? 1 : 0,
            needsAccessible: !!s.accessibleMode[citizenId],
            ...(typeof b.voiceTranscript === "string" ? { voiceTranscript: b.voiceTranscript.slice(0, 500) } : {}),
            createdAt: now,
            status: "active",
        });
        log("SOS", "Vətəndaşdan yeni SOS siqnalı daxil oldu.");
    }
    else if (action === "accessibility") {
        check(typeof b.enabled === "boolean", "Rejim düzgün deyil.");
        s.accessibleMode[citizenId] = b.enabled;
        s.sos.filter(x => x.citizenId === citizenId && x.status === "active").forEach(x => {
            x.needsAccessible = b.enabled as boolean;
            x.priority = b.enabled ? 1 : 0;
        });
        log("ACCESSIBILITY", b.enabled ? "Maneəsiz marşrut və prioritet rejimi aktivdir." : "Standart marşrut rejimi aktivdir.", { enabled: b.enabled });
    }
    else if (action === "checkin") {
        const sh = s.shelters.find(x => typeof b.qrCode === "string" ? x.qrCode === b.qrCode : x.id === b.shelterId);
        check(sh, "QR kod və ya məntəqə düzgün deyil.");
        if (s.checkins.some(x => x.citizenId === citizenId))
            return state;
        check(sh.open, "Məntəqə bağlıdır.");
        check(sh.occupied < sh.capacity, "Məntəqə tam doludur.");
        sh.occupied += 1;
        s.sos.filter(x => x.citizenId === citizenId && x.status === "active").forEach(x => x.status = "safe");
        s.safety[citizenId] = { at: now, status: "safe", shelterId: sh.id, shareCode: crypto.randomUUID().replaceAll("-", "") };
        s.checkins.push({ citizenId, shelterId: sh.id, at: now });
        log("CHECKIN", `Vətəndaş ${sh.name} məntəqəsinə çatdı (QR). SOS bağlandı.`, { subject: sh.name, occupied: sh.occupied, capacity: sh.capacity });
    }
    else if (action === "safe") {
        const own = s.sos.filter((x) => x.citizenId === citizenId && x.status === "active");
        own.forEach((x) => (x.status = "safe"));
        s.safety[citizenId] = { at: now, status: "safe", shareCode: crypto.randomUUID().replaceAll("-", "") };
        log("SAFE", `${own.length} aktiv SOS təhlükəsiz statusuna keçirildi.`, { count: own.length });
    }
    else if (action === "road") {
        const road = s.roads.find((r) => r.id === b.id);
        check(road, "Yol tapılmadı.");
        check(typeof b.closed === "boolean", "Yolun vəziyyəti düzgün deyil.");
        road.closed = b.closed;
        log("ROAD", `${road.name}: ${road.closed ? "bağlandı" : "açıldı"}`, { subject: road.name, closed: road.closed });
        if(road.closed) s.news.unshift(roadNews(s,road,now));
    }
    else if (action === "occupancy") {
        const sh = s.shelters.find((x) => x.id === b.id);
        check(sh, "Məntəqə tapılmadı.");
        check(Number.isInteger(b.occupied) &&
            Number(b.occupied) >= 0 &&
            Number(b.occupied) <= sh.capacity, "Doluluq tutumdan çox və ya mənfi ola bilməz.");
        sh.occupied = Number(b.occupied);
        log("CAPACITY", `${sh.name}: ${sh.occupied}/${sh.capacity}`, { subject: sh.name, occupied: sh.occupied, capacity: sh.capacity });
    }
    else if (action === "resource-update") {
        const sh=s.shelters.find(x=>x.id===b.id);check(sh,"Məntəqə tapılmadı.");
        const fields={waterLiters:sh.resources.waterMax,foodRations:sh.resources.foodMax,medicalKits:sh.resources.medicalMax,batteryPercent:100};
        check(Object.keys(b).some(k=>k in fields) && Object.keys(b).every(k=>k==="id"||k in fields),"Resurs sahəsi düzgün deyil.");
        for(const [key,max] of Object.entries(fields)) if(b[key]!==undefined){check(Number.isFinite(b[key])&&Number(b[key])>=0&&Number(b[key])<=max,`${key}: 0–${max} aralığında olmalıdır.`);(sh.resources as unknown as Record<string,number>)[key]=Number(b[key]);}
        log("RESOURCE",`${sh.name} ehtiyatları yeniləndi.`,{subject:sh.name});
    }
    else if (action === "resource-resupply") {
        const sh=s.shelters.find(x=>x.id===b.id);check(sh,"Məntəqə tapılmadı.");
        if(sh.resources.waterLiters===sh.resources.waterMax && sh.resources.foodRations===sh.resources.foodMax && sh.resources.medicalKits===sh.resources.medicalMax && sh.resources.batteryPercent===100)return state;
        sh.resources.waterLiters=sh.resources.waterMax;sh.resources.foodRations=sh.resources.foodMax;sh.resources.medicalKits=sh.resources.medicalMax;sh.resources.batteryPercent=100;sh.resources.lastSuppliedAt=now;
        log("RESUPPLY",`${sh.name} üçün təchizat karvanı göndərildi.`,{subject:sh.name});
    }
    else if (action === "volunteer-register") {
        check(!s.volunteers.some(v=>v.citizenId===citizenId),"Könüllü artıq qeydiyyatdan keçib.");
        check(typeof b.name==="string"&&b.name.trim().length>=2&&b.name.trim().length<=60,"Könüllü adı düzgün deyil.");
        check(typeof b.phone==="string"&&/^[+0-9 ()-]{7,24}$/.test(b.phone),"Telefon nömrəsi düzgün deyil.");
        check(Array.isArray(b.skills)&&b.skills.length>0&&b.skills.length<=4&&b.skills.every(x=>["first_aid","paramedic","fire_response","rescue"].includes(x)),"Bacarıq düzgün deyil.");
        const location=coordinates(b);
        s.volunteers.push({id:crypto.randomUUID(),citizenId,name:b.name.trim(),phone:b.phone,skills:[...new Set(b.skills as VolunteerSkill[])],verified:false,available:false,location,status:"idle"});
        log("VOLUNTEER",`${b.name} könüllü kimi qeydiyyatdan keçdi.`,{subject:b.name.trim()});
    }
    else if (action === "volunteer-verify") {
        const v=s.volunteers.find(x=>x.id===b.id);check(v,"Könüllü tapılmadı.");check(typeof b.verified==="boolean","Təsdiq vəziyyəti düzgün deyil.");
        check(!v.activeTaskId,"Aktiv tapşırığı olan könüllünün təsdiqi dəyişdirilə bilməz.");v.verified=b.verified;if(!v.verified)v.available=false;
        log("VERIFY",`${v.name}: ${v.verified?"təsdiqləndi":"təsdiq ləğv edildi"}.`,{subject:v.name});
    }
    else if (action === "volunteer-ready") {
        const v=s.volunteers.find(x=>x.citizenId===citizenId);check(v&&v.verified,"Təsdiqli könüllü profili tələb olunur.");
        check(!v.activeTaskId,"Aktiv tapşırıq bitməlidir.");v.available=b.available===true;v.status="idle";
        if(b.lat!==undefined||b.lng!==undefined)v.location=coordinates(b);
        log("VOLUNTEER",`${v.name}: ${v.available?"hazırdır":"əlçatan deyil"}.`,{subject:v.name});
    }
    else if (action === "volunteer-dispatch") {
        const sos=s.sos.find(x=>x.id===b.sosId);check(sos&&sos.status==="active"&&sos.type==="medical","Aktiv tibbi SOS tapılmadı.");
        check(!s.volunteerTasks.some(t=>t.sosId===sos.id&&t.status!=="completed"),"SOS üçün könüllü artıq təyin edilib.");
        const candidate=matchingVolunteers(s,sos).find(x=>x.volunteer.id===b.volunteerId);check(candidate,"Yaxınlıqda təsdiqli, hazır və maneəsiz yol ilə çatan könüllü yoxdur.");
        const task={id:crypto.randomUUID(),sosId:sos.id,volunteerId:candidate.volunteer.id,status:"pending_acceptance" as const,assignedAt:now,routePath:candidate.routePath,meters:candidate.meters};
        s.volunteerTasks.push(task);candidate.volunteer.activeTaskId=task.id;candidate.volunteer.available=false;candidate.volunteer.status="assigned";
        log("VOLUNTEER_DISPATCH",`${candidate.volunteer.name} tibbi SOS-a dəvət edildi. Peşəkar briqada gözlənilir.`,{subject:candidate.volunteer.name});
    }
    else if (action === "volunteer-status") {
        const v=s.volunteers.find(x=>x.citizenId===citizenId);check(v&&v.activeTaskId,"Aktiv könüllü tapşırığı yoxdur.");
        const task=s.volunteerTasks.find(x=>x.id===v.activeTaskId)!;
        const transitions:{[key:string]:string}={pending_acceptance:"en_route",en_route:"on_scene",on_scene:"completed"};
        check(b.status===transitions[task.status],"Könüllü status keçidi düzgün deyil.");
        task.status=b.status as typeof task.status;
        if(task.status==="en_route"){task.acceptedAt=now;v.status="en_route";}
        if(task.status==="on_scene"){task.arrivedAt=now;v.status="on_scene";}
        if(task.status==="completed"){task.completedAt=now;v.status="completed";delete v.activeTaskId;}
        log("VOLUNTEER_STATUS",`${v.name}: ${task.status}. Peşəkar yardım ayrıca davam edir.`,{subject:v.name});
    }
    else if (action === "sos-view") {
        const incident = s.sos.find(x => x.id === b.id && x.status === "active");
        check(incident, "Aktiv SOS tapılmadı.");
        incident.viewedAt ??= now;
    }
    else if (action === "sos-dispatch") {
        const incident = s.sos.find(x => x.id === b.id && x.status === "active");
        check(incident, "Aktiv SOS tapılmadı.");
        check(!incident.assignedTeam, "Bu SOS üçün artıq briqada təyin edilib.");
        const team = s.teams.find(x => x.id === b.teamId);
        check(team && team.status === "available", "Seçilən briqada sərbəst deyil.");
        const target = nearestNode(s, incident).id;
        const path = teamRoute(s, team, target);
        check(path, "Bu briqada üçün əlçatan demo marşrutu yoxdur.");
        team.status = "dispatched"; team.incidentId = `sos:${incident.id}`;
        team.targetNode = target; team.etaMinutes = path.etaMinutes;
        team.routePath = path.nodeIds; team.routeMeters = Math.round(path.meters);
        team.dispatchedAt = now; team.routeBlocked = false;
        incident.viewedAt ??= now; incident.assignedAt = now; incident.assignedTeam = team.id;
        log("DISPATCH", `${team.name} → ${incident.zone}. Fərdi SOS üçün operator qərarı.`, {subject: team.name, target: incident.zone});
    }
    else if (action === "confirm") {
        if (s.decisions.some((d) => d.alertId === b.id))
            return state;
        const alert = alerts(s, now).find((x) => x.id === b.id);
        check(alert, "Xəbərdarlıq artıq aktiv deyil.");
        if (alert.kind === "cluster") {
            const ranked = s.teams
                .filter((t) => t.status === "available")
                .flatMap((t) => {
                const p = teamRoute(s, t, alert.node);
                return p ? [{ team: t, meters: p.weightedMeters, path: p }] : [];
            })
                .sort((a, b) => a.meters - b.meters);
            check(ranked.length, "Əlçatan sərbəst briqada yoxdur. Yol və briqada vəziyyətini yoxlayın.");
            const team = ranked[0].team;
            team.status = "dispatched";
            team.incidentId = alert.id;
            team.targetNode = alert.node;
            team.etaMinutes = ranked[0].path.etaMinutes;
            team.routePath = ranked[0].path.nodeIds;
            team.routeMeters = Math.round(ranked[0].path.meters);
            team.dispatchedAt = now;
            team.routeBlocked = false;
            const reserve = nearestReserve(alert.node);
            if (reserve) {
                reserve.open = true;
                log("OPEN", `${reserve.name} operator tərəfindən açıldı.`, { subject: reserve.name });
            }
            s.sos
                .filter((x) => alert.sosIds.includes(x.id))
                .forEach((x) => (x.assignedTeam = team.id));
            s.decisions.push({
                alertId: alert.id,
                at: now,
                teamId: team.id,
                shelterId: reserve?.id,
                sosIds: alert.sosIds,
            });
            log("DISPATCH", `${team.name} → ${alert.zone}. Operator qərarı təsdiqlədi.`, { subject: team.name, target: alert.zone });
            if(!s.news.some(item=>item.sourceId===alert.id))s.news.unshift(clusterNews(s,alert,now));
        }
        else if(alert.kind==="resource") {
            const sh=s.shelters.find(x=>x.id===alert.shelterId)!;
            sh.resources.waterLiters=sh.resources.waterMax;sh.resources.foodRations=sh.resources.foodMax;sh.resources.medicalKits=sh.resources.medicalMax;sh.resources.batteryPercent=100;sh.resources.lastSuppliedAt=now;
            log("RESUPPLY",`${sh.name} üçün təchizat karvanı göndərildi.`,{subject:sh.name});
        }
        else {
            const reserve = nearestReserve(alert.node);
            check(reserve, "Əlçatan ehtiyat məntəqə yoxdur. Yeni məntəqə əlavə edilməlidir.");
            reserve.open = true;
            s.decisions.push({
                alertId: alert.id,
                at: now,
                shelterId: reserve.id,
                sosIds: [],
            });
            log("OPEN", `${reserve.name} operator tərəfindən açıldı.`, { subject: reserve.name });
        }
    }
    else if (action === "team-complete") {
        const team = s.teams.find((x) => x.id === b.id);
        check(team && team.status === "dispatched", "Briqada aktiv tapşırıqda deyil.");
        s.sos
            .filter((x) => x.assignedTeam === team.id && x.status === "active")
            .forEach((x) => { x.status = "resolved"; x.completedAt = now; });
        team.status = "available";
        delete team.incidentId;
        delete team.targetNode;
        delete team.routePath;
        delete team.etaMinutes;
        delete team.routeMeters;
        delete team.dispatchedAt;
        delete team.routeBlocked;
        log("COMPLETE", `${team.name}: tapşırıq bitdi, briqada sərbəstdir.`, { subject: team.name });
    }
    else if (action === "scenario") {
        check(["cluster", "capacity", "blocked", "resource", "volunteer", "reset"].includes(String(b.name)), "Ssenari tanınmır.");
        if (b.name === "reset") {
            s = seed(now);
            log("RESET", "Demo ilkin vəziyyətə qaytarıldı.");
        }
        if (b.name === "cluster") {
            for (let i = 0; i < 5; i++) {
                s.sos.push({
                    id: crypto.randomUUID(),
                    citizenId: `sim-${crypto.randomUUID()}`,
                    zone: s.nodes[5].zone,
                    lat: s.nodes[5].lat + i * 0.0001,
                    lng: s.nodes[5].lng,
                    type: TYPES[i % 4] as Sos["type"],
                    priority: 0,
                    needsAccessible: false,
                    createdAt: now - i * 15000,
                    status: "active",
                });
            }
            s.scenario = "5 SOS / 5 dəqiqə";
            log("SIMULATION", "5 fərqli simulyasiya vətəndaşından SOS yaradıldı.");
        }
        if (b.name === "capacity") {
            s.shelters[0].occupied = Math.ceil(s.shelters[0].capacity * 0.97);
            s.scenario = "97% doluluq";
            log("SIMULATION", "Sahil məntəqəsinin doluluğu 97%-ə qaldırıldı.");
        }
        if (b.name === "blocked") {
            const road = s.roads.find((r) => r.id === b.roadId) ?? s.roads[0];
            road.closed = true;
            s.scenario = "Yol bağlanması";
            log("SIMULATION", `${road.name} bağlandı.`);
            s.news.unshift(roadNews(s,road,now));
        }
        if(b.name==="resource") {s.shelters[1].resources.waterLiters=Math.floor(s.shelters[1].resources.waterMax*.12);s.scenario="Kritik su çatışmazlığı";log("SIMULATION","Mərkəzi Park su ehtiyatı 12%-ə endirildi.");}
        if (b.name === "volunteer") {
            s = seed(now);
            for (const team of s.teams) {
                const node = s.nodes.find(x => x.id === team.node)!;
                const id = crypto.randomUUID();
                s.sos.push({ id, citizenId: `sim-${id}`, zone: node.zone, lat: node.lat, lng: node.lng, type: "fire", priority: 0, needsAccessible: false, createdAt: now, status: "active", assignedTeam: team.id });
                team.status = "dispatched";
                team.incidentId = id;
                team.targetNode = node.id;
                team.routePath = [node.id];
                team.routeMeters = 0;
                team.etaMinutes = 1;
                team.dispatchedAt = now;
            }
            const medicalNode = s.nodes[5];
            s.sos.push({ id: crypto.randomUUID(), citizenId: `sim-${crypto.randomUUID()}`, zone: medicalNode.zone, lat: medicalNode.lat, lng: medicalNode.lng, type: "medical", priority: 0, needsAccessible: false, createdAt: now, status: "active" });
            s.scenario = "Briqadalar məşğuldur / tibbi SOS";
            log("SIMULATION", "Üç briqada məşğuldur; tibbi SOS üçün könüllü dəstəyi tələb olunur.");
        }
        check(s.sos.filter((x) => x.status === "active").length <= 1000, "Demo SOS limiti dolub. İlkin vəziyyətə qaytarın.");
    }
    else if (action === "config" || action === "rules") {
        const limits: Record<string, [
            number,
            number
        ]> = {
            windowSeconds: [30, 1800],
            sosThreshold: [2, 50],
            radiusMeters: [50, 2000],
            routeLimit: [50, 95],
            alertLimit: [90, 100],
        };
        check(Object.keys(b).length > 0 && Object.keys(b).every((k) => k in limits), "Naməlum qayda.");
        for (const [k, v] of Object.entries(b)) {
            const [min, max] = limits[k];
            check(Number.isInteger(v) && Number(v) >= min && Number(v) <= max, `${k}: ${min}–${max} aralığında tam ədəd olmalıdır.`);
            (s.config as unknown as Record<string, number>)[k] = Number(v);
        }
        check(s.config.routeLimit <= s.config.alertLimit, "Marşrut həddi kritik xəbərdarlıq həddindən böyük ola bilməz.");
        log("CONFIG", "Analitika qaydaları operator tərəfindən yeniləndi.");
    }
    else
        throw new AppError("Əməliyyat tapılmadı.", 404);
    // A safe/check-in citizen must not keep an otherwise empty rescue assignment alive.
    for (const team of s.teams.filter(t => t.status === "dispatched")) {
        if (!s.sos.some(x => x.assignedTeam === team.id && x.status === "active")) {
            team.status = "available";
            delete team.incidentId;
            delete team.targetNode;
            delete team.routePath;
            delete team.etaMinutes;
            delete team.routeMeters;
            delete team.dispatchedAt;
            delete team.routeBlocked;
        }
        else if ((action === "road" || (action === "scenario" && b.name === "blocked")) && team.targetNode) {
            const path = teamRoute(s, team, team.targetNode);
            team.routeBlocked = !path;
            team.routePath = path?.nodeIds;
            team.etaMinutes = path?.etaMinutes;
            team.routeMeters = path ? Math.round(path.meters) : undefined;
            team.dispatchedAt = now;
        }
    }
    for (const alert of alerts(s, now)) {
        const decision = s.decisions.find((d) => d.alertId === alert.id);
        if (decision?.teamId &&
            s.teams.some((t) => t.id === decision.teamId && t.status === "dispatched")) {
            s.sos
                .filter((x) => alert.sosIds.includes(x.id) && !x.assignedTeam)
                .forEach((x) => (x.assignedTeam = decision.teamId));
            decision.sosIds = [...new Set([...decision.sosIds, ...alert.sosIds])];
        }
    }
    s.safety = Object.fromEntries(Object.entries(s.safety)
        .filter(([, v]) => now - v.at < 86400000)
        .slice(-1000));
    s.audit = s.audit.slice(0, 200);
    s.news=s.news.slice(0,100);s.volunteerTasks=s.volunteerTasks.slice(-200);
    if (receipt)
        s.receipts[receipt] = now;
    s.decisions = s.decisions.slice(-100);
    s.revision = state.revision + 1;
    s.updatedAt = now;
    return s;
}
