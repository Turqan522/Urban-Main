import { mutate } from "../../../lib/crisis/store";
import { cachedState, invalidateCache } from "../../../lib/crisis/cache";
import { publicState, routes } from "../../../lib/crisis/engine";
import { AppError, coordinates } from "../../../lib/crisis/commands";
import { newsForPoint } from "../../../lib/crisis/news";
import { routingCircuit } from "../../../lib/crisis/circuit-breaker";
import { LegacyPasswordUnsupported, makePassword, validCredentials, validEmail, verifyPassword } from "../../../lib/crisis/password";
import { authorize, login, verifyToken, signToken } from "../../../lib/crisis/auth";
import { loginLimiter, simulateFlood, sosRateGuard } from "../../../lib/crisis/rate-limiter";
import { spamDetector } from "../../../lib/crisis/spam-detector";
import { env } from "cloudflare:workers";
export const dynamic = "force-dynamic";
const setting = (name: string) => { const value = (env as unknown as Record<string, unknown>)[name]; return typeof value === "string" ? value : ""; };
function accountDB() { if (!env.DB) throw new AppError("Hesab bazası hazır deyil.",503); return env.DB; }
async function handle(request: Request) {
  const url = new URL(request.url),
    path = url.pathname.replace("/api/", "");
  const remoteIp = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ip = remoteIp === "127.0.0.1" || remoteIp === "::1" ? null : remoteIp;
  let citizen = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)crisis_citizen=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const fresh = !citizen;
  citizen ??= crypto.randomUUID();
  const anonymousCitizen = citizen;
  const sessionToken = request.headers.get("cookie")?.match(/(?:^|;\s*)crisis_account=([A-Za-z0-9_.-]+)(?:;|$)/)?.[1];
  const account = sessionToken ? await verifyToken(sessionToken, setting("CRISIS_JWT_SECRET")) : null;
  if (account?.role === "citizen" && /^[a-f0-9-]{36}$/.test(account.sub)) citizen = `account:${account.sub}`;
  const json = (value: unknown, status = 200, extraHeaders: Record<string,string> = {}) => {
    const headers = new Headers({"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
    for (const [key,value] of Object.entries(extraHeaders)) headers.append(key,value);
    if (fresh) headers.append("Set-Cookie", `crisis_citizen=${anonymousCitizen}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${url.protocol === "https:" ? "; Secure" : ""}`);
    return new Response(JSON.stringify(value), {status,headers});
  };
  const accountCookie = (token: string, maxAge = 28800) => `crisis_account=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`;
  let sosSlot = false;
  try {
    if (request.method === "GET") {
      if (path === "health")
        return json({ ok: true, mode: "simulation", persistence: "D1", routingCircuit: routingCircuit.status, rateScope: "instance", highSosFlow: sosRateGuard.overloadedUntil > Date.now() });
      if (path === "account/me") {
        if (account?.role !== "citizen") return json({username:null});
        const row = await accountDB().prepare("SELECT operator_status FROM citizen_accounts WHERE id = ?").bind(account.sub).first<{operator_status:string}>();
        return json({username:account.name,operatorStatus:row?.operator_status ?? "pending"});
      }
      if (path === "operator/requests") {
        const bearer=request.headers.get("authorization"), user=bearer?.startsWith("Bearer ") ? await verifyToken(bearer.slice(7),setting("CRISIS_JWT_SECRET")) : null;
        if (user?.role !== "admin") return json({error:"Administrator girişi tələb olunur."},403);
        const result=await accountDB().prepare("SELECT id,username,created_at FROM citizen_accounts WHERE operator_status = 'pending' ORDER BY created_at ASC LIMIT 100").all();
        return json({requests:result.results});
      }
      if (path === "auth/me") {
        const bearer = request.headers.get("authorization");
        const secret = setting("CRISIS_JWT_SECRET");
        const user = bearer?.startsWith("Bearer ") ? await verifyToken(bearer.slice(7), secret) : null;
        return user && user.role !== "citizen" ? json({ role: user.role, name: user.name, expiresAt: user.exp * 1000 }) : json({ error: "Giriş tələb olunur." }, 401);
      }
      const state = await cachedState();
      if (path === "state") { const bearer = request.headers.get("authorization"); const operator = bearer?.startsWith("Bearer ") ? (["operator", "admin"].includes((await verifyToken(bearer.slice(7), setting("CRISIS_JWT_SECRET")))?.role ?? "")) : false; return json({ ...publicState(state, citizen, Date.now(), operator), security: { highSosFlow: sosRateGuard.overloadedUntil > Date.now(), rateScope: "instance" } }); }
      if (path === "routes") {
        const p = coordinates({
          lat: Number(url.searchParams.get("lat")),
          lng: Number(url.searchParams.get("lng")),
        });
        const local = routes(state,p,url.searchParams.get("accessible")==="true" || state.accessibleMode[citizen]).slice(0,3);
        const configured = setting("ROUTING_API_URL");
        const demo = url.searchParams.get("external");
        const routing = typeof configured === "string" || demo || routingCircuit.status!=="CLOSED" ? await routingCircuit.executeWithFallback(async signal => {
          if(demo==="503") throw new Error("HTTP 503 Service Unavailable");
          if(demo==="timeout") return new Promise<typeof local>(()=>{});
          if(typeof configured!=="string") return local;
          const endpoint=new URL(configured);endpoint.searchParams.set("lat",String(p.lat));endpoint.searchParams.set("lng",String(p.lng));
          const response=await fetch(endpoint,{signal,cache:"no-store"});
          if(!response.ok)throw new Error(`HTTP ${response.status} Service Unavailable`);
          const payload=await response.json() as {shelterIds?:unknown};
          if(!Array.isArray(payload.shelterIds)||!payload.shelterIds.every(x=>typeof x==="string"))throw new Error("External route response invalid");
          const ids=payload.shelterIds as string[];
          if(!local.every(r=>ids.includes(r.shelter.id)))throw new Error("External route response incomplete");
          return [...local].sort((a,b)=>ids.indexOf(a.shelter.id)-ids.indexOf(b.shelter.id));
        },()=>local) : {data:local,isFallback:false,circuit:routingCircuit.status as string};
        return json({ routes:routing.data, revision:state.revision, routing:{source:routing.isFallback?"LOCAL_FALLBACK":typeof configured==="string"?"EXTERNAL":"LOCAL",circuit:routing.circuit,reason:"reason" in routing ? routing.reason : undefined} });
      }
      if(path==="news"){
        const p=coordinates({lat:Number(url.searchParams.get("lat")),lng:Number(url.searchParams.get("lng"))});
        return json({ news:newsForPoint(state,p,state.volunteers.find(v=>v.citizenId===citizen)?.id),revision:state.revision });
      }
      return json({ error: "Endpoint tapılmadı." }, 404);
    }
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin)
      return json({ error: "Başqa saytdan dəyişiklik qəbul edilmir." }, 403);
    if (!request.headers.get("content-type")?.includes("application/json"))
      return json({ error: "application/json tələb olunur." }, 415);
    const raw = await request.text();
    if (raw.length > 10000)
      return json({ error: "Sorğu həddən böyükdür." }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "JSON düzgün deyil." }, 400);
    }
    if (!body || Array.isArray(body) || typeof body !== "object")
      return json({ error: "JSON obyekt tələb olunur." }, 400);
    if (path === "safety-lookup") {
      if (!loginLimiter.take(ip || citizen)) return json({ error: "Çox sayda cəhd. Sonra yenidən yoxlayın." }, 429);
      const code = typeof body.code === "string" ? body.code.trim().toLowerCase() : "";
      if (!/^[a-f0-9]{32}$/.test(code)) return json({ status: "unknown" });
      const state = await cachedState();
      const found = Object.values(state.safety).some(record => record.shareCode === code && Date.now() - record.at < 24 * 3600000);
      return json({ status: found ? "safe" : "unknown" });
    }
    if (path === "account/logout") return json({ ok: true }, 200, {"Set-Cookie": accountCookie("", 0)});
    if (path === "account/register" || path === "account/login") {
      const limitKey = `account:${ip || anonymousCitizen}`;
      if (!loginLimiter.take(limitKey)) return json({ error: "Çox sayda cəhd. Bir az gözləyin." }, 429);
      const secret = setting("CRISIS_JWT_SECRET");
      if (secret.length < 32 || !env.DB) return json({error:"Hesab sistemi hazır deyil."},503);
      if (!validCredentials(body.username, body.password) || (path === "account/register" && !validEmail(body.username))) return json({error:"Düzgün e-poçt ünvanı və boş olmayan şifrə daxil edin."},400);
      const username = body.username.trim().toLowerCase(), password = body.password as string;
      let id: string;
      if (path === "account/register") {
        if (["operator","admin"].includes(username)) return json({error:"Bu istifadəçi adı seçilə bilməz."},400);
        const exists = await accountDB().prepare("SELECT id FROM citizen_accounts WHERE username = ?").bind(username).first();
        if (exists) return json({error:"Bu e-poçt və ya istifadəçi adı artıq istifadə olunur."},409);
        const hashed = await makePassword(password); id = crypto.randomUUID();
        try { await accountDB().prepare("INSERT INTO citizen_accounts (id,username,password_hash,password_salt,created_at) VALUES (?,?,?,?,?)").bind(id,username,hashed.hash,hashed.salt,Date.now()).run(); }
        catch (err) { if (String(err).includes("UNIQUE")) return json({error:"Bu e-poçt və ya istifadəçi adı artıq istifadə olunur."},409); throw err; }
      } else {
        const user = await accountDB().prepare("SELECT id,password_hash,password_salt FROM citizen_accounts WHERE username = ?").bind(username).first<{id:string;password_hash:string;password_salt:string}>();
        if (!user || !(await verifyPassword(password,user.password_salt,user.password_hash))) return json({error:"İstifadəçi adı və ya şifrə yanlışdır."},401);
        id = user.id;
      }
      const token = await signToken(id,"citizen",username,secret);
      return json({username,role:"citizen"},200,{"Set-Cookie":accountCookie(token)});
    }
    if (path === "operator/approve") {
      const bearer=request.headers.get("authorization"), user=bearer?.startsWith("Bearer ") ? await verifyToken(bearer.slice(7),setting("CRISIS_JWT_SECRET")) : null;
      if (user?.role !== "admin") return json({error:"Administrator girişi tələb olunur."},403);
      if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/.test(body.id)) return json({error:"Hesab düzgün deyil."},400);
      const updated=await accountDB().prepare("UPDATE citizen_accounts SET operator_status = 'approved' WHERE id = ? AND operator_status = 'pending'").bind(body.id).run();
      return updated.meta.changes ? json({ok:true}) : json({error:"Müraciət tapılmadı."},404);
    }
    if (path === "auth/login") {
      const key = ip || citizen;
      if (!loginLimiter.take(key)) return json({ error: "Çox sayda giriş cəhdi. Bir az gözləyin.", code: "RATE_LOGIN" }, 429, { "Retry-After": String(loginLimiter.retryAfter(key)) });
      const secret = setting("CRISIS_JWT_SECRET");
      const operatorPassword = setting("CRISIS_OPERATOR_PASSWORD");
      const adminPassword = setting("CRISIS_ADMIN_PASSWORD");
      if (secret.length < 32 || !operatorPassword || !adminPassword) { console.error("Auth configuration missing", { secretLength: secret.length, operatorPresent: !!operatorPassword, adminPresent: !!adminPassword }); return json({ error: "Operator girişi konfiqurasiya edilməyib." }, 503); }
      const result = await login(body.username, body.password, { secret, operatorPassword, adminPassword });
      if (result) return json(result);
      if (validCredentials(body.username,body.password)) {
        const name=body.username.trim().toLowerCase();
        const user=await accountDB().prepare("SELECT id,password_hash,password_salt FROM citizen_accounts WHERE username = ? AND operator_status = 'approved'").bind(name).first<{id:string;password_hash:string;password_salt:string}>();
        if (user && await verifyPassword(body.password as string,user.password_salt,user.password_hash)) {
          const token=await signToken(user.id,"operator",name,secret); return json({token,role:"operator",expiresAt:Date.now()+8*3600_000});
        }
      }
      return json({ error: "İstifadəçi adı, şifrə və ya operator təsdiqi düzgün deyil." }, 401);
    }
    const allowed = [
      "sos",
      "safe",
      "accessibility",
      "checkin",
      "rules",
      "road",
      "occupancy",
      "confirm",
      "sos-view",
      "sos-dispatch",
      "team-complete",
      "scenario",
      "config",
      "resource-update", "resource-resupply",
      "volunteer-register", "volunteer-verify", "volunteer-ready", "volunteer-dispatch", "volunteer-status",
      "security-demo",
    ];
    if (!allowed.includes(path))
      return json({ error: "Endpoint tapılmadı." }, 404);
    const access = await authorize(path, request.headers.get("authorization"), setting("CRISIS_JWT_SECRET"));
    if (!access.ok) return json({ error: access.error }, access.status);
    if (path === "security-demo") return json(simulateFlood());
    if (path === "sos") {
      if (!sosRateGuard.enter()) return json({ error: "Yüksək SOS axını var. Sorğu cihaz növbəsində saxlanılır.", code: "RATE_GLOBAL" }, 503, { "Retry-After": "1" });
      sosSlot = true;
      const p = coordinates(body);
      const state = await cachedState();
      const existing = state.sos.some(item => item.citizenId === citizen && item.status === "active") ||
        (typeof body.requestId === "string" && state.receipts[`${citizen}:${body.requestId}`] !== undefined);
      if (!existing) {
        if (ip) {
          const scan = spamDetector.check({ citizenId: citizen, ip, lat: p.lat, lng: p.lng, type: String(body.type), at: Date.now() });
          if (scan.spam) return json({ error: "Şübhəli SOS axını aşkarlanıb. Bir az sonra yenidən cəhd edin.", code: "SPAM_SUSPECT", detail: scan.reason }, 429, { "Retry-After": "1" });
        }
        const fingerprint = typeof body.requestId === "string" ? body.requestId : `${body.type}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`;
        const limit = sosRateGuard.check(citizen, ip, fingerprint);
        if (!limit.allowed) return json({ error: limit.code === "RATE_CITIZEN" ? "SOS həddinə çatdınız. Bir az sonra yenidən cəhd edin." : limit.code === "RATE_IP" ? "Bu şəbəkədən çox sayda SOS gəlir. Bir az sonra yenidən cəhd edin." : "Yüksək SOS axını var. Sorğu göndərilmədi; növbədə saxlanılır.", code: limit.code }, limit.status, { "Retry-After": String(limit.retryAfter) });
      }
    }
    const result = await mutate(path, body, citizen);
    invalidateCache();
    return json({ ...publicState(result.state, citizen, Date.now(), access.role !== "citizen"), ...(path === "checkin" ? { alreadyCheckedIn: result.unchanged } : {}) });
  } catch (error) {
    if (error instanceof LegacyPasswordUnsupported) return json({error:"Əvvəlki hesabın şifrəsi bu serverdə yoxlanıla bilmir. Məlumatlar silinməyib; administratorla əlaqə saxlayın.",code:"LEGACY_PASSWORD_UNSUPPORTED"},503);
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    console.error("Crisis API error", error);
    return json(
      { error: "Server xətası. Məlumatlar qorunub. Yenidən cəhd edin." },
      503,
    );
  } finally {
    if (sosSlot) sosRateGuard.leave();
  }
}
export const GET = handle;
export const POST = handle;
