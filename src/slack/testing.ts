// For tests: stand-ins for Slack's errors, its file API and its file servers.

export const slackError = (code: string) => Object.assign(new Error(code), { data: { error: code } });

export type Call = { method: string; args: Record<string, unknown> };

/** Slack's file API as far as copying files goes, recording its calls. Copies get IDs FCOPY1, FCOPY2… */
export function fakeFileApi(calls: Call[]) {
  let next = 0;
  return {
    getUploadURLExternal: async (args: Record<string, unknown>) => {
      calls.push({ method: 'files.getUploadURLExternal', args });
      next++;
      return { upload_url: `https://files.example/upload/${next}`, file_id: `FCOPY${next}` };
    },
    completeUploadExternal: async (args: Record<string, unknown>) => {
      calls.push({ method: 'files.completeUploadExternal', args });
      if (args.channel_id === 'CNOTIN') throw slackError('not_in_channel');
      return { ok: true };
    },
    delete: async (args: Record<string, unknown>) => {
      calls.push({ method: 'files.delete', args });
      return { ok: true };
    },
    info: async ({ file }: { file: string }) => ({
      file: { id: file, permalink: `https://slack.example/files/${file}` },
    }),
  };
}

/**
 * Replaces fetch with Slack's file servers: downloads answer with three bytes (or its sign-in page, for an address
 * ending in /signin) and uploads succeed. Returns the downloads made and a way to put fetch back.
 */
export function serveFiles(): { downloads: string[]; restore(): void } {
  const real = globalThis.fetch;
  const downloads: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.startsWith('https://files.example/upload/')) return new Response('', { status: 200 });
    downloads.push(`${url} ${new Headers(init?.headers).get('authorization')}`);
    if (url.endsWith('/signin')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream' } });
  }) as typeof fetch;
  return { downloads, restore: () => (globalThis.fetch = real) };
}

/** A file attached to a message, three bytes long and downloadable. */
export function attached(name: string, fields: Record<string, unknown> = {}) {
  return {
    id: `F${name}`,
    name,
    filetype: name.split('.').pop(),
    size: 3,
    url_private_download: `https://files.slack.example/${name}`,
    ...fields,
  };
}
