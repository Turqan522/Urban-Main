"use client";
import { useEffect, useRef, useState } from "react";
import { distance, publicState } from "../lib/crisis/engine";
import type { Point, Route, Team } from "../lib/crisis/types";
import { translate, placeName, type Language } from "../lib/i18n";

type View = ReturnType<typeof publicState>;
type L = typeof import("leaflet");

function teamPosition(s: View, team: Team, now: number): Point {
  const nodes = (team.routePath ?? [team.node])
    .map((id) => s.nodes.find((n) => n.id === id)!)
    .filter(Boolean);
  if (!nodes.length) return s.nodes.find((n) => n.id === team.node)!;
  const progress = Math.max(
    0,
    Math.min(
      1,
      (now - (team.dispatchedAt ?? now)) / ((team.etaMinutes ?? 1) * 60000)
    )
  );
  const lengths = nodes.slice(1).map((node, i) => distance(nodes[i], node));
  let remaining = lengths.reduce((sum, n) => sum + n, 0) * progress;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const ratio = remaining / lengths[i];
      return {
        lat: nodes[i].lat + (nodes[i + 1].lat - nodes[i].lat) * ratio,
        lng: nodes[i].lng + (nodes[i + 1].lng - nodes[i].lng) * ratio,
      };
    }
    remaining -= lengths[i];
  }
  return nodes[nodes.length - 1];
}

/* ── Marker icon builders (no image assets needed) ─────────── */
function shelterIcon(L: L, sh: View["shelters"][0], config: View["config"]) {
  const pct = Math.round((100 * sh.occupied) / sh.capacity);
  const critical = pct >= config.routeLimit;
  const bg = !sh.open ? "#6b7280" : critical ? "#ef4444" : "#10b981";
  return L.divIcon({
    className: "leaflet-shelter-icon",
    iconSize: [36, 42],
    iconAnchor: [18, 42],
    popupAnchor: [0, -44],
    html: `<div style="position:relative;display:flex;flex-direction:column;align-items:center">
      <span style="position:absolute;top:-18px;font-size:11px;font-weight:700;color:#e2e8f0;background:${bg};padding:1px 5px;border-radius:4px;white-space:nowrap;font-family:'JetBrains Mono',monospace">${sh.open ? pct + "%" : "R"}</span>
      <svg width="36" height="42" viewBox="0 0 36 42"><path d="M18 0C8 0 0 8 0 18c0 14 18 24 18 24s18-10 18-24C36 8 28 0 18 0z" fill="${bg}" stroke="#0f172a" stroke-width="1.5"/>
        <text x="18" y="22" text-anchor="middle" fill="white" font-size="14" font-weight="bold">${sh.accessible ? "♿" : "⛑"}</text>
      </svg>
    </div>`,
  });
}

function sosIcon(L: L, priority: number) {
  return L.divIcon({
    className: "leaflet-sos-icon",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div class="sos-beacon${priority ? " priority" : ""}">
      <span>${priority ? "♿" : "!"}</span>
    </div>`,
  });
}

function teamIcon(L: L, blocked?: boolean) {
  const bg = blocked ? "#ef4444" : "#059669";
  return L.divIcon({
    className: "leaflet-team-icon",
    iconSize: [30, 22],
    iconAnchor: [15, 11],
    html: `<div style="background:${bg};color:white;border:2px solid white;border-radius:6px;width:30px;height:22px;display:grid;place-items:center;font-size:14px;box-shadow:0 2px 6px rgba(0,0,0,.4)">✚</div>`,
  });
}

function citizenIcon(L: L) {
  return L.divIcon({
    className: "leaflet-citizen-icon",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div class="citizen-pulse"><div class="citizen-dot"></div></div>`,
  });
}

