/** Persisted status is a cache; timestamps are authoritative (inclusive open, exclusive close). */
export function effectivePeriodStatus(period: { open_at: string; close_at: string }, now = Date.now()): 'PLANNED' | 'OPEN' | 'CLOSED' {
  const opening = Date.parse(period.open_at), closing = Date.parse(period.close_at);
  if (!Number.isFinite(opening) || !Number.isFinite(closing) || opening >= closing) throw new Error('Invalid registration window');
  return now < opening ? 'PLANNED' : now < closing ? 'OPEN' : 'CLOSED';
}
