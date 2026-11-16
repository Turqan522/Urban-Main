"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownToLine, Check, ChevronRight, Clock, FileText, Flame, HandHeart, HeartPulse, House, LayoutDashboard, LocateFixed, MapPin, Mic, Navigation, Play, Radio, RefreshCw, Route as RouteIcon, Settings2, Shield, ShieldCheck, Siren, TriangleAlert, Truck, Users, Waves, X } from "lucide-react";
import { compareIncidentDisplay } from "../lib/crisis/presentation";
import { routes, publicState } from "../lib/crisis/engine";
import { migratePublicState } from "../lib/crisis/migrate";
import type { Config, Point, State, Route } from "../lib/crisis/types";
import { DEFAULT_CONFIG } from "../lib/crisis/seed";
import { translate, placeName, errorText, auditDetail, messages, type Language, type MessageKey } from "../lib/i18n";
import { classifyVoice, speechConstructor, type SpeechInstance } from "../lib/voice";
import { enqueue, flushQueue, readQueue, removeQueued, SNAPSHOT_KEY, type QueuedAction } from "../lib/offline";
import CrisisMap from "../components/crisis-map";
import RealMap from "../components/real-map";
import CheckinDialog from "../components/checkin-dialog";
import VolunteerPanel from "./ui-volunteers";
import NewsFeed from "./ui-news";
import ResourcePanel from "./ui-resources";
type View = ReturnType<typeof publicState> & {
    alreadyCheckedIn?: boolean;
    security?: { highSosFlow: boolean; rateScope: string };
};
type AuthSession = { token: string; role: "operator" | "admin"; expiresAt: number };
type Tab = "overview" | "shelters" | "roads" | "reports" | "settings";
const nav = [{ id: "overview", Icon: LayoutDashboard }, { id: "shelters", Icon: Shield }, { id: "roads", Icon: RouteIcon }, { id: "reports", Icon: FileText }, { id: "settings", Icon: Settings2 }] as const;
const hazards = [{ id: "fire", Icon: Flame }, { id: "collapse", Icon: House }, { id: "flood", Icon: Waves }, { id: "medical", Icon: HeartPulse }] as const;
const limits: {
    key: keyof Config;
    min: number;
    max: number;
}[] = [{ key: "windowSeconds", min: 30, max: 1800 }, { key: "sosThreshold", min: 2, max: 50 }, { key: "radiusMeters", min: 50, max: 2000 }, { key: "routeLimit", min: 50, max: 95 }, { key: "alertLimit", min: 90, max: 100 }];
class ApiError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
async function request(path: string, body?: Record<string, unknown>): Promise<View> {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const token = typeof window !== "undefined" ? localStorage.getItem("urban-crisis-operator-token") : null;
        const r = await fetch(`/api/${path}`, { cache: "no-store", signal: controller.signal, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
        const data = await r.json() as View & {
            error?: string;
        };
        if (!r.ok)
            throw new ApiError(data.error || "Request failed", r.status);
        return data;
    }
    finally {
        clearTimeout(timeout);
    }
}
export default function CrisisApp() {
    const [realMap, setRealMap] = useState(true);
    const [lookupCode, setLookupCode] = useState("");
    const [lookupResult, setLookupResult] = useState("");
    const [people, setPeople] = useState("");
    const [injured, setInjured] = useState("");
    const [place, setPlace] = useState("");
    const [sosNote, setSosNote] = useState("");
    const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
    const [selectedHazard, setSelectedHazard] = useState<(typeof hazards)[number]["id"]>("medical");
    const [s, setS] = useState<View | null>(null), [lang, setLang] = useState<Language>("az"), [mode, setMode] = useState<"dispatch" | "citizen">("dispatch"), [tab, setTab] = useState<Tab>("overview");
    const [point, setPoint] = useState<Point>({ lat: 40.374, lng: 49.838 }), [online, setOnline] = useState(true), [lastSync, setLastSync] = useState(0), [now, setNow] = useState(0);
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState<MessageKey | "">(""), [demo, setDemo] = useState(false), [coord, setCoord] = useState(false), [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
    const [queue, setQueue] = useState<QueuedAction[]>([]), [queueError, setQueueError] = useState(""), [listening, setListening] = useState(false), [transcript, setTranscript] = useState(""), [qrOpen, setQrOpen] = useState(false), [qrCode, setQrCode] = useState("");
    const [remoteRoutes,setRemoteRoutes]=useState<{key:string;revision:number;routes:Route[]}|null>(null);
    const [auth,setAuth]=useState<AuthSession|null>(null),[username,setUsername]=useState("operator"),[password,setPassword]=useState(""),[floodResult,setFloodResult]=useState<{total:number;counts:Record<string,number>;limiterAverageMs:number}|null>(null);
    const current = useRef<View | null>(null), syncing = useRef(false), acting = useRef(false), paused = useRef(false), recognition = useRef<SpeechInstance | null>(null), priorRoute = useRef(""), priorPoint = useRef(""), clockOffset = useRef(0), mounted = useRef(true);
    const t = (key: MessageKey) => translate(lang, key), name = (value: string) => placeName(lang, value);
    const time = (at: number) => new Date(at).toLocaleTimeString(lang === "az" ? "az-AZ" : "en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Baku" });
    function refreshQueue() { const q = readQueue(localStorage); if (mounted.current)
        setQueue(q); return q; }
    function apply(value: View) {
        if (!mounted.current)
            return;
        migratePublicState(value);
        if (!current.current || value.revision >= current.current.revision || value.sessionId !== current.current.sessionId) {
            current.current = value;
            setS(value);
            try {
                if (!localStorage.getItem("urban-crisis-operator-token")) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ view: value, at: Date.now() }));
            }
            catch { /* Queue writes report storage errors separately. */ }
        }
        clockOffset.current = value.serverTime - Date.now();
        setLastSync(Date.now());
        setOnline(true);
    }
    async function syncQueue() {
        if (syncing.current || paused.current || !navigator.onLine)
            return;
        syncing.current = true;
        const run = async () => {
            try {
                await flushQueue(localStorage, async (item) => {
                    const value = await request(item.path, { ...item.body, requestId: item.id });
                    apply(value);
                    if (mounted.current)
                        setNotice(item.path === "checkin" ? value.alreadyCheckedIn ? "already" : "arrived" : "success");
                });
                if (mounted.current)
                    setQueueError("");
            }
            catch (e) {
                if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 409) {
                    paused.current = true;
                    if (mounted.current)
                        setQueueError(e.message);
                }
                else if (mounted.current)
                    setOnline(false);
            }
            finally {
                try {
                    refreshQueue();
                }
                catch {
                    if (mounted.current)
                        setError("storageError");
                }
            }
        };
        try {
            if (navigator.locks)
                await navigator.locks.request("urban-crisis-queue", run);
            else
                await run();
        }
        finally {
            syncing.current = false;
        }
    }
    useEffect(() => {
        mounted.current = true;
        try {
            const cached = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
            if (cached?.view?.sessionId && Array.isArray(cached.view.zones) && Array.isArray(cached.view.shelters)) {
                const view = migratePublicState(cached.view);
                current.current = view;
                setS(view);
                setLastSync(cached.at);
                setOnline(false);
            }
            const savedLang = localStorage.getItem("urban-crisis-language");
            if (savedLang === "az" || savedLang === "en")
                setLang(savedLang);
            const savedPoint = JSON.parse(localStorage.getItem("urban-crisis-point") || "null");
            if (savedPoint && validPoint(savedPoint))
                setPoint(savedPoint);
            refreshQueue();
            const token = localStorage.getItem("urban-crisis-operator-token");
            if (token) void fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }).then(async response => {
                if (!response.ok) { localStorage.removeItem("urban-crisis-operator-token"); return; }
                const session = await response.json() as Omit<AuthSession,"token">;
                if (mounted.current) setAuth({ ...session, token });
            }).catch(() => {});
        }
        catch {
            setError("storageError");
        }
        let stopped = false, polling = false;
        const poll = async () => {
            if (polling || stopped)
                return;
            polling = true;
            try {
                const value = await request("state");
                if (!stopped) {
                    apply(value);
                    await syncQueue();
                }
            }
            catch {
                if (!stopped)
                    setOnline(false);
            }
            finally {
                polling = false;
            }
        };
        const offline = () => setOnline(false), storage = () => { try {
            refreshQueue();
        }
        catch {
            setError("storageError");
        } };
        void poll();
        const timer = setInterval(poll, 3000), tick = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
        window.addEventListener("online", poll);
        window.addEventListener("offline", offline);
        window.addEventListener("storage", storage);
        if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
            navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then(reg => {
                reg.active?.postMessage({ type: "CACHE_ASSETS", urls: performance.getEntriesByType("resource").map(entry => entry.name) });
            }).catch(() => { if (!stopped)
                setError("offlineCacheError"); });
        }
        return () => { stopped = true; mounted.current = false; clearInterval(timer); clearInterval(tick); window.removeEventListener("online", poll); window.removeEventListener("offline", offline); window.removeEventListener("storage", storage); recognition.current?.abort(); };
    }, []);
    useEffect(() => { document.documentElement.lang = lang; try {
        localStorage.setItem("urban-crisis-language", lang);
    }
    catch { } }, [lang]);
    useEffect(() => { try {
        localStorage.setItem("urban-crisis-point", JSON.stringify(point));
    }
    catch { } }, [point]);
    useEffect(() => { if (s)
        setConfig(s.config); }, [s?.config.windowSeconds, s?.config.sosThreshold, s?.config.radiusMeters, s?.config.routeLimit, s?.config.alertLimit]);
    const queuedMode = [...queue].reverse().find(item => item.path === "accessibility" && item.body.sessionId === s?.sessionId);
    const accessible = queuedMode ? !!queuedMode.body.enabled : !!s?.myAccessibleMode;
    const queryKey=`${point.lat},${point.lng},${accessible}`;
    const routeList = s ? remoteRoutes?.key===queryKey && remoteRoutes.revision===s.revision ? remoteRoutes.routes : routes(s as unknown as State, point, accessible).slice(0, 3) : [], best = routeList[0];
    async function loadRoute(simulate?:"503"|"timeout") {
        if(!s || !navigator.onLine)return;
        const params=new URLSearchParams({lat:String(point.lat),lng:String(point.lng),accessible:String(accessible)});
        if(simulate)params.set("external",simulate);
        try {const response=await fetch(`/api/routes?${params}`,{cache:"no-store",signal:AbortSignal.timeout(7000)});
            if(!response.ok)return;
            const data=await response.json() as {routes:Route[];revision:number;routing:{source:string}};
            setRemoteRoutes({key:queryKey,revision:data.revision,routes:data.routes});
        } catch { /* Existing local route remains available while offline. */ }
    }
    useEffect(()=>{void loadRoute();},[queryKey,s?.serverTime,online]);
    const routeKey = best ? `${best.shelter.id}:${best.roadIds.join(",")}` : "none";
    useEffect(() => {
        if (!s)
            return;
        const key = `${point.lat},${point.lng}`;
        if (priorRoute.current && priorPoint.current === key && priorRoute.current !== routeKey)
            setNotice("rerouted");
        priorRoute.current = routeKey;
        priorPoint.current = key;
    }, [routeKey, point.lat, point.lng, s?.revision]);
    async function citizenAction(path: QueuedAction["path"], body: Record<string, unknown>) {
        if (!current.current || acting.current)
            return;
        acting.current = true;
        setBusy(true);
        setError("");
        try {
            const item: QueuedAction = { id: crypto.randomUUID(), path, body: { ...body, sessionId: current.current.sessionId }, createdAt: Date.now() };
            const save = async () => { enqueue(localStorage, item); refreshQueue(); };
            if (navigator.locks)
                await navigator.locks.request("urban-crisis-queue", save);
            else
                await save();
            setNotice("queuedNotice");
            await syncQueue();
        }
        catch {
            setError("storageError");
        }
        finally {
            acting.current = false;
            setBusy(false);
        }
    }
    async function act(path: string, body: Record<string, unknown>) {
        if (acting.current)
            return;
        if ((path === "config" || path === "rules") && auth?.role !== "admin") return setError("adminOnly");
        if (["confirm","road","occupancy","team-complete","scenario","volunteer-verify","volunteer-dispatch","resource-update","resource-resupply"].includes(path) && !auth) return setError("loginRequired");
        acting.current = true;
        setBusy(true);
        setError("");
        try {
            apply(await request(path, body));
            setNotice("success");
        }
        catch (e) {
            if (e instanceof ApiError && e.status === 401) { setAuth(null); localStorage.removeItem("urban-crisis-operator-token"); }
            setError(e instanceof ApiError ? e.message : "networkError");
        }
        finally {
            acting.current = false;
            setBusy(false);
        }
    }
    async function loginOperator(event: React.FormEvent) {
        event.preventDefault();
        setError("");
        try {
            const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
            const data = await response.json() as AuthSession & { error?: string };
            if (!response.ok) throw new ApiError(data.error || "Login failed", response.status);
            localStorage.setItem("urban-crisis-operator-token", data.token);
            setAuth(data); setPassword("");
        } catch (error) { setError(error instanceof ApiError ? error.message : "networkError"); }
    }
    function logoutOperator() { localStorage.removeItem("urban-crisis-operator-token"); setAuth(null); setFloodResult(null); }
    async function floodDemo() {
        if (!auth) return setError("loginRequired");
        try {
            const response = await fetch("/api/security-demo", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.token}` }, body: "{}" });
            const data = await response.json() as { total:number; counts:Record<string,number>; limiterAverageMs:number; error?:string };
            if (!response.ok) throw new ApiError(data.error || "Demo failed", response.status);
            setFloodResult(data);
        } catch (error) { setError(error instanceof ApiError ? error.message : "networkError"); }
    }
    function useLocation() {
        if (!navigator.geolocation)
            return setError("gpsError");
        navigator.geolocation.getCurrentPosition(p => { const value = { lat: p.coords.latitude, lng: p.coords.longitude }; if (validPoint(value))
            setPoint(value);
        else
            setError("bounds"); }, () => setError("gpsError"), { timeout: 10000 });
    }
    function voice() {
        if (listening) {
            recognition.current?.abort();
            setListening(false);
            return;
        }
        const Constructor = speechConstructor();
        if (!Constructor)
            return setError("voiceUnsupported");
        const recognizer = new Constructor();
        recognition.current = recognizer;
        recognizer.lang = lang === "az" ? "az-AZ" : "en-US";
        recognizer.continuous = false;
        recognizer.interimResults = false;
        let handled = false;
        recognizer.onresult = event => {
            if (handled)
                return;
            handled = true;
            const text = event.results[0][0].transcript, type = classifyVoice(text);
            setTranscript(text);
            setListening(false);
            if (type)
                void citizenAction("sos", { ...point, type, voiceTranscript: text });
            else
                setError("voiceUnknown");
        };
        recognizer.onerror = () => { setListening(false); setError("voiceError"); };
        recognizer.onend = () => setListening(false);
        try {
            recognizer.start();
            setListening(true);
            setError("");
        }
        catch {
            setError("voiceError");
        }
    }
    const active = s?.sos.filter(x => x.status === "active").sort(compareIncidentDisplay) ?? [];
    const pending = s?.alerts.filter(a => !a.decision) ?? [], criticalPending=pending.filter(a=>a.kind!=="resource"), mine = active.find(x => x.mine), open = s?.shelters.filter(sh => sh.open) ?? [];
    const myTeam = mine?.assignedTeam ? s?.teams.find(team => team.id === mine.assignedTeam) : undefined;
    const myVolunteerTask = mine ? s?.volunteerTasks.find(task => task.sosId === mine.id && task.status !== "completed") : undefined;
    const sosQueued = queue.some(x => x.path === "sos" && x.body.sessionId === s?.sessionId);
    const displayError = (value: string) => value === "SESSION_EXPIRED" ? t("sessionExpired") : value in messages ? t(value as MessageKey) : errorText(lang, value);
    const exportLog = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ at: new Date().toISOString(), mode: "simulation", audit: s?.audit, config: s?.config }, null, 2)], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "urban-crisis-audit.json";
        a.click();
        URL.revokeObjectURL(url);
    };
    return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/"><span className="brand-mark"><Activity size={25}/></span><span>urban<span className="brand-light">crisis</span><small>EVACUATION ENGINE</small></span></a>
      <div className="workspace"><MapPin size={20}/><div><strong>{t("city")}</strong><small>DEMO · BAKU</small></div></div>
      <nav>{nav.map(({ id, Icon }) => <button key={id} aria-label={t(id)} className={`nav-link ${tab === id && mode === "dispatch" ? "active" : ""}`} onClick={() => { setTab(id); setMode("dispatch"); }}><Icon size={18}/><span>{t(id)}</span></button>)}</nav>
      <div className="side-card"><Radio size={22}/><strong>{t("city")}</strong><p>{t("intro")}</p><button onClick={() => setDemo(!demo)}>{t("demo")} <ChevronRight size={15}/></button></div>
      <div className="operator"><span>OP</span><div><strong>{t("dispatch")}</strong><small>{t("simulation")}</small></div></div>
    </aside>
    <main><header className="topbar"><div className="crumb"><span>Urban Crisis</span><ChevronRight size={14}/><strong>{t(mode === "citizen" ? "citizen" : tab)}</strong></div><div className="top-actions"><span className={`connection ${online ? "" : "offline"}`}><i />{t(online ? "online" : "offline")}</span><button className="btn light small" onClick={() => setLang(lang === "az" ? "en" : "az")} aria-label="AZ / EN">{lang.toUpperCase()} / {lang === "az" ? "EN" : "AZ"}</button></div></header>
      <div className="content"><div className="page-heading"><div><div className="eyebrow"><span className="orange-line"/>{t("platform")}</div><h1>{t(mode === "citizen" ? "citizenHeadline" : "headline")}</h1><p>{t(mode === "citizen" ? "citizenIntro" : "intro")}</p></div><button className="btn dark" onClick={() => setDemo(!demo)}><Play size={15}/>{t("demo")}</button></div>
        <div className="toolbar"><div className="mode-tabs"><button className={mode === "dispatch" ? "selected" : ""} onClick={() => setMode("dispatch")}><LayoutDashboard size={15}/>{t("dispatch")}</button><button className={mode === "citizen" ? "selected" : ""} onClick={() => { setMode("citizen"); setTab("overview"); }}><ShieldCheck size={15}/>{t("citizen")}</button></div><span className="simulation"><span />{t("simulation")}</span></div>
        {mode === "dispatch" && (!auth ? <form className="operator-login" onSubmit={loginOperator}><strong>{t("operatorLogin")}</strong><label>{t("username")}<input value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" required/></label><label>{t("password")}<input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" required/></label><button className="btn dark" type="submit">{t("login")}</button></form> : <div className="operator-session"><span>{auth.role === "admin" ? t("adminRole") : t("operatorRole")}</span><button className="btn light small" onClick={logoutOperator}>{t("logout")}</button></div>)}
        {mode === "dispatch" && s?.security?.highSosFlow && <div className="alert-banner warning" role="status"><TriangleAlert size={18}/>{t("floodBanner")}</div>}
        {floodResult && mode === "dispatch" && <div className="alert-banner warning" role="status"><TriangleAlert size={18}/>{t("floodResult")}: {floodResult.total} · {t("accepted")}: {floodResult.counts.accepted} · 503: {floodResult.counts.RATE_GLOBAL} · {t("limiterAverage")}: {floodResult.limiterAverageMs.toFixed(2)} ms</div>}
        {!online && <div className="alert-banner error" role="status"><TriangleAlert size={18}/>{t("stale")}</div>}
        {error && <div className="alert-banner error" role="alert"><TriangleAlert size={18}/><span>{displayError(error)}</span><button aria-label={t("close")} onClick={() => setError("")}><X size={17}/></button></div>}
        {notice && <div className="alert-banner success" role="status"><Check size={18}/><span>{t(notice)}</span><button aria-label={t("close")} onClick={() => setNotice("")}><X size={17}/></button></div>}
        {queue.length > 0 && <section className="queue-panel" aria-live="polite"><strong>{t("queued")}: {queue.length}</strong><span>{queueError ? `${t("queueBlocked")} ${displayError(queueError)}` : t("queuedNotice")}</span><button className="btn light small" onClick={() => { paused.current = false; void syncQueue(); }}>{t("sync")}</button>{queueError && <button className="btn light small" onClick={async () => { const remove = async () => { const first = readQueue(localStorage)[0]; if (first)
        removeQueued(localStorage, first.id); refreshQueue(); }; try {
        if (navigator.locks)
            await navigator.locks.request("urban-crisis-queue", remove);
        else
            await remove();
        paused.current = false;
        setQueueError("");
        void syncQueue();
    }
    catch {
        setError("storageError");
    } }}>{t("discard")}</button>}</section>}
        {!s ? <div className="loading"><RefreshCw className="spin"/><h2>{t("loading")}</h2><p>{t("noCache")}</p></div> : <>
          {demo && <section className="demo-panel"><div><span className="tag amber">DEMO LAB · SIMULATION</span><h3>{t("demo")}</h3><p>{lang === "az" ? "Təqdimat: vətəndaş SOS göndərir → operator klasteri təsdiqləyir → briqada yönləndirilir → yol və ya doluluq dəyişdikdə alternativ marşrut göstərilir → vətəndaş təhlükəsiz olduğunu bildirir." : "Demo: citizen sends SOS → operator confirms the cluster → a team is dispatched → a route changes → citizen reports safe."}</p><p>{lang === "az" ? "Ayrı brauzer profillərindən istifadə edin. Ssenari düymələri operator girişi tələb edir; sıfırlama demo məlumatlarını dəyişir." : "Use separate browser profiles. Scenario controls require operator login; reset changes demo data."}</p></div><div className="demo-buttons">{([{ name: "cluster", key: "clusterDemo", Icon: Siren }, { name: "capacity", key: "capacityDemo", Icon: Users }, { name: "blocked", key: "blockDemo", Icon: RouteIcon }, { name: "resource", key: "resourceDemo", Icon: Truck }, { name: "volunteer", key: "volunteerDemo", Icon: HandHeart }, { name: "reset", key: "reset", Icon: RefreshCw }] as const).map(({ name: scenario, key, Icon }) => <button key={scenario} disabled={busy || !online || !auth} onClick={() => act("scenario", { name: scenario, roadId: best?.roadIds[0] })}><Icon size={18}/><strong>{t(key)}</strong></button>)}</div><div className="row wrap"><button className="btn light small" onClick={() => loadRoute("503")}>{t("routingDemo")}</button><button className="btn light small" onClick={() => loadRoute("timeout")}>{t("timeoutDemo")}</button><button className="btn light small" disabled={!auth} onClick={floodDemo}>{t("floodDemo")}</button></div></section>}
          <div className={`metrics ${mode === "citizen" ? "citizen-metrics" : ""}`}>{[{ key: "active", value: active.length, Icon: Siren, color: "orange" }, { key: "critical", value: criticalPending.length, Icon: TriangleAlert, color: "red" }, { key: "open", value: open.length, Icon: ShieldCheck, color: "green" }, { key: "available", value: `${s.teams.filter(team => team.status === "available").length} / ${s.teams.length}`, Icon: Truck, color: "blue" }].map(({ key, value, Icon, color }) => <section className="metric" key={key}><div className="row between"><span>{t(key as MessageKey)}</span><span className={`metric-icon ${color}`}><Icon size={19}/></span></div><div className="metric-value">{value}</div></section>)}</div>
          {mode === "citizen" && <><div className="quick-actions" aria-label={lang === "az" ? "Təcili əməliyyatlar" : "Emergency actions"}><button className="btn danger" onClick={() => document.getElementById("citizen-sos")?.scrollIntoView({behavior:"smooth",block:"center"})}><Siren size={20}/>{t("send")}</button><button className="btn safe-button" onClick={() => document.getElementById("citizen-routes")?.scrollIntoView({behavior:"smooth",block:"start"})}><Navigation size={20}/>{lang === "az" ? "Təhlükəsiz məntəqəyə get" : "Find a safe place"}</button><button className="btn light" disabled={busy} onClick={() => citizenAction("safe", {})}><ShieldCheck size={20}/>{t("safe")}</button></div><section className="citizen-controls" id="citizen-sos"><div className="grow"><label htmlFor="location">{t("location")}</label><div className="row"><MapPin size={18}/><select id="location" value={s.nodes.reduce((a, b) => Math.hypot(a.lat - point.lat, a.lng - point.lng) < Math.hypot(b.lat - point.lat, b.lng - point.lng) ? a : b).id} onChange={e => { const n = s.nodes.find(n => n.id === e.target.value)!; setPoint({ lat: n.lat, lng: n.lng }); }}>{s.nodes.map(n => <option key={n.id} value={n.id}>{n.zone} · {name(n.label)}</option>)}</select><button className="icon-btn" aria-label={t("gps")} title={t("gps")} onClick={useLocation}><LocateFixed size={18}/></button><button className="btn light small" onClick={() => setCoord(!coord)}>{t("coordinates")}</button></div><small>{point.lat.toFixed(5)}, {point.lng.toFixed(5)}</small>
            {coord && <form className="coordinate-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget), p = { lat: Number(f.get("lat")), lng: Number(f.get("lng")) }; if (!validPoint(p))
                return setError("bounds"); setPoint(p); setCoord(false); }}><input aria-label={t("latitude")} name="lat" type="number" step="any" min="40.35" max="40.41" defaultValue={point.lat} required/><input aria-label={t("longitude")} name="lng" type="number" step="any" min="49.81" max="49.88" defaultValue={point.lng} required/><button className="btn dark">{t("apply")}</button></form>}
            <label className="accessibility-control"><input type="checkbox" checked={accessible} disabled={busy} onChange={e => citizenAction("accessibility", { enabled: e.target.checked })}/><span>♿ {t("accessible")}</span></label>{accessible && <><span className="tag red">{t("priority")}</span><p className="help-text">{t("accessibleRoute")}</p></>}
          </div><div className="sos-controls"><div className="danger-types">{hazards.map(({ id, Icon }) => <button key={id} disabled={busy || !!mine || sosQueued} aria-pressed={selectedHazard === id} className={selectedHazard === id ? "selected-hazard" : ""} onClick={() => setSelectedHazard(id)}><Icon size={18}/>{t(id)}</button>)}</div><details className="sos-details"><summary>{lang === "az" ? "Əlavə məlumat (istəyə bağlı)" : "Extra details (optional)"}</summary><label>{lang === "az" ? "İnsan sayı" : "People"}<input type="number" min="1" max="1000" value={people} onChange={e=>setPeople(e.target.value)}/></label><label>{lang === "az" ? "Yaralı varmı?" : "Anyone injured?"}<select value={injured} onChange={e=>setInjured(e.target.value)}><option value="">—</option><option value="yes">{lang === "az" ? "Bəli" : "Yes"}</option><option value="no">{lang === "az" ? "Xeyr" : "No"}</option></select></label><label>{lang === "az" ? "Məkan" : "Location"}<select value={place} onChange={e=>setPlace(e.target.value)}><option value="">—</option><option value="indoors">{lang === "az" ? "Bina içi" : "Indoors"}</option><option value="outdoors">{lang === "az" ? "Küçə" : "Outdoors"}</option></select></label><label>{lang === "az" ? "Qısa qeyd" : "Short note"}<textarea maxLength={300} value={sosNote} onChange={e=>setSosNote(e.target.value)}/></label></details><div className="row wrap"><button className="btn danger" disabled={busy || !!mine || sosQueued || (people !== "" && (!Number.isInteger(Number(people)) || Number(people) < 1 || Number(people) > 1000))} onClick={() => citizenAction("sos", { ...point, type: selectedHazard, details: { ...(people ? {people:Number(people)} : {}), ...(injured ? {injured:injured === "yes"} : {}), ...(place ? {setting:place} : {}), ...(sosNote.trim() ? {note:sosNote.trim()} : {}) } })}><Siren size={18}/>{t(mine ? "sent" : sosQueued ? "queued" : "send")}</button><button className="btn light" disabled={busy || !!mine || sosQueued} onClick={voice}><Mic size={17}/>{t(listening ? "listening" : "voice")}</button><button className="btn safe-button" disabled={busy} onClick={() => citizenAction("safe", {})}><ShieldCheck size={17}/>{t("safe")}</button></div>{transcript && <p className="help-text">“{transcript}”</p>}
            <div className="row wrap"><button className="btn light" onClick={() => { setQrCode(best?.shelter.qrCode ?? ""); setQrOpen(true); }}>{t("checkin")}</button>{s.mySafety && <span className="tag green">{t("safeStatus")}{s.mySafety.shelterId ? ` · ${name(s.shelters.find(sh => sh.id === s.mySafety?.shelterId)?.name ?? "")}` : ""}</span>}</div></div></section>{(mine || sosQueued || s.mySafety) && <section className="panel sos-status" aria-live="polite"><div className="status-heading"><div className="status-symbol"><Siren size={22}/></div><div><span className="status-overline">{lang === "az" ? "MÜRACİƏTİNİZ" : "YOUR REQUEST"}</span><h2>{lang === "az" ? "SOS vəziyyəti" : "SOS status"}</h2></div><span className="status-demo">{lang === "az" ? "SİMULYASİYA" : "SIMULATION"}</span></div><div className="status-body"><strong>{sosQueued ? (lang === "az" ? "Bağlantı gözlənilir — hələ göndərilməyib" : "Waiting for connection — not yet sent") : mine ? (mine.assignedTeam ? (lang === "az" ? "Briqada təyin edilib" : "Team assigned") : (lang === "az" ? "SOS qəbul edilib · yardım gözlənilir" : "SOS received · awaiting help")) : (lang === "az" ? "Təhlükəsiz statusu qeydə alınıb" : "Safe status recorded")}</strong>{mine && <p>{t(mine.type)} · {mine.zone} · {time(mine.createdAt)}{mine.assignedTeam ? ` · ${name(s.teams.find(team => team.id === mine.assignedTeam)?.name ?? "")}` : ""}</p>}{myTeam && <p>{myTeam.routeBlocked ? t("routeBlocked") : `${t("dispatched")} · ${t("etaSimulation")}: ${Math.max(0, Math.ceil(((myTeam.dispatchedAt ?? now) + (myTeam.etaMinutes ?? 0) * 60000 - (now || s.serverTime)) / 60000))} ${t("minutes")}`}</p>}{myVolunteerTask && <p>{lang === "az" ? "Könüllü dəstəyi" : "Volunteer support"}: {t(myVolunteerTask.status)}{myVolunteerTask.meters != null ? ` · ${myVolunteerTask.meters} m` : ""}</p>}<small>{lang === "az" ? "Bu demo real xidmətə çağırış göndərmir." : "This demo does not contact emergency services."}</small></div></section>}</>}
          {mode === "citizen" && <div className="citizen-support-grid"><section className="panel support-card emergency-card"><div className="support-heading"><div className="support-icon emergency-icon"><HeartPulse size={21}/></div><div><span className="support-eyebrow">{lang === "az" ? "REAL FÖVQƏLADƏ HAL" : "REAL EMERGENCY"}</span><h2>{lang === "az" ? "Təcili yardım" : "Emergency assistance"}</h2></div></div><p>{lang === "az" ? "Bu tətbiq real SOS göndərmir. Fövqəladə vəziyyətdə 112-yə zəng edin və rəsmi xidmətlərin göstərişlərinə əməl edin." : "This app does not send real SOS calls. In an emergency, call 112 and follow official responders’ instructions."}</p><div className="support-actions"><a className="emergency-call" href="tel:112"><Siren size={17}/> {lang === "az" ? "112-yə zəng et" : "Call 112"}</a><a className="support-link" href="https://fhn.gov.az/az/elaqe/112-zeng-merkezi" target="_blank" rel="noreferrer">{lang === "az" ? "FHN məlumatı" : "Official guidance"} <ChevronRight size={15}/></a></div></section>
          <section className="panel support-card safety-card"><div className="support-heading"><div className="support-icon safety-icon"><ShieldCheck size={21}/></div><div><span className="support-eyebrow">{lang === "az" ? "YAXINLARINIZ ÜÇÜN" : "FOR LOVED ONES"}</span><h2>{lang === "az" ? "Təhlükəsizlik kodu" : "Safety code"}</h2></div></div><p>{lang === "az" ? "Demo kodunu yalnız güvəndiyiniz şəxslə paylaşın. Kod 24 saat keçərlidir və yalnız təhlükəsiz statusunu göstərir." : "Share this demo code only with trusted people. It expires after 24 hours and reveals only a safe status."}</p>{s.mySafety?.shareCode && <><code className="safety-code">{s.mySafety.shareCode}</code><p>{lang === "az" ? "Yeni SOS göndərdikdə əvvəlki kod etibarsız olur." : "A new SOS invalidates the previous code."}</p></>}<form className="safety-lookup" onSubmit={async e=>{e.preventDefault();try {const response = await fetch("/api/safety-lookup", {method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify({code:lookupCode})});if(!response.ok)throw new Error();const data = await response.json() as {status:string};setLookupResult(data.status === "safe" ? (lang === "az" ? "Demo təhlükəsiz statusu qeydə alınıb." : "Demo safe status recorded.") : (lang === "az" ? "Kod tapılmadı və ya vaxtı bitib." : "Code not found or expired."));}catch{setLookupResult(lang === "az" ? "Yoxlama alınmadı. Bağlantını yoxlayın." : "Lookup failed. Check your connection.");}}}><label htmlFor="safety-lookup-code">{lang === "az" ? "Kodu daxil edin" : "Enter code"}</label><div className="safety-input-row"><input id="safety-lookup-code" autoComplete="off" spellCheck={false} placeholder={lang === "az" ? "Təhlükəsizlik kodu" : "Safety code"} value={lookupCode} maxLength={32} onChange={e=>setLookupCode(e.target.value)} /><button className="btn dark" type="submit">{lang === "az" ? "Yoxla" : "Check"}</button></div></form>{lookupResult && <p className="lookup-result" role="status">{lookupResult}</p>}</section></div>}
          {mode === "dispatch" && criticalPending.length > 0 && <div className="red-alert" role="alert"><Siren size={24}/><div><strong>{t("redAlert")} · {criticalPending.length}</strong><p>{t("proposal")}</p></div></div>}
          {(tab === "overview" || mode === "citizen") && <><div className="main-grid"><div><button className="btn light small" onClick={() => setRealMap(!realMap)}>{realMap ? (lang === "az" ? "Demo sxemə keç" : "Show demo diagram") : (lang === "az" ? "Real xəritəyə keç" : "Show real map")}</button>{realMap ? <RealMap s={s} lang={lang} point={point} route={best} citizen={mode === "citizen"} onPoint={p => setPoint({lat:p.lat,lng:p.lng})}/> : <CrisisMap s={s} lang={lang} point={point} route={best} citizen={mode === "citizen"} now={now || s.serverTime} onPoint={p => setPoint({ lat: p.lat, lng: p.lng })}/>}</div><aside className="right-stack">{mode === "citizen" ? <section className="panel alternatives" id="citizen-routes"><div className="panel-heading"><h2>{t("nearest")}</h2><Navigation size={17}/></div>{routeList.length ? routeList.map((r, i) => <div className="alternative" key={r.shelter.id}><div className="row between"><span className="route-number">{i + 1}</span><span className="tag green">{r.occupancy}% {t("occupied")}</span></div><strong>{name(r.shelter.name)}</strong><small>{r.minutes} {t("minutes")} · {(r.meters / 1000).toFixed(2)} km {accessible ? "· ♿" : ""}</small>{i === 0 && <><span className="recommended"><Check size={12}/>{t("recommended")}</span><small>{lang === "az" ? `Açıq məntəqə · ${r.occupancy}% dolu${accessible ? " · maneəsiz rejim" : ""}` : `Open shelter · ${r.occupancy}% occupied${accessible ? " · step-free mode" : ""}`}</small></>}</div>) : <p className="empty-text">{t("noRoute")}</p>}</section> : <section className="panel alerts-panel"><div className="panel-heading"><h2>{t("critical")}</h2><Radio size={17}/></div><div className="alert-list">{s.alerts.length ? s.alerts.map(a => <div className={`incident ${a.decision ? "confirmed" : ""}`} key={a.id}><div className="row between"><span className={`tag ${a.decision ? "green" : a.kind === "resource" ? "amber" : "red"}`}>{t(a.decision ? "confirmed" : a.kind === "resource" ? "resource" : "redAlert")}</span><small>{a.zone}</small></div><h3>{t(a.kind)}</h3>{a.hasPriority && <span className="tag red">♿ {t("priority")}</span>}<p>{a.kind === "cluster" ? `${a.sosIds.length} ${t("uniqueCitizens")} · ${s.config.windowSeconds}s · ${s.config.radiusMeters}m` : name(s.shelters.find(sh => sh.id === a.shelterId)?.name ?? "")}</p><p>{t(a.kind === "cluster" ? "proposal" : a.kind === "resource" ? "supplyAlert" : "openReserve")}</p><button className="btn danger" disabled={busy || !!a.decision || !online} onClick={() => act("confirm", { id: a.id })}><Check size={15}/>{t(a.decision ? "confirmed" : a.kind === "resource" ? "resupply" : "confirm")}</button></div>) : <div className="empty-alert"><ShieldCheck size={29}/><strong>{t("noAlerts")}</strong><button onClick={() => setDemo(true)}>{t("demo")}</button></div>}</div></section>}
            <section className="panel"><div className="panel-heading"><h2>{t("shelters")}</h2><Shield size={17}/></div>{s.shelters.map(sh => <div className={`shelter-row ${!sh.open ? "muted" : ""}`} key={sh.id}><div className="place-icon"><Shield size={17}/></div><div className="grow"><div className="row between"><strong>{name(sh.name)} {sh.accessible ? "♿" : ""}</strong><span className={`tag ${sh.open ? "green" : "neutral"}`}>{sh.open ? `${Math.round(100 * sh.occupied / sh.capacity)}%` : t("reserve")}</span></div><small>{sh.occupied} / {sh.capacity} · {sh.accessible ? "♿" : ""} · 💧 {sh.resources.waterLiters > 0 ? (lang === "az" ? "su var" : "water") : (lang === "az" ? "su yoxdur" : "no water")} · 🩺 {sh.resources.medicalKits > 0 ? (lang === "az" ? "tibbi dəst var" : "medical kits") : (lang === "az" ? "tibbi dəst yoxdur" : "no kits")} · DEMO</small><div className="progress"><i style={{ width: `${100 * sh.occupied / sh.capacity}%` }}/></div></div></div>)}</section></aside></div>
            {mode === "dispatch" && <><div className="operations-grid"><section className="panel"><div className="panel-heading"><h2>{t("teams")}</h2><Truck size={18}/></div>{s.teams.map(team => <div className="team-card" key={team.id}><div className="row between"><strong>{name(team.name)}</strong><span className={`tag ${team.status === "available" ? "green" : "blue"}`}>{t(team.status === "available" ? "free" : "dispatched")}</span></div><small>{name(team.specialty)}</small>{team.status === "dispatched" && <><p>{team.routeBlocked ? t("routeBlocked") : `ETA: ${Math.max(0, Math.ceil(((team.dispatchedAt ?? now) + (team.etaMinutes ?? 0) * 60000 - (now || s.serverTime)) / 60000))} ${t("minutes")} · ${team.routeMeters ?? 0} m`}</p><small>{t("etaSimulation")}</small><button className="btn light small" disabled={busy || !online} onClick={() => act("team-complete", { id: team.id })}>{t("complete")}</button></>}</div>)}</section><section className="panel"><div className="panel-heading"><h2>{t("feed")}</h2><Siren size={18}/></div><p className="help-text">{lang === "az" ? "Görünüş sırası: xüsusi ehtiyac, tibbi müraciət, sonra vaxt. Bu, tibbi triage və ya avtomatik qərar deyil." : "Display order: accessibility priority, medical reports, then time. This is not medical triage or an automatic decision."}</p><div className="incident-feed">{active.length ? active.map(x => <div className={`feed-row ${x.priority ? "priority-row" : ""}`} key={x.id}><button className="btn light small" onClick={() => setSelectedIncident(selectedIncident === x.id ? null : x.id)}>{lang === "az" ? "Detallara bax" : "View details"}</button><div className="row between"><strong>{x.priority ? "♿ " : ""}{t(x.type)} {x.mine ? `· ${t("mine")}` : ""}</strong><small>{time(x.createdAt)}</small></div><small>{x.zone} · {t(x.assignedTeam ? "dispatched" : "waiting")}{x.assignedTeam ? ` · ${name(s.teams.find(team => team.id === x.assignedTeam)?.name ?? "")}` : ""}</small>{x.priority === 1 && <span className="tag red">{t("priority")}</span>}{x.type === "medical" && <span className="tag amber">{t("medical")}</span>}{selectedIncident === x.id && <div className="incident-details">{!auth ? <p>{lang === "az" ? "Detallar üçün operator girişi tələb olunur." : "Operator login required for details."}</p> : <><p>{x.details?.people ? `${lang === "az" ? "İnsan sayı" : "People"}: ${x.details.people}` : ""}</p><p>{x.details?.injured === undefined ? "" : `${lang === "az" ? "Yaralı" : "Injured"}: ${x.details.injured ? (lang === "az" ? "Bəli" : "Yes") : (lang === "az" ? "Xeyr" : "No")}`}</p><p>{x.details?.setting === "indoors" ? (lang === "az" ? "Bina içi" : "Indoors") : x.details?.setting === "outdoors" ? (lang === "az" ? "Küçə" : "Outdoors") : ""}</p><p>{x.details?.note || (lang === "az" ? "Qeyd yoxdur" : "No note")}</p></>}</div>}</div>) : <p className="empty-text">{t("noEvents")}</p>}</div></section></div><section className="panel zone-panel"><div className="panel-heading"><h2>{t("zones")}</h2></div><div className="table-scroll"><table><thead><tr><th>{t("zone")}</th><th>{t("active")}</th><th>♿</th><th>{t("average")}</th><th>{t("latest")}</th></tr></thead><tbody>{s.zones.map(z => <tr key={z.zone}><td>{z.zone}</td><td>{z.activeSos}</td><td>{z.prioritySos}</td><td>{z.occupancy === null ? "—" : `${z.occupancy}%`}</td><td>{z.latestAt ? time(z.latestAt) : "—"}</td></tr>)}</tbody></table></div></section></>}
          </>}
          {(mode === "citizen" || tab === "overview") && <div className="expansion-grid"><VolunteerPanel s={s} point={point} lang={lang} citizen={mode === "citizen"} busy={busy} online={online} act={act}/><NewsFeed s={s} point={point} lang={lang} citizen={mode === "citizen"}/></div>}
          {mode === "dispatch" && (tab === "overview" || tab === "shelters") && <ResourcePanel shelters={s.shelters} lang={lang} busy={busy} online={online} act={act}/>}
          {mode === "dispatch" && tab === "shelters" && <section className="panel"><div className="panel-heading"><h2>{t("shelters")}</h2></div><div className="shelter-grid">{s.shelters.map(sh => <article className="shelter-detail" key={sh.id}><h3>{name(sh.name)} {sh.accessible ? "♿" : ""}</h3><p>{t(sh.open ? "roadOpen" : "reserve")} · {sh.occupied}/{sh.capacity}</p><code>{sh.qrCode}</code><form className="row" onSubmit={e => { e.preventDefault(); void act("occupancy", { id: sh.id, occupied: Number(new FormData(e.currentTarget).get("occupied")) }); }}><input key={`${sh.id}:${sh.occupied}`} aria-label={`${name(sh.name)} ${t("occupied")}`} name="occupied" type="number" min="0" max={sh.capacity} defaultValue={sh.occupied} required/><button className="btn dark small" disabled={busy || !online}>{t("apply")}</button></form></article>)}</div></section>}
          {mode === "dispatch" && tab === "roads" && <section className="panel"><div className="panel-heading"><h2>{t("roads")}</h2></div><div className="table-scroll"><table><thead><tr><th>{t("roads")}</th><th>{t("stepFree")}</th><th>{t("apply")}</th></tr></thead><tbody>{s.roads.map(r => <tr key={r.id}><td>{name(r.name)}</td><td>{t(r.accessible ? "stepFree" : "stairs")}</td><td><button className={`btn small ${r.closed ? "danger" : "light"}`} disabled={busy || !online} onClick={() => act("road", { id: r.id, closed: !r.closed })}>{t(r.closed ? "closed" : "roadOpen")}</button></td></tr>)}</tbody></table></div></section>}
          {mode === "dispatch" && tab === "reports" && <section className="panel"><div className="panel-heading"><h2>{t("reports")}</h2><button className="btn light small" onClick={exportLog}><ArrowDownToLine size={16}/>{t("export")}</button></div><div className="audit-list">{s.audit.map(a => <div className="feed-row" key={a.id}><div className="row between"><strong>{t((`audit${a.action}` in messages ? `audit${a.action}` : "reports") as MessageKey)}</strong><small>{time(a.at)}</small></div><p>{auditDetail(lang, a)}</p></div>)}</div></section>}
          {mode === "dispatch" && tab === "settings" && <section className="panel settings-panel"><div className="panel-heading"><h2>{t("settings")}</h2><Settings2 size={18}/></div><form className="settings-form" onSubmit={e => { e.preventDefault(); void act("config", config); }}><div className="config-grid">{limits.map(f => <label key={f.key}>{t(f.key)}<input type="number" min={f.min} max={f.max} required value={config[f.key]} onChange={e => setConfig({ ...config, [f.key]: Number(e.target.value) })}/><small>{f.min}–{f.max}</small></label>)}</div><div className="row wrap"><button className="btn dark" disabled={busy || !online}>{t("save")}</button><button type="button" className="btn light" onClick={() => setConfig({ ...DEFAULT_CONFIG })}>{t("defaults")}</button></div><p className="help-text">{t("ruleHelp")}</p></form></section>}
          <footer><span><Activity size={14}/>URBAN CRISIS · {t("simulation")}</span><span><Clock size={13}/> {lastSync ? time(lastSync) : "—"}</span></footer>
        </>}
      </div>
    </main>
    {qrOpen && s && <CheckinDialog shelters={s.shelters} initialCode={qrCode} lang={lang} busy={busy} onClose={() => setQrOpen(false)} onCheckin={code => { void citizenAction("checkin", { qrCode: code }); }}/>}
    {busy && <div className="saving" role="status"><RefreshCw size={14} className="spin"/>{t("sync")}</div>}
  </div>;
}
function validPoint(p: Point) { return Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 40.35 && p.lat <= 40.41 && p.lng >= 49.81 && p.lng <= 49.88; }
