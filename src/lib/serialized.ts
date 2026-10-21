const queues = new Map<string, Promise<unknown>>();

/** Runs tasks with the same key one after another, so messages keep their order and threads aren't duplicated. */
export function serialized<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(task);
  queues.set(key, next);
  next
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key);
    })
    .catch(() => {});
  return next;
}
