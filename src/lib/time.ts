export const DAY = 24 * 60 * 60_000;

/** What `promise` gives if it settles within `ms`, or that it didn't; it goes on either way. */
export async function within<T>(promise: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{ done: false }>((resolve) => (timer = setTimeout(() => resolve({ done: false }), ms)));
  try {
    return await Promise.race([promise.then((value) => ({ done: true as const, value })), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** A rough duration such as `3 min`, `2 h 14 min` or `4 d 1 h`, readable in English and Spanish alike. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const [days, hours, mins] = [Math.floor(minutes / 1440), Math.floor((minutes % 1440) / 60), minutes % 60];
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}
