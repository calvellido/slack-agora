/** The Slack error code (e.g. `not_in_channel`) when there is one. */
export function errorCode(error: unknown): string {
  const data = (error as { data?: { error?: unknown } }).data;
  if (typeof data?.error === 'string') return data.error;
  return error instanceof Error ? error.message : String(error);
}
