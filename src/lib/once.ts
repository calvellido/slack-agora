/**
 * Remembers keys for `ms`: the function it returns is true the first time it sees a key, and false for that key until
 * `ms` have passed. For doing something once per message, such as telling someone about it.
 */
export function onceFor(ms: number): (key: string) => boolean {
  const seen = new Set<string>();
  return (key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    setTimeout(() => seen.delete(key), ms).unref();
    return true;
  };
}
