"use client";
import { useEffect, useRef, useState } from "react";
import { Bell, Megaphone } from "lucide-react";
import { newsForPoint } from "../lib/crisis/news";
import { publicState } from "../lib/crisis/engine";
import type { Point, State } from "../lib/crisis/types";
import { translate, type Language, type MessageKey } from "../lib/i18n";
type View=ReturnType<typeof publicState>;
export default function NewsFeed({s,point,lang,citizen}: {s:View;point:Point;lang:Language;citizen:boolean}) {
  const t=(key:MessageKey)=>translate(lang,key);
  const news=citizen ? newsForPoint(s as unknown as State,point,s.myVolunteer?.id) : [...s.news].sort((a,b)=>b.createdAt-a.createdAt);
  const [unread,setUnread]=useState(false),last=useRef("");
  useEffect(()=>{const latest=news[0]?.id ?? "";if(last.current && latest && latest!==last.current)setUnread(true);last.current=latest;},[news[0]?.id]);
  return <section className="panel news-panel"><div className="panel-heading"><h2><Megaphone size={18}/>{t("news")}</h2>{unread && <span className="tag red"><Bell size={13}/>{t("zoneNews")}</span>}</div>
    <div className="news-list">{news.length ? news.slice(0,8).map(item=><article key={item.id} className={`news-item ${item.severity}`}><div className="row between"><span className={`tag ${item.severity==="danger"?"red":"amber"}`}>{item.zone}</span><small>{new Date(item.createdAt).toLocaleTimeString(lang==="az"?"az-AZ":"en-GB",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Baku"})}</small></div><h3>{lang==="az"?item.headline:item.headlineEn}</h3><p>{lang==="az"?item.content:item.contentEn}</p><small>{item.author==="Sistem Analitika"?"Urban Crisis Analytics":item.author} · {item.targetRadiusMeters}m</small>{citizen && s.myVolunteer?.verified && item.incidentType==="cluster" && <strong className="medical-call">🚨 {t("medicalCall")}</strong>}</article>) : <p className="empty-text">{t("noNews")}</p>}</div>
  </section>;
}
