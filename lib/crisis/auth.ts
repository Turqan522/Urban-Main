import { timingSafeEqual } from "node:crypto";

export type Role = "citizen" | "operator" | "admin";
export type JwtPayload = { sub: string; role: Role; name: string; iat: number; exp: number };
const permissions: Record<string, Role[]> = {
  sos: ["citizen", "operator", "admin"], safe: ["citizen", "operator", "admin"], checkin: ["citizen", "operator", "admin"], accessibility: ["citizen", "operator", "admin"],
  "volunteer-register": ["citizen", "operator", "admin"], "volunteer-ready": ["citizen", "operator", "admin"], "volunteer-status": ["citizen", "operator", "admin"],
  "sos-view": ["operator", "admin"], "sos-dispatch": ["operator", "admin"], road: ["operator", "admin"], occupancy: ["operator", "admin"], confirm: ["operator", "admin"], "team-complete": ["operator", "admin"], scenario: ["operator", "admin"],
  "volunteer-verify": ["operator", "admin"], "volunteer-dispatch": ["operator", "admin"], "resource-update": ["operator", "admin"], "resource-resupply": ["operator", "admin"],
  config: ["admin"], rules: ["admin"],
  "security-demo": ["operator", "admin"],
};
const encoder = new TextEncoder();
const base64url = (value: Uint8Array | string) => Buffer.from(value).toString("base64url");
const parse = (value: string) => JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
async function key(secret: string) { return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); }

export async function signToken(sub: string, role: Role, name: string, secret: string, now = Date.now()) {
  if (secret.length < 32) throw new Error("CRISIS_JWT_SECRET must have at least 32 characters");
  const iat = Math.floor(now / 1000);
  const payload: JwtPayload = { sub, role, name, iat, exp: iat + 8 * 3600 };
  const data = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(data));
  return `${data}.${base64url(new Uint8Array(signature))}`;
}
export async function verifyToken(token: string, secret: string, now = Date.now()): Promise<JwtPayload | null> {
  try {
    if (secret.length < 32) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || token.length > 4096) return null;
    const header = parse(parts[0]);
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
    const valid = await crypto.subtle.verify("HMAC", await key(secret), Buffer.from(parts[2], "base64url"), encoder.encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return null;
    const data = parse(parts[1]);
    const time = Math.floor(now / 1000);
    if (typeof data.sub !== "string" || typeof data.name !== "string" || !["citizen", "operator", "admin"].includes(String(data.role)) || typeof data.iat !== "number" || typeof data.exp !== "number" || data.iat > time + 60 || data.exp <= time || data.exp - data.iat > 8 * 3600) return null;
    return data as JwtPayload;
  } catch { return null; }
}
function equal(a: string, b: string) {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export async function login(username: unknown, password: unknown, config: { secret: string; operatorPassword: string; adminPassword: string }) {
  if (typeof username !== "string" || typeof password !== "string") return null;
  const role = username === "operator" && equal(password, config.operatorPassword) ? "operator" : username === "admin" && equal(password, config.adminPassword) ? "admin" : null;
  if (!role) return null;
  const token = await signToken(username, role, username, config.secret);
  return { token, role, expiresAt: Date.now() + 8 * 3600_000 };
}
export async function authorize(action: string, bearer: string | null, secret: string): Promise<{ ok: true; role: Role } | { ok: false; status: 401 | 403 | 404; error: string }> {
  const allowed = permissions[action];
  if (!allowed) return { ok: false, status: 404, error: "Əməliyyat tapılmadı." };
  if (!bearer && allowed.includes("citizen")) return { ok: true, role: "citizen" };
  if (!bearer?.startsWith("Bearer ")) return { ok: false, status: 401, error: "Operator girişi tələb olunur." };
  const user = await verifyToken(bearer.slice(7), secret);
  if (!user) return { ok: false, status: 401, error: "Giriş vaxtı bitib və ya token etibarsızdır." };
  if (!allowed.includes(user.role)) return { ok: false, status: 403, error: "Bu əməliyyat üçün rol icazəsi yoxdur." };
  return { ok: true, role: user.role };
}
