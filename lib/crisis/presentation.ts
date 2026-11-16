import type { Sos } from './types';

/** Display ordering only: accessibility flag, then medical reports, then newest. */
export function compareIncidentDisplay(a: Pick<Sos, 'priority' | 'type' | 'createdAt'>, b: Pick<Sos, 'priority' | 'type' | 'createdAt'>) {
  return b.priority - a.priority || Number(b.type === 'medical') - Number(a.type === 'medical') || b.createdAt - a.createdAt;
}
