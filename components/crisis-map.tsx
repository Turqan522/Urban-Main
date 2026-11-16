"use client";
import { useState } from "react";
import { Compass, Minus, Plus } from "lucide-react";
import { distance, publicState } from "../lib/crisis/engine";
import type { Point, Route, Team } from "../lib/crisis/types";
import { translate, placeName, type Language } from "../lib/i18n";
type View = ReturnType<typeof publicState>;
const xy = (p: Point) => ({ x: 100 + ((p.lng - 49.829) / .027) * 620, y: 500 - ((p.lat - 40.367) / .021) * 370 });
function teamPosition(s: View, team: Team, now: number): Point {
    const nodes = (team.routePath ?? [team.node]).map(id => s.nodes.find(n => n.id === id)!).filter(Boolean);
    if (!nodes.length)
        return s.nodes.find(n => n.id === team.node)!;
    const progress = Math.max(0, Math.min(1, (now - (team.dispatchedAt ?? now)) / ((team.etaMinutes ?? 1) * 60000)));
    const lengths = nodes.slice(1).map((node, i) => distance(nodes[i], node));
    let remaining = lengths.reduce((sum, n) => sum + n, 0) * progress;
    for (let i = 0; i < lengths.length; i++) {
        if (remaining <= lengths[i] && lengths[i] > 0) {
            const ratio = remaining / lengths[i];
            return { lat: nodes[i].lat + (nodes[i + 1].lat - nodes[i].lat) * ratio, lng: nodes[i].lng + (nodes[i + 1].lng - nodes[i].lng) * ratio };
        }
        remaining -= lengths[i];
    }
    return nodes[nodes.length - 1];
}
export default function CrisisMap({ s, lang, point, route, citizen, now, onPoint }: {
    s: View;
    lang: Language;
    point: Point;
    route?: Route;
    citizen: boolean;
    now: number;
    onPoint(p: Point): void;
}) {
    const [zoom, setZoom] = useState(1);
    const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
    const polyline = (ids: string[]) => ids.map(id => xy(s.nodes.find(n => n.id === id)!)).map(p => `${p.x},${p.y}`).join(" ");
    return <section className="panel map-panel">
    <div className="panel-heading"><div><h2>{t("map")}</h2><p>{citizen ? t("mapHint") : t("etaSimulation")}</p></div><span className="tag green">BAKU</span></div>
    <div className="map-canvas">
      <svg viewBox="0 0 850 610" role="group" aria-label={t("mapLabel")}>
        <defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#dce2dc" strokeWidth=".6"/></pattern></defs>
        <rect width="850" height="610" fill="#edf0e9"/><rect width="850" height="610" fill="url(#grid)"/>
        <path d="M790 0C770 130 830 210 767 298C710 390 750 440 644 487C573 531 508 547 458 610H850V0Z" fill="#dce9ed"/>
        <g transform={`translate(${425 * (1 - zoom)},${305 * (1 - zoom)}) scale(${zoom})`}>
          {[0, 1, 2].flatMap(y => [0, 1, 2].map(x => <g key={`${x}-${y}`}><rect x={128 + x * 206} y={157 + y * 123} width="150" height="70" rx="10" fill={(x + y) % 3 === 0 ? "#d8e3cf" : "#e1e4db"}/><path d={`M${140 + x * 206} ${170 + y * 123}h45v18h-45z M${205 + x * 206} ${194 + y * 123}h58v18h-58z`} fill="#d2d8cc"/></g>))}
          {s.roads.map(r => {
            const a = xy(s.nodes.find(n => n.id === r.a)!), b = xy(s.nodes.find(n => n.id === r.b)!);
            return <g key={r.id}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d6dcd3" strokeWidth="19"/><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fffefa" strokeWidth="15"/>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={r.closed ? "#d65a43" : r.accessible ? "#c6cdbd" : "#c7a76c"} strokeWidth={r.closed ? 5 : 2} strokeDasharray={r.closed || !r.accessible ? "8 5" : undefined}/>
            <title>{placeName(lang, r.name)} · {t(r.closed ? "closed" : r.accessible ? "stepFree" : "stairs")}</title>
          </g>;
        })}
          {citizen && route && <polyline points={polyline(route.nodeIds)} fill="none" stroke="#326dba" strokeWidth="7" strokeLinejoin="round"/>}
          {s.teams.filter(team => team.status === "dispatched" && team.routePath).map(team => <polyline key={team.id} points={polyline(team.routePath!)} fill="none" stroke="#238569" strokeWidth="5" strokeDasharray="9 5"/>)}
          {s.nodes.filter((_, i) => i % 4 === 1).map(n => <text key={n.id} x="405" y={xy(n).y - 26} textAnchor="middle" className="zone-label">{n.zone.toLocaleUpperCase(lang)}</text>)}
          {citizen && s.nodes.map(n => <circle key={n.id} cx={xy(n).x} cy={xy(n).y} r="13" fill="#7493a0" fillOpacity=".18" stroke="#7493a0" role="button" tabIndex={0} aria-label={placeName(lang, n.label)} onClick={() => onPoint(n)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onPoint(n);
    } }}><title>{placeName(lang, n.label)}</title></circle>)}
          {s.shelters.map(sh => {
            const p = xy(s.nodes.find(n => n.id === sh.node)!);
            return <g key={sh.id} transform={`translate(${p.x},${p.y})`} pointerEvents="none">
            <circle r="24" fill={sh.open ? "#d7e8df" : "#ddd"}/><rect x="-15" y="-17" width="30" height="34" rx="10" fill={sh.open ? sh.occupied / sh.capacity >= s.config.routeLimit ? "#d86c44" : "#368971" : "#8f9b91"} stroke="white" strokeWidth="3"/>
            <path d="M-6 -5L0 -8L6 -5V2Q4 7 0 9Q-4 7 -6 2Z" stroke="white" strokeWidth="1.8" fill="none"/>
            <text x="23" y="-20" fontSize="13" fontWeight="700" fill="#263239">{sh.open ? `${Math.round(100 * sh.occupied / sh.capacity)}%` : "R"}</text><title>{placeName(lang, sh.name)} · {sh.accessible ? t("stepFree") : t("stairs")}</title>
          </g>;
        })}
          {s.sos.filter(x => x.status === "active").map((x, i) => { const p = xy(x); return <g key={x.id} transform={`translate(${p.x + (i % 3) * 10},${p.y + (i % 2) * 13})`} pointerEvents="none"><circle r="19" fill="#d65a43" opacity=".15"/><circle r="11" fill="#d65a43" stroke="white" strokeWidth="2"/><text y="4" textAnchor="middle" fill="white" fontSize="12">{x.priority ? "♿" : "!"}</text></g>; })}
          {s.teams.map(team => { const p = xy(teamPosition(s, team, now)); return <g key={team.id} transform={`translate(${p.x},${p.y})`} pointerEvents="none"><rect x="-13" y="-10" width="26" height="20" rx="5" fill={team.routeBlocked ? "#d65a43" : "#236c59"} stroke="white" strokeWidth="2"/><text textAnchor="middle" y="5" fill="white" fontSize="13">✚</text><title>{placeName(lang, team.name)} · ETA {team.etaMinutes ?? 0} {t("minutes")}</title></g>; })}
          {citizen && <g transform={`translate(${xy(point).x},${xy(point).y})`} pointerEvents="none"><circle r="23" fill="#4f88d5" opacity=".14"/><circle r="9" fill="#3676ca" stroke="white" strokeWidth="3"/></g>}
        </g><text x="720" y="545" className="sea-label" transform="rotate(-25 720 545)">{t("sea")}</text>
      </svg>
      <div className="map-compass"><Compass size={23}/><span>N</span></div><div className="map-zoom"><button aria-label="Zoom +" onClick={() => setZoom(Math.min(1.5, zoom + .25))}><Plus size={18}/></button><button aria-label="Zoom −" onClick={() => setZoom(Math.max(.75, zoom - .25))}><Minus size={18}/></button></div>
      <div className="map-legend"><span><i className="legend-dot green"/>{t("shelters")}</span><span><i className="legend-dot red"/>SOS</span><span><i className="legend-line"/>{t("closed")}</span></div>
    </div>
  </section>;
}
