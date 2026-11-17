"use client";
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownToLine, Check, ChevronRight, Clock, FileText, Flame, HandHeart, HeartPulse, House, LayoutDashboard, LocateFixed, MapPin, Mic, Navigation, Play, Radio, RefreshCw, Route as RouteIcon, Settings2, Shield, ShieldCheck, Siren, TriangleAlert, Truck, Users, Waves, X } from "lucide-react";
import { compareIncidentDisplay } from "../lib/crisis/presentation";
import { locationStatus, type LocationFix } from "../lib/crisis/live-location";
import { routes, publicState, nearestNode, teamRoute } from "../lib/crisis/engine";
import { migratePublicState } from "../lib/crisis/migrate";
import type { Config, Point, State, Route } from "../lib/crisis/types";
import { DEFAULT_CONFIG } from "../lib/crisis/seed";
import { translate, placeName, errorText, auditDetail, messages, type Language, type MessageKey } from "../lib/i18n";
import { classifyVoice, speechConstructor, type SpeechInstance } from "../lib/voice";
import { enqueue, flushQueue, readQueue, removeQueued, SNAPSHOT_KEY, type QueuedAction } from "../lib/offline";
import CrisisMap from "../components/crisis-map";
import { DemoWalkthrough, ImpactPanel, ShelterJourney, playSosTone } from "../components/crisis-experience";
import RealMap from "../components/real-map";
import CheckinDialog from "../components/checkin-dialog";
import VolunteerPanel from "./ui-volunteers";
import NewsFeed from "./ui-news";
import ResourcePanel from "./ui-resources";
import OperatorRequests from "./operator-requests";
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
    const [guided, setGuided] = useState(false);
    const [soundEnabled, setSoundEnabled] = useState(true);
    const [soundPulse, setSoundPulse] = useState(false);
    const [journeyId, setJourneyId] = useState<string | null>(null);
    const [shareStatus, setShareStatus] = useState("");
    const [operatorStatus, setOperatorStatus] = useState("");
    const [accountName, setAccountName] = useState<string | null>(null);
    const [accountMode, setAccountMode] = useState<"login" | "register">("login");
    const [accountUsername, setAccountUsername] = useState("");
    const [accountPassword, setAccountPassword] = useState("");
    const [accountError, setAccountError] = useState("");
    const [accountBusy, setAccountBusy] = useState(false);
    const [tracking, setTracking] = useState(false);
    const [gpsFix, setGpsFix] = useState<LocationFix | null>(null);
    const [gpsProblem, setGpsProblem] = useState("");
    const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
    const watchId = useRef<number | null>(null);
    const [realMap, setRealMap] = useState(true);
    const [lookupCode, setLookupCode] = useState("");
    const [lookupResult, setLookupResult] = useState("");
    const [people, setPeople] = useState("");
    const [injured, setInjured] = useState("");
    const [place, setPlace] = useState("");
    const [sosNote, setSosNote] = useState("");
    const [selectedTeam, setSelectedTeam] = useState("");
    const [dispatchSound, setDispatchSound] = useState(false);
    const [newAlert, setNewAlert] = useState<string | null>(null);
    const knownIncidents = useRef<Set<string> | null>(null);
    const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
    const [selectedHazard, setSelectedHazard] = useState<(typeof hazards)[number]["id"]>("medical");
    const [s, setS] = useState<View | null>(null), [lang, setLang] = useState<Language>("az"), [mode, setMode] = useState<"dispatch" | "citizen">("citizen"), [tab, setTab] = useState<Tab>("overview");
    const [point, setPoint] = useState<Point>({ lat: 40.374, lng: 49.838 }), [online, setOnline] = useState(true), [lastSync, setLastSync] = useState(0), [now, setNow] = useState(0);
    const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState<MessageKey | "">(""), [demo, setDemo] = useState(false), [coord, setCoord] = useState(false), [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
    const [queue, setQueue] = useState<QueuedAction[]>([]), [queueError, setQueueError] = useState(""), [listening, setListening] = useState(false), [transcript, setTranscript] = useState(""), [qrOpen, setQrOpen] = useState(false), [qrCode, setQrCode] = useState("");
    const [remoteRoutes,setRemoteRoutes]=useState<{key:string;revision:number;routes:Route[]}|null>(null);
    const [auth,setAuth]=useState<AuthSession|null>(null),[username,setUsername]=useState(""),[password,setPassword]=useState(""),[floodResult,setFloodResult]=useState<{total:number;counts:Record<string,number>;limiterAverageMs:number}|null>(null);
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
        if (new URLSearchParams(window.location.search).get("panel") === "dispatch") setMode("dispatch");
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
                if (mounted.current && localStorage.getItem("urban-crisis-operator-token") === token) setAuth({ ...session, token });
            }).catch(() => {});
        }
        catch {
            setError("storageError");
        }
        void fetch("/api/account/me", {cache:"no-store"}).then(async response => response.ok ? response.json() as Promise<{username:string | null;operatorStatus?:string}> : null).then(data => { if (mounted.current) { setAccountName(data?.username ?? null); setOperatorStatus(data?.operatorStatus ?? ""); } }).catch(()=>{});
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
    const gpsStatus = locationStatus(gpsFix, s?.nodes ?? [], Date.now());
    const origin: Point = tracking && gpsFix && gpsStatus === "ready" ? gpsFix : point;
    const routeList = !s || (tracking && gpsStatus !== "ready") ? [] : tracking ? routes(s as unknown as State, origin, accessible).slice(0, 3) : remoteRoutes?.key===queryKey && remoteRoutes.revision===s.revision ? remoteRoutes.routes : routes(s as unknown as State, point, accessible).slice(0, 3);
    const best = routeList.find(r => r.shelter.id === selectedRouteId) ?? routeList[0];
    async function loadRoute(simulate?:"503"|"timeout") {
        if(!s || !navigator.onLine || tracking)return;
        const params=new URLSearchParams({lat:String(point.lat),lng:String(point.lng),accessible:String(accessible)});
        if(simulate)params.set("external",simulate);
        try {const response=await fetch(`/api/routes?${params}`,{cache:"no-store",signal:AbortSignal.timeout(7000)});
            if(!response.ok)return;
            const data=await response.json() as {routes:Route[];revision:number;routing:{source:string}};
            setRemoteRoutes({key:queryKey,revision:data.revision,routes:data.routes});
        } catch { /* Existing local route remains available while offline. */ }
    }
    useEffect(()=>{void loadRoute();},[queryKey,s?.serverTime,online,tracking]);
    const routeKey = best ? `${best.shelter.id}:${best.roadIds.join(",")}` : "none";
    useEffect(() => {
        if (!s)
            return;
        const key = `${origin.lat},${origin.lng}:${selectedRouteId ?? ""}`;
        if (priorRoute.current && priorPoint.current === key && priorRoute.current !== routeKey)
            setNotice("rerouted");
        priorRoute.current = routeKey;
        priorPoint.current = key;
    }, [routeKey, origin.lat, origin.lng, selectedRouteId, s?.revision]);
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
        if (["sos-view","sos-dispatch","confirm","road","occupancy","team-complete","scenario","volunteer-verify","volunteer-dispatch","resource-update","resource-resupply"].includes(path) && !auth) return setError("loginRequired");
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
    async function accountSubmit(event: React.FormEvent) {
        event.preventDefault(); if (accountBusy) return;
        setAccountBusy(true); setAccountError("");
        try {
            const response = await fetch(`/api/account/${accountMode}`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:accountUsername,password:accountPassword})});
            const data = await response.json() as {username?:string;error?:string};
            if (!response.ok) throw new Error(data.error || "Hesab əməliyyatı alınmadı.");
            localStorage.removeItem("urban-crisis-operator-token"); setAuth(null); setFloodResult(null);
            setAccountName(data.username ?? null); setOperatorStatus(accountMode === "register" ? "pending" : ""); setAccountPassword("");
            const me=await fetch("/api/account/me",{cache:"no-store"}); if(me.ok){const profile=await me.json() as {operatorStatus?:string};setOperatorStatus(profile.operatorStatus ?? "");}
            try { apply(await request("state")); } catch { setError("networkError"); }
        } catch (error) { setAccountError(error instanceof Error ? error.message : "Hesab əməliyyatı alınmadı."); }
        finally { setAccountBusy(false); }
    }
    async function accountLogout() {
        setAccountBusy(true); setAccountError("");
        try {const response=await fetch("/api/account/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});if(!response.ok)throw new Error("Çıxış alınmadı.");setAccountName(null);setOperatorStatus("");apply(await request("state"));}
        catch {setAccountError("Çıxış alınmadı. Bağlantını yoxlayın.");} finally {setAccountBusy(false);}
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
    function stopTracking() {
        if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
        watchId.current = null; setTracking(false); setGpsFix(null); setGpsProblem("");
    }
    function startTracking() {
        if (!navigator.geolocation) { setGpsProblem(lang === "az" ? "Bu brauzer GPS dəstəkləmir." : "Geolocation is unavailable."); return; }
        if (watchId.current !== null) return;
        setGpsProblem(""); setGpsFix(null); setTracking(true); setRealMap(true);
        watchId.current = navigator.geolocation.watchPosition(p => {
            setGpsFix({lat:p.coords.latitude, lng:p.coords.longitude, accuracy:p.coords.accuracy, timestamp:p.timestamp}); setGpsProblem("");
        }, error => {
            if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
            watchId.current = null; setTracking(false); setGpsFix(null);
            setGpsProblem(error.code === 1 ? (lang === "az" ? "Mövqe icazəsi verilmədi." : "Location permission denied.") : (lang === "az" ? "GPS mövqeyi alınmadı. Yenidən cəhd edin." : "Location unavailable. Try again."));
        }, {enableHighAccuracy:true, maximumAge:5000, timeout:15000});
    }
    useEffect(() => () => { if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current); }, []);
    useEffect(() => { if (mode !== "citizen" && watchId.current !== null) stopTracking(); }, [mode]);
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
                void citizenAction("sos", { ...origin, type, voiceTranscript: text });
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
    useEffect(() => {
        if (!s || mode !== "dispatch" || !auth) { knownIncidents.current = null; return; }
        const ids = new Set(s.sos.filter(x => x.status === "active").map(x => x.id));
        if (knownIncidents.current) {
            const incoming = [...ids].find(id => !knownIncidents.current!.has(id));
            if (incoming) { setNewAlert(incoming); if (dispatchSound) playSosTone(); }
        }
        knownIncidents.current = ids;
    }, [s, mode, auth, dispatchSound]);
    const active = s?.sos.filter(x => x.status === "active").sort(compareIncidentDisplay) ?? [];
    const incidentForDispatch = s?.sos.find(x => x.id === selectedIncident && x.status === "active");
    const options = incidentForDispatch && s ? s.teams.filter(team => team.status === "available").flatMap(team => {
        const path = teamRoute(s as unknown as State, team, nearestNode(s as unknown as State, incidentForDispatch).id);
        return path ? [{team, path}] : [];
    }).sort((a,b) => a.path.weightedMeters - b.path.weightedMeters) : [];
    const pending = s?.alerts.filter(a => !a.decision) ?? [], criticalPending=pending.filter(a=>a.kind!=="resource"), mine = active.find(x => x.mine), open = s?.shelters.filter(sh => sh.open) ?? [];
    const lastResolved = s?.sos.filter(x => x.mine && x.status === "resolved").sort((a,b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))[0];
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
    return <div className={`app-shell ${mode === "dispatch" && auth ? "" : "no-sidebar"}`}>
    {mode === "dispatch" && auth && <aside className="sidebar"><a className="brand" href="/"><span className="brand-mark"><Activity size={25}/></span><span>urban<span className="brand-light">crisis</span><small>EVACUATION ENGINE</small></span></a>
      <div className="workspace"><MapPin size={20}/><div><strong>{t("city")}</strong><small>DEMO · BAKU</small></div></div>
      <nav>{nav.map(({ id, Icon }) => <button key={id} aria-label={t(id)} className={`nav-link ${tab === id && mode === "dispatch" ? "active" : ""}`} onClick={() => { setTab(id); setMode("dispatch"); }}><Icon size={18}/><span>{t(id)}</span></button>)}</nav>
      <div className="side-card"><Radio size={22}/><strong>{t("city")}</strong><p>{t("intro")}</p><button onClick={() => setDemo(!demo)}>{t("demo")} <ChevronRight size={15}/></button></div>
      <div className="operator"><span>OP</span><div><strong>{t("dispatch")}</strong><small>{t("simulation")}</small></div></div>
    </aside>}
    <main><header className="topbar"><div className="crumb"><span>Urban Crisis</span><ChevronRight size={14}/><strong>{t(mode === "citizen" ? "citizen" : tab)}</strong></div><div className="top-actions"><span className={`connection ${online ? "" : "offline"}`}><i />{t(online ? "online" : "offline")}</span><button className="btn light small" onClick={() => setLang(lang === "az" ? "en" : "az")} aria-label="AZ / EN">{lang.toUpperCase()} / {lang === "az" ? "EN" : "AZ"}</button></div></header>
      <div className="content"><div className="page-heading"><div><div className="eyebrow"><span className="orange-line"/>{t("platform")}</div><h1>{t(mode === "citizen" ? "citizenHeadline" : "headline")}</h1><p>{t(mode === "citizen" ? "citizenIntro" : "intro")}</p></div>{mode === "dispatch" && auth && <button className="btn dark" onClick={() => setDemo(!demo)}><Play size={15}/>{t("demo")}</button>}</div>
        <div className="toolbar">{mode === "dispatch" || auth ? <div className="mode-tabs">{auth && <button className={mode === "dispatch" ? "selected" : ""} onClick={() => setMode("dispatch")}><LayoutDashboard size={15}/>{t("dispatch")}</button>}<button className={mode === "citizen" ? "selected" : ""} onClick={() => { setMode("citizen"); setTab("overview"); }}><ShieldCheck size={15}/>{t("citizen")}</button></div> : <div className="entry-switch"><span className="citizen-label"><ShieldCheck size={15}/>{t("citizen")}</span><a className="dispatcher-entry" href="/?panel=dispatch"><LayoutDashboard size={15}/>{lang === "az" ? "Dispetçer girişi" : "Dispatcher sign-in"}</a></div>}<span className="simulation"><span />{t("simulation")}</span></div>
        {mode === "citizen" && <section className="panel account-panel"><div className="account-header"><div><span className="tag green">{lang === "az" ? "VƏTƏNDAŞ HESABI" : "CITIZEN ACCOUNT"}</span><h2>{accountName ? (lang === "az" ? `Salam, ${accountName}` : `Hello, ${accountName}`) : (lang === "az" ? "Şəxsi hesab" : "Personal account")}</h2></div>{accountName && <button className="btn light small" disabled={accountBusy} onClick={accountLogout}>{t("logout")}</button>}</div>{accountName ? <p>{operatorStatus === "approved" ? (lang === "az" ? "Operator müraciətiniz təsdiqlənib. Dispetçer panelinə e-poçt ünvanınız və şifrənizlə daxil olun. Köhnə hesablar istifadəçi adından istifadə edə bilər." : "Your operator request is approved. Sign in to the dispatcher panel with your email and password, or your existing username.") : (lang === "az" ? "Hesab yaradıldı. Operator səlahiyyəti üçün administrator təsdiqi gözlənilir." : "Your account is ready. Administrator approval is required for operator access.")}</p> : <><p>{lang === "az" ? "Gmail və ya başqa e-poçt ünvanı və öz şifrənizlə qeydiyyatdan keçin. Operator olmaq üçün administratorun təsdiqi tələb olunur." : "Register with your email and password. Dispatcher privileges require approval."}</p><div className="mode-tabs"><button type="button" className={accountMode === "login" ? "selected" : ""} onClick={()=>{setAccountMode("login");setAccountError("");}}>{lang === "az" ? "Daxil ol" : "Sign in"}</button><button type="button" className={accountMode === "register" ? "selected" : ""} onClick={()=>{setAccountMode("register");setAccountError("");}}>{lang === "az" ? "Qeydiyyat" : "Register"}</button></div><form className="account-form" onSubmit={accountSubmit}><label>{accountMode === "register" ? (lang === "az" ? "Gmail / e-poçt" : "Email") : (lang === "az" ? "E-poçt və ya istifadəçi adı" : "Email or username")}<input type={accountMode === "register" ? "email" : "text"} value={accountUsername} onChange={e=>setAccountUsername(e.target.value)} autoComplete="username" maxLength={254} required /></label><label>{t("password")}<input type="password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} autoComplete={accountMode === "register" ? "new-password" : "current-password"} required /></label><button className="btn dark" disabled={accountBusy}>{accountMode === "register" ? (lang === "az" ? "Hesab yarat" : "Create account") : t("login")}</button></form><small>{lang === "az" ? "E-poçt ünvanınız təsdiqlənmir və ona kod göndərilmir. Şifrəni özünüz seçirsiniz." : "Your email is not verified and no code is sent. Choose your own password."}</small></>}{accountName && operatorStatus === "approved" && !auth && <a className="btn dark small approved-operator-link" href="/?panel=dispatch">{lang === "az" ? "Dispetçer girişinə keç" : "Open dispatcher sign-in"}</a>}{accountError && <p role="alert" className="account-error">{accountError}</p>}<p className="help-text">{lang === "az" ? "Hesabı dəyişərkən əvvəlki sessiyadakı göndərilməmiş sorğular ayrıca saxlanılır." : "Unsent requests from the previous session remain separate when switching accounts."}</p></section>}
        {mode === "dispatch" && (!auth ? <form className="operator-login" onSubmit={loginOperator}><strong>{t("operatorLogin")}</strong><label>{lang === "az" ? "E-poçt və ya istifadəçi adı" : "Email or username"}<input value={username} onChange={event=>setUsername(event.target.value)} autoComplete="username" required/></label><label>{t("password")}<input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="current-password" required/></label><button className="btn dark" type="submit">{t("login")}</button></form> : <div className="operator-session"><span>{auth.role === "admin" ? t("adminRole") : t("operatorRole")}</span><button className="btn light small" onClick={logoutOperator}>{t("logout")}</button></div>)}
        {mode === "dispatch" && auth?.role === "admin" && <OperatorRequests token={auth.token} lang={lang}/>}
        {mode === "dispatch" && s?.security?.highSosFlow && <div className="alert-banner warning" role="status"><TriangleAlert size={18}/>{t("floodBanner")}</div>}
        {floodResult && mode === "dispatch" && <div className="alert-banner warning" role="status"><TriangleAlert size={18}/>{t("floodResult")}: {floodResult.total} · {t("accepted")}: {floodResult.counts.accepted} · 503: {floodResult.counts.RATE_GLOBAL} · {t("limiterAverage")}: {floodResult.limiterAverageMs.toFixed(2)} ms</div>}
        {!online && <div className="alert-banner error" role="status"><TriangleAlert size={18}/>{t("stale")}</div>}
        {error && <div className="alert-banner error" role="alert"><TriangleAlert size={18}/><span>{displayError(error)}</span><button aria-label={t("close")} onClick={() => setError("")}><X size={17}/></button></div>}
        {notice && <div className={`alert-banner ${notice === "rerouted" ? "warning" : "success"}`} role="status"><Check size={18}/><span>{notice === "rerouted" && !best ? (lang === "az" ? "Əlçatan demo marşrut qalmadı." : "No demo route is currently available.") : t(notice)}</span>{notice === "rerouted" && best && mode === "citizen" && <button className="btn light small" onClick={() => document.getElementById("citizen-routes")?.scrollIntoView({behavior:"smooth"})}>{lang === "az" ? "Yeni marşruta bax" : "View updated route"}</button>}<button aria-label={t("close")} onClick={() => setNotice("")}><X size={17}/></button></div>}
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
        {mode === "dispatch" && !auth ? null : !s ? <div className="loading"><RefreshCw className="spin"/><h2>{t("loading")}</h2><p>{t("noCache")}</p></div> : <>
          {mode === "dispatch" && <div className="experience-launch"><button className="btn dark" onClick={() => setGuided(!guided)}><Play size={16}/>{lang === "az" ? "Böhranı canlı yaşa · DEMO" : "Experience a crisis · DEMO"}</button></div>}{mode === "dispatch" && guided && <DemoWalkthrough s={s} lang={lang} enabled={!!auth && online} busy={busy} act={act} roadId={best?.roadIds[0]}/>}
          {mode === "dispatch" && auth && <div className="panel"><label><input type="checkbox" checked={dispatchSound} onChange={e=>setDispatchSound(e.target.checked)}/> {lang === "az" ? "Yeni SOS üçün səs" : "Sound for new SOS"}</label>{newAlert && <p role="status">🔔 {lang === "az" ? "Yeni demo SOS daxil oldu." : "New demo SOS received."} <button className="btn light small" onClick={()=>{setSelectedIncident(newAlert);setNewAlert(null);document.getElementById("incident-feed")?.scrollIntoView({behavior:"smooth"});}}>{lang === "az" ? "Müraciətə bax" : "View incident"}</button></p>}</div>}
          {mode === "dispatch" && demo && <section className="demo-panel"><div><span className="tag amber">DEMO LAB · SIMULATION</span><h3>{t("demo")}</h3><p>{lang === "az" ? "Təqdimat: vətəndaş SOS göndərir → operator klasteri təsdiqləyir → briqada yönləndirilir → yol və ya doluluq dəyişdikdə alternativ marşrut göstərilir → vətəndaş təhlükəsiz olduğunu bildirir." : "Demo: citizen sends SOS → operator confirms the cluster → a team is dispatched → a route changes → citizen reports safe."}</p><p>{lang === "az" ? "Ayrı brauzer profillərindən istifadə edin. Ssenari düymələri operator girişi tələb edir; sıfırlama demo məlumatlarını dəyişir." : "Use separate browser profiles. Scenario controls require operator login; reset changes demo data."}</p></div><div className="demo-buttons">{([{ name: "cluster", key: "clusterDemo", Icon: Siren }, { name: "capacity", key: "capacityDemo", Icon: Users }, { name: "blocked", key: "blockDemo", Icon: RouteIcon }, { name: "resource", key: "resourceDemo", Icon: Truck }, { name: "volunteer", key: "volunteerDemo", Icon: HandHeart }, { name: "reset", key: "reset", Icon: RefreshCw }] as const).map(({ name: scenario, key, Icon }) => <button key={scenario} disabled={busy || !online || !auth} onClick={() => act("scenario", { name: scenario, roadId: best?.roadIds[0] })}><Icon size={18}/><strong>{t(key)}</strong></button>)}</div><div className="row wrap"><button className="btn light small" onClick={() => loadRoute("503")}>{t("routingDemo")}</button><button className="btn light small" onClick={() => loadRoute("timeout")}>{t("timeoutDemo")}</button><button className="btn light small" disabled={!auth} onClick={floodDemo}>{t("floodDemo")}</button></div></section>}
          <div className={`metrics ${mode === "citizen" ? "citizen-metrics" : ""}`}>{[{ key: "active", value: active.length, Icon: Siren, color: "orange" }, { key: "critical", value: criticalPending.length, Icon: TriangleAlert, color: "red" }, { key: "open", value: open.length, Icon: ShieldCheck, color: "green" }, { key: "available", value: `${s.teams.filter(team => team.status === "available").length} / ${s.teams.length}`, Icon: Truck, color: "blue" }].map(({ key, value, Icon, color }) => <section className="metric" key={key}><div className="row between"><span>{t(key as MessageKey)}</span><span className={`metric-icon ${color}`}><Icon size={19}/></span></div><div className="metric-value">{value}</div></section>)}</div>
          {mode === "citizen" && <><div className="quick-actions" aria-label={lang === "az" ? "Təcili əməliyyatlar" : "Emergency actions"}><button className="btn danger" onClick={() => document.getElementById("citizen-sos")?.scrollIntoView({behavior:"smooth",block:"center"})}><Siren size={20}/>{t("send")}</button><button className="btn safe-button" onClick={() => document.getElementById("citizen-routes")?.scrollIntoView({behavior:"smooth",block:"start"})}><Navigation size={20}/>{lang === "az" ? "Təhlükəsiz məntəqəyə get" : "Find a safe place"}</button><button className="btn light" disabled={busy} onClick={() => citizenAction("safe", {})}><ShieldCheck size={20}/>{t("safe")}</button></div><section className="citizen-controls" id="citizen-sos"><div className="grow"><label htmlFor="location">{tracking ? (lang === "az" ? "Demo zona (seçdikdə GPS dayanır)" : "Demo zone (choosing stops GPS)") : t("location")}</label><div className="row"><MapPin size={18}/><select id="location" value={s.nodes.reduce((a, b) => Math.hypot(a.lat - point.lat, a.lng - point.lng) < Math.hypot(b.lat - point.lat, b.lng - point.lng) ? a : b).id} onChange={e => { if (tracking) stopTracking(); const n = s.nodes.find(n => n.id === e.target.value)!; setPoint({ lat: n.lat, lng: n.lng }); }}>{s.nodes.map(n => <option key={n.id} value={n.id}>{n.zone} · {name(n.label)}</option>)}</select><button className="icon-btn" aria-label={t("gps")} title={t("gps")} onClick={useLocation}><LocateFixed size={18}/></button><button className="btn light small" onClick={() => setCoord(!coord)}>{t("coordinates")}</button></div><small>{tracking && gpsFix ? `${lang === "az" ? "Son GPS" : "Last GPS"}: ${gpsFix.lat.toFixed(5)}, ${gpsFix.lng.toFixed(5)}` : `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}</small>
            {coord && <form className="coordinate-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget), p = { lat: Number(f.get("lat")), lng: Number(f.get("lng")) }; if (!validPoint(p))
                return setError("bounds"); setPoint(p); setCoord(false); }}><input aria-label={t("latitude")} name="lat" type="number" step="any" min="40.35" max="40.41" defaultValue={point.lat} required/><input aria-label={t("longitude")} name="lng" type="number" step="any" min="49.81" max="49.88" defaultValue={point.lng} required/><button className="btn dark">{t("apply")}</button></form>}
            <label className="accessibility-control"><input type="checkbox" checked={accessible} disabled={busy} onChange={e => citizenAction("accessibility", { enabled: e.target.checked })}/><span>♿ {t("accessible")}</span></label>{accessible && <><span className="tag red">{t("priority")}</span><p className="help-text">{t("accessibleRoute")}</p></>}
          </div><div className="sos-controls"><div className="live-gps-panel"><div className="live-gps-title"><LocateFixed size={19}/><strong>{lang === "az" ? "Canlı mövqeyim" : "Live location"}</strong><span className="tag blue">GPS</span></div><p>{lang === "az" ? "İcazə verdikdə mövqeyiniz xəritədə yenilənir. Demo marşrut və vaxt real naviqasiya deyil. Xəritə provayderi göstərilən ərazini görə bilər; SOS göndərdikdə mövqe serverə ötürülür." : "With permission your position updates on the map. Demo routes and times are not real navigation. The map provider can see the displayed area; sending SOS shares your position with the server."}</p><button className={`btn ${tracking ? "light" : "dark"} small`} onClick={tracking ? stopTracking : startTracking}>{tracking ? (lang === "az" ? "İzləməni dayandır" : "Stop tracking") : (lang === "az" ? "Canlı izləməni başlat" : "Start live tracking")}</button><p aria-live="polite">{gpsProblem || (tracking ? gpsStatus === "ready" ? `${lang === "az" ? "GPS yenilənir · təxmini dəqiqlik" : "GPS updating · accuracy"}: ±${Math.round(gpsFix!.accuracy)} m` : gpsStatus === "outside" ? (lang === "az" ? "Mövqeyiniz demo yol şəbəkəsindən kənardadır; marşrut və vaxt göstərilmir." : "Outside the demo road network; route and time are unavailable.") : gpsStatus === "inaccurate" ? (lang === "az" ? "GPS dəqiqliyi aşağıdır; daha dəqiq mövqe gözlənilir." : "GPS accuracy is low; waiting for a better fix.") : (lang === "az" ? "GPS mövqeyi gözlənilir və ya köhnəlib." : "Waiting for a fresh GPS fix.") : (lang === "az" ? "Canlı izləmə bağlıdır." : "Live tracking is off."))}</p></div><div className="danger-types">{hazards.map(({ id, Icon }) => <button key={id} disabled={busy || !!mine || sosQueued} aria-pressed={selectedHazard === id} className={selectedHazard === id ? "selected-hazard" : ""} onClick={() => setSelectedHazard(id)}><Icon size={18}/>{t(id)}</button>)}</div><div className="hazard-guidance" role="status"><strong>{t(selectedHazard)} · {lang === "az" ? "İndi nə etməliyəm?" : "What should I do?"}</strong><p>{lang === "az" ? "Real fövqəladə vəziyyətdə 112-yə zəng edin və rəsmi xidmətlərin təlimatlarını izləyin. Bu tətbiq real çağırış göndərmir." : "In a real emergency, call 112 and follow official instructions. This app does not send real calls."}</p><a href="tel:112">112</a> · <a href="https://fhn.gov.az/az/elaqe/112-zeng-merkezi" target="_blank" rel="noreferrer">{lang === "az" ? "FHN məlumatı" : "Official guidance"}</a></div><label className="sound-choice"><input type="checkbox" checked={soundEnabled} onChange={e=>setSoundEnabled(e.target.checked)}/>{lang === "az" ? "SOS siqnal səsi" : "SOS confirmation sound"}</label><details className="sos-details"><summary>{lang === "az" ? "Əlavə məlumat (istəyə bağlı)" : "Extra details (optional)"}</summary><label>{lang === "az" ? "İnsan sayı" : "People"}<input type="number" min="1" max="1000" value={people} onChange={e=>setPeople(e.target.value)}/></label><label>{lang === "az" ? "Yaralı varmı?" : "Anyone injured?"}<select value={injured} onChange={e=>setInjured(e.target.value)}><option value="">—</option><option value="yes">{lang === "az" ? "Bəli" : "Yes"}</option><option value="no">{lang === "az" ? "Xeyr" : "No"}</option></select></label><label>{lang === "az" ? "Məkan" : "Location"}<select value={place} onChange={e=>setPlace(e.target.value)}><option value="">—</option><option value="indoors">{lang === "az" ? "Bina içi" : "Indoors"}</option><option value="outdoors">{lang === "az" ? "Küçə" : "Outdoors"}</option></select></label><label>{lang === "az" ? "Qısa qeyd" : "Short note"}<textarea maxLength={300} value={sosNote} onChange={e=>setSosNote(e.target.value)}/></label></details><div className="row wrap"><button disabled={busy || !!mine || sosQueued || (tracking && gpsStatus !== "ready") || (people !== "" && (!Number.isInteger(Number(people)) || Number(people) < 1 || Number(people) > 1000))} className={`btn danger ${soundPulse ? "sos-pulse" : ""}`} onClick={() => {if(soundEnabled)playSosTone();setSoundPulse(true);window.setTimeout(()=>setSoundPulse(false),1000);void citizenAction("sos", { ...origin, type: selectedHazard, details: { ...(people ? {people:Number(people)} : {}), ...(injured ? {injured:injured === "yes"} : {}), ...(place ? {setting:place} : {}), ...(sosNote.trim() ? {note:sosNote.trim()} : {}) } });}}><Siren size={18}/>{t(mine ? "sent" : sosQueued ? "queued" : "send")}</button><button className="btn light" disabled={busy || !!mine || sosQueued || (tracking && gpsStatus !== "ready")} onClick={voice}><Mic size={17}/>{t(listening ? "listening" : "voice")}</button><button className="btn safe-button" disabled={busy} onClick={() => citizenAction("safe", {})}><ShieldCheck size={17}/>{t("safe")}</button></div>{transcript && <p className="help-text">“{transcript}”</p>}
            <div className="row wrap"><button className="btn light" onClick={() => { setQrCode(best?.shelter.qrCode ?? ""); setQrOpen(true); }}>{t("checkin")}</button>{s.mySafety && <span className="tag green">{t("safeStatus")}{s.mySafety.shelterId ? ` · ${name(s.shelters.find(sh => sh.id === s.mySafety?.shelterId)?.name ?? "")}` : ""}</span>}</div></div></section>{(mine || sosQueued || s.mySafety || lastResolved) && <section className="panel sos-status" aria-live="polite"><div className="status-heading"><div className="status-symbol"><Siren size={22}/></div><div><span className="status-overline">{lang === "az" ? "MÜRACİƏTİNİZ" : "YOUR REQUEST"}</span><h2>{lang === "az" ? "SOS vəziyyəti" : "SOS status"}</h2></div><span className="status-demo">{lang === "az" ? "SİMULYASİYA" : "SIMULATION"}</span></div><div className="status-body"><strong>{sosQueued ? (lang === "az" ? "Bağlantı gözlənilir — hələ göndərilməyib" : "Waiting for connection — not yet sent") : mine ? (mine.assignedTeam ? (lang === "az" ? "Briqada təyin edilib" : "Team assigned") : (lang === "az" ? "SOS qəbul edilib · yardım gözlənilir" : "SOS received · awaiting help")) : lastResolved ? (lang === "az" ? "Demo tapşırıq tamamlandı" : "Demo task completed") : (lang === "az" ? "Təhlükəsiz statusu qeydə alınıb" : "Safe status recorded")}</strong>{(mine || lastResolved) && <p className="help-text">{lang === "az" ? "SOS qəbul edildi" : "SOS received"} ✓ · {(mine || lastResolved)?.viewedAt ? (lang === "az" ? "Operator baxdı ✓" : "Operator viewed ✓") : (lang === "az" ? "Operator gözlənilir" : "Awaiting operator")} · {(mine || lastResolved)?.assignedTeam ? (lang === "az" ? "Briqada təyin edildi ✓" : "Team assigned ✓") : (lang === "az" ? "Briqada gözlənilir" : "Awaiting team")} · {lastResolved && !mine ? (lang === "az" ? "Tapşırıq tamamlandı ✓" : "Task completed ✓") : (lang === "az" ? "Tapşırıq davam edir" : "Task in progress")}</p>}{mine && <p>{t(mine.type)} · {mine.zone} · {time(mine.createdAt)}{mine.assignedTeam ? ` · ${name(s.teams.find(team => team.id === mine.assignedTeam)?.name ?? "")}` : ""}</p>}{myTeam && <p>{myTeam.routeBlocked ? t("routeBlocked") : `${t("dispatched")} · ${t("etaSimulation")}: ${Math.max(0, Math.ceil(((myTeam.dispatchedAt ?? now) + (myTeam.etaMinutes ?? 0) * 60000 - (now || s.serverTime)) / 60000))} ${t("minutes")}`}</p>}{myVolunteerTask && <p>{lang === "az" ? "Könüllü dəstəyi" : "Volunteer support"}: {t(myVolunteerTask.status)}{myVolunteerTask.meters != null ? ` · ${myVolunteerTask.meters} m` : ""}</p>}<small>{lang === "az" ? "Bu demo real xidmətə çağırış göndərmir." : "This demo does not contact emergency services."}</small></div></section>}</>}
          {mode === "citizen" && <div className="citizen-support-grid"><section className="panel support-card emergency-card"><div className="support-heading"><div className="support-icon emergency-icon"><HeartPulse size={21}/></div><div><span className="support-eyebrow">{lang === "az" ? "REAL FÖVQƏLADƏ HAL" : "REAL EMERGENCY"}</span><h2>{lang === "az" ? "Təcili yardım" : "Emergency assistance"}</h2></div></div><p>{lang === "az" ? "Bu tətbiq real SOS göndərmir. Fövqəladə vəziyyətdə 112-yə zəng edin və rəsmi xidmətlərin göstərişlərinə əməl edin." : "This app does not send real SOS calls. In an emergency, call 112 and follow official responders’ instructions."}</p><div className="support-actions"><a className="emergency-call" href="tel:112"><Siren size={17}/> {lang === "az" ? "112-yə zəng et" : "Call 112"}</a><a className="support-link" href="https://fhn.gov.az/az/elaqe/112-zeng-merkezi" target="_blank" rel="noreferrer">{lang === "az" ? "FHN məlumatı" : "Official guidance"} <ChevronRight size={15}/></a></div></section>
          <section className="panel support-card safety-card"><div className="support-heading"><div className="support-icon safety-icon"><ShieldCheck size={21}/></div><div><span className="support-eyebrow">{lang === "az" ? "YAXINLARINIZ ÜÇÜN" : "FOR LOVED ONES"}</span><h2>{lang === "az" ? "Təhlükəsizlik kodu" : "Safety code"}</h2></div></div><p>{lang === "az" ? "Demo kodunu yalnız güvəndiyiniz şəxslə paylaşın. Kod 24 saat keçərlidir və yalnız təhlükəsiz statusunu göstərir." : "Share this demo code only with trusted people. It expires after 24 hours and reveals only a safe status."}</p>{s.mySafety?.shareCode && <><code className="safety-code">{s.mySafety.shareCode}</code><button className="btn light small" onClick={async()=>{const text=lang === "az" ? `Mən Urban Crisis demosunda təhlükəsiz statusumu qeyd etdim. Statusu yoxlamaq üçün kodum: ${s.mySafety!.shareCode}` : `I recorded a safe status in the Urban Crisis demo. My status code: ${s.mySafety!.shareCode}`;try {if(navigator.share){await navigator.share({text,url:window.location.origin});setShareStatus("");}else if(navigator.clipboard){await navigator.clipboard.writeText(`${text} ${window.location.origin}`);setShareStatus(lang === "az" ? "Mətn kopyalandı; istədiyiniz şəxslə özünüz paylaşın." : "Copied; share it with your chosen recipient.");}else setShareStatus(lang === "az" ? "Kodu seçib əl ilə kopyalayın." : "Select and copy the code manually.");}catch{setShareStatus(lang === "az" ? "Paylaşım tamamlanmadı." : "Sharing was not completed.");}}}>{lang === "az" ? "Kodu paylaş" : "Share code"}</button>{shareStatus && <p role="status">{shareStatus}</p>}<p>{lang === "az" ? "Yeni SOS göndərdikdə əvvəlki kod etibarsız olur." : "A new SOS invalidates the previous code."}</p></>}<form className="safety-lookup" onSubmit={async e=>{e.preventDefault();try {const response = await fetch("/api/safety-lookup", {method:"POST", headers:{"Content-Type":"application/json"},body:JSON.stringify({code:lookupCode})});if(!response.ok)throw new Error();const data = await response.json() as {status:string};setLookupResult(data.status === "safe" ? (lang === "az" ? "Demo təhlükəsiz statusu qeydə alınıb." : "Demo safe status recorded.") : (lang === "az" ? "Kod tapılmadı və ya vaxtı bitib." : "Code not found or expired."));}catch{setLookupResult(lang === "az" ? "Yoxlama alınmadı. Bağlantını yoxlayın." : "Lookup failed. Check your connection.");}}}><label htmlFor="safety-lookup-code">{lang === "az" ? "Kodu daxil edin" : "Enter code"}</label><div className="safety-input-row"><input id="safety-lookup-code" autoComplete="off" spellCheck={false} placeholder={lang === "az" ? "Təhlükəsizlik kodu" : "Safety code"} value={lookupCode} maxLength={32} onChange={e=>setLookupCode(e.target.value)} /><button className="btn dark" type="submit">{lang === "az" ? "Yoxla" : "Check"}</button></div></form>{lookupResult && <p className="lookup-result" role="status">{lookupResult}</p>}</section></div>}
          {mode === "dispatch" && criticalPending.length > 0 && <div className="red-alert" role="alert"><Siren size={24}/><div><strong>{t("redAlert")} · {criticalPending.length}</strong><p>{t("proposal")}</p></div></div>}
          {(tab === "overview" || mode === "citizen") && <><div className="main-grid"><div><button className="btn light small" onClick={() => { if (tracking) stopTracking(); setRealMap(!realMap); }}>{realMap ? (lang === "az" ? "Demo sxemə keç" : "Show demo diagram") : (lang === "az" ? "Real xəritəyə keç" : "Show real map")}</button>{realMap ? <RealMap s={s} lang={lang} point={tracking && gpsFix ? gpsFix : point} liveFix={tracking ? gpsFix : null} followLive={tracking} now={now || s.serverTime} route={best} citizen={mode === "citizen"} onIncident={id => {if(mode === "dispatch" && auth){setSelectedIncident(id);setSelectedTeam("");void act("sos-view", {id});document.getElementById("incident-feed")?.scrollIntoView({behavior:"smooth"});}}} onPoint={p => { if (tracking) stopTracking(); setPoint({lat:p.lat,lng:p.lng}); }}/> : <CrisisMap s={s} lang={lang} point={point} route={best} citizen={mode === "citizen"} now={now || s.serverTime} onPoint={p => setPoint({ lat: p.lat, lng: p.lng })}/>}</div><aside className="right-stack">{mode === "citizen" ? <section className="panel alternatives" id="citizen-routes"><div className="panel-heading"><h2>{t("nearest")}</h2><Navigation size={17}/></div>{tracking && <p className="help-text">{lang === "az" ? "Vaxt və məsafə təxmini demo hesablamasıdır; real yollara əsaslanan naviqasiya deyil." : "Time and distance are simulated estimates, not real road navigation."}</p>}{routeList.length ? routeList.map((r, i) => <div className="alternative" key={r.shelter.id}><div className="row between"><span className="route-number">{i + 1}</span><span className="tag green">{r.occupancy}% {t("occupied")}</span></div><strong>{name(r.shelter.name)}</strong><small>{r.minutes} {t("minutes")} · {(r.meters / 1000).toFixed(2)} km {accessible ? "· ♿" : ""} · DEMO</small><button className="btn light small" onClick={() => { setSelectedRouteId(r.shelter.id); setJourneyId(r.shelter.id); }}>{lang === "az" ? "Məntəqəyə bax" : "View shelter"}</button>{i === 0 && <><span className="recommended"><Check size={12}/>{t("recommended")}</span><small>{lang === "az" ? `Açıq məntəqə · ${r.occupancy}% dolu${accessible ? " · maneəsiz rejim" : ""}` : `Open shelter · ${r.occupancy}% occupied${accessible ? " · step-free mode" : ""}`}</small></>}</div>) : <p className="empty-text">{t("noRoute")}</p>}</section> : <section className="panel alerts-panel"><div className="panel-heading"><h2>{t("critical")}</h2><Radio size={17}/></div><div className="alert-list">{s.alerts.length ? s.alerts.map(a => <div className={`incident ${a.decision ? "confirmed" : ""}`} key={a.id}><div className="row between"><span className={`tag ${a.decision ? "green" : a.kind === "resource" ? "amber" : "red"}`}>{t(a.decision ? "confirmed" : a.kind === "resource" ? "resource" : "redAlert")}</span><small>{a.zone}</small></div><h3>{t(a.kind)}</h3>{a.hasPriority && <span className="tag red">♿ {t("priority")}</span>}<p>{a.kind === "cluster" ? `${a.sosIds.length} ${t("uniqueCitizens")} · ${s.config.windowSeconds}s · ${s.config.radiusMeters}m` : name(s.shelters.find(sh => sh.id === a.shelterId)?.name ?? "")}</p><p>{t(a.kind === "cluster" ? "proposal" : a.kind === "resource" ? "supplyAlert" : "openReserve")}</p><button className="btn danger" disabled={busy || !!a.decision || !online} onClick={() => act("confirm", { id: a.id })}><Check size={15}/>{t(a.decision ? "confirmed" : a.kind === "resource" ? "resupply" : "confirm")}</button></div>) : <div className="empty-alert"><ShieldCheck size={29}/><strong>{t("noAlerts")}</strong><button onClick={() => setDemo(true)}>{t("demo")}</button></div>}</div></section>}
            <section className="panel"><div className="panel-heading"><h2>{t("shelters")}</h2><Shield size={17}/></div>{s.shelters.map(sh => <div className={`shelter-row ${!sh.open ? "muted" : ""}`} key={sh.id}><div className="place-icon"><Shield size={17}/></div><div className="grow"><div className="row between"><strong>{name(sh.name)} {sh.accessible ? "♿" : ""}</strong><span className={`tag ${sh.open ? "green" : "neutral"}`}>{sh.open ? `${Math.round(100 * sh.occupied / sh.capacity)}%` : t("reserve")}</span></div><small>{sh.occupied} / {sh.capacity} · {sh.accessible ? "♿" : ""} · 💧 {sh.resources.waterLiters > 0 ? (lang === "az" ? "su var" : "water") : (lang === "az" ? "su yoxdur" : "no water")} · 🩺 {sh.resources.medicalKits > 0 ? (lang === "az" ? "tibbi dəst var" : "medical kits") : (lang === "az" ? "tibbi dəst yoxdur" : "no kits")} · DEMO</small><div className="progress"><i style={{ width: `${100 * sh.occupied / sh.capacity}%` }}/></div></div></div>)}</section></aside></div>
            {mode === "dispatch" && <><div className="operations-grid"><section className="panel"><div className="panel-heading"><h2>{t("teams")}</h2><Truck size={18}/></div>{s.teams.map(team => <div className="team-card" key={team.id}><div className="row between"><strong>{name(team.name)}</strong><span className={`tag ${team.status === "available" ? "green" : "blue"}`}>{t(team.status === "available" ? "free" : "dispatched")}</span></div><small>{name(team.specialty)}</small>{team.status === "dispatched" && <><p>{team.routeBlocked ? t("routeBlocked") : `ETA: ${Math.max(0, Math.ceil(((team.dispatchedAt ?? now) + (team.etaMinutes ?? 0) * 60000 - (now || s.serverTime)) / 60000))} ${t("minutes")} · ${team.routeMeters ?? 0} m`}</p><small>{t("etaSimulation")}</small><button className="btn light small" disabled={busy || !online} onClick={() => act("team-complete", { id: team.id })}>{t("complete")}</button></>}</div>)}</section><section className="panel"><div className="panel-heading"><h2>{t("feed")}</h2><Siren size={18}/></div><p className="help-text">{lang === "az" ? "Görünüş sırası: xüsusi ehtiyac, tibbi müraciət, sonra vaxt. Bu, tibbi triage və ya avtomatik qərar deyil." : "Display order: accessibility priority, medical reports, then time. This is not medical triage or an automatic decision."}</p><div className="incident-feed" id="incident-feed">{active.length ? active.map(x => <div className={`feed-row ${x.priority ? "priority-row" : ""}`} key={x.id}><button className="btn light small" onClick={() => {setSelectedTeam("");setSelectedIncident(selectedIncident === x.id ? null : x.id);if(selectedIncident !== x.id && !x.viewedAt) void act("sos-view", {id:x.id});}}>{lang === "az" ? "Detallara bax" : "View details"}</button><div className="row between"><strong>{x.priority ? "♿ " : ""}{t(x.type)} {x.mine ? `· ${t("mine")}` : ""}</strong><small>{time(x.createdAt)}</small></div><small>{x.zone} · {t(x.assignedTeam ? "dispatched" : "waiting")}{x.assignedTeam ? ` · ${name(s.teams.find(team => team.id === x.assignedTeam)?.name ?? "")}` : ""}</small>{x.priority === 1 && <span className="tag red">{t("priority")}</span>}{x.type === "medical" && <span className="tag amber">{t("medical")}</span>}{selectedIncident === x.id && <div className="incident-details">{!auth ? <p>{lang === "az" ? "Detallar üçün operator girişi tələb olunur." : "Operator login required for details."}</p> : <><p>{x.details?.people ? `${lang === "az" ? "İnsan sayı" : "People"}: ${x.details.people}` : ""}</p><p>{x.details?.injured === undefined ? "" : `${lang === "az" ? "Yaralı" : "Injured"}: ${x.details.injured ? (lang === "az" ? "Bəli" : "Yes") : (lang === "az" ? "Xeyr" : "No")}`}</p><p>{x.details?.setting === "indoors" ? (lang === "az" ? "Bina içi" : "Indoors") : x.details?.setting === "outdoors" ? (lang === "az" ? "Küçə" : "Outdoors") : ""}</p><p>{x.details?.note || (lang === "az" ? "Qeyd yoxdur" : "No note")}</p>{!x.assignedTeam && <div className="dispatch-choice"><strong>{lang === "az" ? "Briqada seç · simulyasiya" : "Select team · simulation"}</strong>{options.length ? <><select aria-label={lang === "az" ? "Briqada" : "Team"} value={selectedTeam || options[0].team.id} onChange={e=>setSelectedTeam(e.target.value)}>{options.map(({team,path},i)=><option key={team.id} value={team.id}>{i===0 ? (lang === "az" ? "Tövsiyə: " : "Recommended: ") : ""}{team.name} · {Math.round(path.meters)} m · {path.etaMinutes} {lang === "az" ? "dəq" : "min"}</option>)}</select><button className="btn danger small" disabled={busy || !online} onClick={()=>void act("sos-dispatch",{id:x.id,teamId:selectedTeam || options[0].team.id})}>{lang === "az" ? "Briqadanı təsdiqlə və göndər" : "Confirm and dispatch"}</button></> : <p>{lang === "az" ? "Əlçatan sərbəst briqada yoxdur." : "No reachable team is available."}</p>}</div>}</>}</div>}</div>) : <p className="empty-text">{t("noEvents")}</p>}</div></section></div><section className="panel zone-panel"><div className="panel-heading"><h2>{t("zones")}</h2></div><div className="table-scroll"><table><thead><tr><th>{t("zone")}</th><th>{t("active")}</th><th>♿</th><th>{t("average")}</th><th>{t("latest")}</th></tr></thead><tbody>{s.zones.map(z => <tr key={z.zone}><td>{z.zone}</td><td>{z.activeSos}</td><td>{z.prioritySos}</td><td>{z.occupancy === null ? "—" : `${z.occupancy}%`}</td><td>{z.latestAt ? time(z.latestAt) : "—"}</td></tr>)}</tbody></table></div></section></>}
          </>}
          {mode === "dispatch" && auth && <ImpactPanel s={s} lang={lang}/>}
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
    {journeyId && routeList.find(r=>r.shelter.id===journeyId) && <ShelterJourney route={routeList.find(r=>r.shelter.id===journeyId)!} lang={lang} busy={busy} onClose={()=>setJourneyId(null)} onArrive={code=>{void citizenAction("checkin",{qrCode:code});}}/>}
    {qrOpen && s && <CheckinDialog shelters={s.shelters} initialCode={qrCode} lang={lang} busy={busy} onClose={() => setQrOpen(false)} onCheckin={code => { void citizenAction("checkin", { qrCode: code }); }}/>}
    {busy && <div className="saving" role="status"><RefreshCw size={14} className="spin"/>{t("sync")}</div>}
  </div>;
}
function validPoint(p: Point) { return Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 40.35 && p.lat <= 40.41 && p.lng >= 49.81 && p.lng <= 49.88; }
