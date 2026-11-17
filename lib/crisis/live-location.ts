import { distance } from './engine';
import type { Point } from './types';
export type LocationFix = Point & { accuracy: number; timestamp: number };
export function locationStatus(fix: LocationFix | null, nodes: Point[], now: number): 'waiting'|'stale'|'inaccurate'|'outside'|'ready' {
  if (!fix) return 'waiting';
  if (![fix.lat,fix.lng,fix.accuracy,fix.timestamp].every(Number.isFinite) || now-fix.timestamp>45000 || fix.timestamp>now+5000) return 'stale';
  if (fix.accuracy > 150 || fix.accuracy < 0) return 'inaccurate';
  if (fix.lat < 40.35 || fix.lat > 40.41 || fix.lng < 49.81 || fix.lng > 49.88 || !nodes.length || Math.min(...nodes.map(n => distance(n,fix))) > 1500) return 'outside';
  return 'ready';
}
