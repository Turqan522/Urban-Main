type Bucket = { tokens: number; lastRefill: number; lastSeen: number };
export type LimitResult = { allowed: true } | { allowed: false; status: 429 | 503; code: "RATE_CITIZEN" | "RATE_IP" | "RATE_GLOBAL"; retryAfter: number };

/** A synchronous token bucket. One instance represents one server process. */
export class TokenBucketLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private readonly capacity: number, private readonly perSecond: number, private readonly staleMs: number, private readonly clock = Date.now) {}
  private bucket(key: string) {
    const now = this.clock();
    const current = this.buckets.get(key) ?? { tokens: this.capacity, lastRefill: now, lastSeen: now };
    current.tokens = Math.min(this.capacity, current.tokens + Math.max(0, now - current.lastRefill) / 1000 * this.perSecond);
    current.lastRefill = now;
    current.lastSeen = now;
    this.buckets.set(key, current);
    return current;
  }
  has(key: string) { return this.bucket(key).tokens >= 1; }
  take(key: string) { const bucket = this.bucket(key); if (bucket.tokens < 1) return false; bucket.tokens -= 1; return true; }
  retryAfter(key: string) { return Math.max(1, Math.ceil((1 - this.bucket(key).tokens) / this.perSecond)); }
  prune() { const stale = this.clock() - this.staleMs; for (const [key, value] of this.buckets) if (value.lastSeen < stale) this.buckets.delete(key); }
}

export class SosRateGuard {
  readonly citizen: TokenBucketLimiter;
  readonly ip: TokenBucketLimiter;
  readonly global: TokenBucketLimiter;
  private recent = new Map<string, number>();
  private calls = 0;
  private active = 0;
  overloadedUntil = 0;
  constructor(private readonly clock = Date.now) {
    this.citizen = new TokenBucketLimiter(3, 3 / 300, 600_000, clock);
    this.ip = new TokenBucketLimiter(10, 10 / 60, 300_000, clock);
    this.global = new TokenBucketLimiter(200, 200 / 60, 120_000, clock);
  }
  enter() { if (this.active >= 24) { this.overloadedUntil = this.clock() + 60_000; return false; } this.active++; return true; }
  leave() { this.active = Math.max(0, this.active - 1); }
  check(citizenId: string, ip: string | null, fingerprint: string): LimitResult {
    const now = this.clock();
    if (++this.calls % 100 === 0) {
      this.citizen.prune(); this.ip.prune(); this.global.prune();
      for (const [key, at] of this.recent) if (now - at > 300_000) this.recent.delete(key);
    }
    const duplicate = this.recent.get(`${citizenId}:${fingerprint}`);
    if (duplicate !== undefined && now - duplicate < 5000) return { allowed: true };
    if (!this.citizen.has(citizenId)) return { allowed: false, status: 429, code: "RATE_CITIZEN", retryAfter: this.citizen.retryAfter(citizenId) };
    if (ip && !this.ip.has(ip)) return { allowed: false, status: 429, code: "RATE_IP", retryAfter: this.ip.retryAfter(ip) };
    if (!this.global.has("all")) {
      this.overloadedUntil = now + 60_000;
      return { allowed: false, status: 503, code: "RATE_GLOBAL", retryAfter: this.global.retryAfter("all") };
    }
    this.citizen.take(citizenId);
    if (ip) this.ip.take(ip);
    this.global.take("all");
    this.recent.set(`${citizenId}:${fingerprint}`, now);
    return { allowed: true };
  }
}

export const sosRateGuard = new SosRateGuard();
export const loginLimiter = new TokenBucketLimiter(5, 5 / 60, 300_000);
/** Exercise the limiter without writing fictitious emergencies to D1. */
export function simulateFlood(total = 500) {
  const guard = new SosRateGuard(() => 1_800_000_000_000);
  const counts: Record<string, number> = { accepted: 0, RATE_CITIZEN: 0, RATE_IP: 0, RATE_GLOBAL: 0 };
  const start = performance.now();
  for (let index = 0; index < total; index++) {
    const result = guard.check(`demo-${index}`, `192.0.${Math.floor(index / 256)}.${index % 256}`, `request-${index}`);
    counts[result.allowed ? "accepted" : result.code]++;
  }
  return { synthetic: true, total, counts, limiterAverageMs: (performance.now() - start) / total };
}
