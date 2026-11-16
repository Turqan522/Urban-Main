import type { State, CrisisNews, Alert, Road, Point } from "./types";
import { distance } from "./engine";
export function clusterNews(s: State, alert: Alert, now: number): CrisisNews {
  const node=s.nodes.find(n=>n.id===alert.node)!;
  return { id:crypto.randomUUID(), createdAt:now, zone:alert.zone, node:alert.node, sourceId:alert.id, targetRadiusMeters:1000,
    headline:`[${alert.zone}] Təcili xəbərdarlıq`, headlineEn:`[${alert.zone}] Urgent warning`,
    content:`${node.label} yaxınlığında ${alert.sosIds.length} təsdiqli SOS. Ərazidəki vətəndaşlar təhlükəsiz toplanış məntəqəsinə yönəlsin. Könüllü həkimlərə ilk yardım çağırışı.`,
    contentEn:`${alert.sosIds.length} confirmed SOS reports near ${node.label}. Move to a safe assembly point. Trained medical volunteers are requested.`,
    severity:"danger", incidentType:"cluster", author:"Sistem Analitika" };
}
export function roadNews(s: State, road: Road, now: number): CrisisNews {
  const node=s.nodes.find(n=>n.id===road.a)!;
  return { id:crypto.randomUUID(), createdAt:now, zone:node.zone, node:node.id, sourceId:`road:${road.id}:${now}`, targetRadiusMeters:1000,
    headline:`[${node.zone}] Yol bağlanması`, headlineEn:`[${node.zone}] Road closure`,
    content:`${road.name} bağlandı. Xəritədə yenilənmiş marşrutu izləyin.`, contentEn:`${road.name} is closed. Follow the updated evacuation route.`,
    severity:"warning", incidentType:"road", author:"Sistem Analitika" };
}
export function newsForPoint(s: State, point: Point, volunteerId?: string): CrisisNews[] {
  const zone=s.nodes.length ? s.nodes.reduce((a,b)=>distance(a,point)<=distance(b,point)?a:b).zone : "";
  const doctor=!!s.volunteers.find(v=>v.id===volunteerId && v.verified && v.skills.some(skill=>skill==="paramedic"||skill==="first_aid"));
  return s.news.filter(item => { const node=s.nodes.find(n=>n.id===item.node); return item.zone===zone || !!node && distance(node,point)<=item.targetRadiusMeters || doctor && item.incidentType==="cluster" && item.zone===zone; }).sort((a,b)=>b.createdAt-a.createdAt);
}
