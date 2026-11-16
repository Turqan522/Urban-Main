export type SosFingerprint = { citizenId: string; ip: string; lat: number; lng: number; type: string; at: number };
export class SpamDetector {
  private recent: SosFingerprint[] = [];
  constructor(private readonly clock = Date.now) {}
  check(entry: SosFingerprint): { spam: boolean; reason?: string } {
    const now = this.clock();
    this.recent = this.recent.filter(item => now - item.at < 60_000).slice(-999);
    const sameIp = this.recent.filter(item => item.ip === entry.ip);
    const sameLocation = sameIp.filter(item => item.citizenId !== entry.citizenId && Math.abs(item.lat - entry.lat) < 0.0001 && Math.abs(item.lng - entry.lng) < 0.0001);
    if (new Set(sameLocation.map(item => item.citizenId)).size >= 3) return { spam: true, reason: "Eyni IP və nöqtədən çoxsaylı fərqli sessiya" };
    if (sameIp.length && now - sameIp[sameIp.length - 1].at < 500) return { spam: true, reason: "500 ms-dən tez ardıcıl SOS" };
    const sameSpot = this.recent.filter(item => item.type === entry.type && Math.abs(item.lat - entry.lat) < 0.0005 && Math.abs(item.lng - entry.lng) < 0.0005);
    if (sameSpot.length >= 15 && new Set(sameSpot.map(item => item.citizenId)).size >= 10) return { spam: true, reason: "Eyni nöqtədə kütləvi şübhəli SOS" };
    this.recent.push(entry);
    return { spam: false };
  }
  get size() { return this.recent.length; }
}
export const spamDetector = new SpamDetector();