/* ── Main component ────────────────────────────────────────── */
export default function RealCrisisMap({
  s,
  lang,
  point,
  route,
  citizen,
  now,
  onPoint,
}: {
  s: View;
  lang: Language;
  point: Point;
  route?: Route;
  citizen: boolean;
  now: number;
  onPoint(p: Point): void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const layersRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const name = (value: string) => placeName(lang, value);

  /* ── Initialise map once ─────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [40.381, 49.845],
        zoom: 14,
        zoomControl: false,
        attributionControl: false,
      });

      /* CartoDB Dark Matter tiles */
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://osm.org/copyright">OSM</a>',
        }
      ).addTo(map);

      L.control.zoom({ position: "topright" }).addTo(map);
      L.control
        .attribution({ position: "bottomleft", prefix: false })
        .addAttribution(
          '&copy; <a href="https://carto.com/">CARTO</a> · <a href="https://osm.org/copyright">OSM</a>'
        )
        .addTo(map);

      const layers = L.layerGroup().addTo(map);
      mapRef.current = map;
      layersRef.current = layers;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layersRef.current = null;
      }
    };
  }, []);

  /* ── Redraw markers on every state change ────────────────── */
  useEffect(() => {
    if (!ready || !mapRef.current || !layersRef.current) return;

    let L: L;
    import("leaflet").then((mod) => {
      L = mod;
      const layers = layersRef.current!;
      const map = mapRef.current!;
      layers.clearLayers();

      /* Roads */
      for (const r of s.roads) {
        const a = s.nodes.find((n) => n.id === r.a)!;
        const b = s.nodes.find((n) => n.id === r.b)!;
        const line = L.polyline(
          [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          {
            color: r.closed
              ? "#ef4444"
              : r.accessible
              ? "rgba(148,163,184,0.45)"
              : "#ca8a04",
            weight: r.closed ? 4 : 2,
            dashArray: r.closed ? "10 6" : r.accessible ? undefined : "6 4",
            interactive: false,
          }
        );
        line.addTo(layers);
      }

      /* Brigade routes (dashed neon green) */
      for (const team of s.teams.filter(
        (t) => t.status === "dispatched" && t.routePath
      )) {
        const pts = team
          .routePath!.map((id) => s.nodes.find((n) => n.id === id)!)
          .filter(Boolean);
        if (pts.length < 2) continue;
        /* Glow layer */
        L.polyline(
          pts.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: "#34d399",
            weight: 8,
            opacity: 0.25,
            interactive: false,
          }
        ).addTo(layers);
        /* Main line */
        L.polyline(
          pts.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: "#10b981",
            weight: 4,
            dashArray: "8 5",
            interactive: false,
          }
        ).addTo(layers);
      }

      /* Citizen evacuation route (neon blue) */
      if (citizen && route) {
        const pts = route.nodeIds
          .map((id) => s.nodes.find((n) => n.id === id)!)
          .filter(Boolean);
        if (pts.length >= 2) {
          /* Glow */
          L.polyline(
            pts.map((p) => [p.lat, p.lng] as [number, number]),
            {
              color: "#60a5fa",
              weight: 10,
              opacity: 0.3,
              interactive: false,
              className: "neon-route",
            }
          ).addTo(layers);
          /* Main */
          L.polyline(
            pts.map((p) => [p.lat, p.lng] as [number, number]),
            {
              color: "#3b82f6",
              weight: 5,
              interactive: false,
              className: "neon-route",
            }
          ).addTo(layers);
        }
      }

      /* Clickable junction nodes (citizen only) */
      if (citizen) {
        for (const n of s.nodes) {
          L.circleMarker([n.lat, n.lng], {
            radius: 7,
            color: "rgba(148,163,184,0.5)",
            fillColor: "rgba(148,163,184,0.15)",
            fillOpacity: 1,
            weight: 1,
            interactive: true,
          })
            .bindTooltip(`${n.zone} · ${name(n.label)}`, {
              className: "dark-tooltip",
            })
            .on("click", () => onPoint(n))
            .addTo(layers);
        }
      }

      /* Shelter markers */
      for (const sh of s.shelters) {
        const node = s.nodes.find((n) => n.id === sh.node)!;
        L.marker([node.lat, node.lng], {
          icon: shelterIcon(L, sh, s.config),
          interactive: true,
        })
          .bindPopup(
            `<div class="dark-popup">
              <strong>${name(sh.name)} ${sh.accessible ? "♿" : ""}</strong><br/>
              <span>${sh.occupied} / ${sh.capacity} (${Math.round(
              (100 * sh.occupied) / sh.capacity
            )}%)</span><br/>
              <small>${t(sh.open ? "roadOpen" : "reserve")} · QR: ${sh.qrCode}</small>
            </div>`,
            { className: "dark-popup-wrapper" }
          )
          .addTo(layers);
      }

      /* SOS beacons (pulsating) */
      for (const x of s.sos.filter((x) => x.status === "active")) {
        L.marker([x.lat, x.lng], {
          icon: sosIcon(L, x.priority),
          interactive: true,
        })
          .bindTooltip(
            `${t(x.type)} SOS · ${x.zone}${
              x.priority ? " · ♿ " + t("priority") : ""
            }`,
            { className: "dark-tooltip" }
          )
          .addTo(layers);
      }

      /* Brigade positions */
      for (const team of s.teams) {
        const pos = teamPosition(s, team, now);
        L.marker([pos.lat, pos.lng], {
          icon: teamIcon(L, team.routeBlocked),
          interactive: true,
        })
          .bindTooltip(
            `${name(team.name)} · ${
              team.status === "dispatched"
                ? `ETA ${team.etaMinutes ?? 0} ${t("minutes")}`
                : t("free")
            }`,
            { className: "dark-tooltip" }
          )
          .addTo(layers);
      }

      /* Citizen position */
      if (citizen) {
        L.marker([point.lat, point.lng], {
          icon: citizenIcon(L),
          interactive: false,
        }).addTo(layers);
      }

      /* Zone labels */
      const zones = [...new Set(s.nodes.map((n) => n.zone))];
      for (const zone of zones) {
        const zoneNodes = s.nodes.filter((n) => n.zone === zone);
        const avgLat =
          zoneNodes.reduce((s, n) => s + n.lat, 0) / zoneNodes.length;
        const avgLng =
          zoneNodes.reduce((s, n) => s + n.lng, 0) / zoneNodes.length;
        L.marker([avgLat, avgLng], {
          icon: L.divIcon({
            className: "leaflet-zone-label",
            iconSize: [120, 20],
            iconAnchor: [60, 10],
            html: `<span>${zone.toLocaleUpperCase(lang)}</span>`,
          }),
          interactive: false,
        }).addTo(layers);
      }
    });
  }, [
    ready,
    s.revision,
    s.updatedAt,
    point.lat,
    point.lng,
    route?.shelter.id,
    now,
    citizen,
    lang,
  ]);

  return (
    <section className="panel map-panel">
      <div className="panel-heading">
        <div>
          <h2>{t("map")}</h2>
          <p>{citizen ? t("mapHint") : t("etaSimulation")}</p>
        </div>
        <span className="tag green">BAKU · LIVE</span>
      </div>
      <div
        ref={containerRef}
        className="leaflet-container-wrapper"
        style={{ height: 480, width: "100%", background: "#1a1a2e" }}
      />
      <div className="map-footer">
        <span>
          <i className="legend-dot green" /> {t("shelters")}
          <i className="legend-dot red" style={{ marginLeft: 12 }} /> SOS
          <i
            className="legend-line"
            style={{ marginLeft: 12, background: "#ef4444" }}
          />{" "}
          {t("closed")}
        </span>
        <small>CartoDB Dark Matter · OSM</small>
      </div>
    </section>
  );
}
