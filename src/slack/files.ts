import type { ImageBlock, KnownBlock } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import type { Strings } from '#src/i18n/index.ts';
import { escapeMrkdwn } from './blocks.ts';
import { errorCode } from './errors.ts';

// Copying the files of a message somewhere else: Slack doesn't share a file from one conversation into another, so the
// bot downloads each one and uploads a copy, holding it only in memory. Uploaded copies appear as the bot itself, as
// Slack ignores custom names on uploads. Images can instead be shown in an ordinary message, which can go out under
// any name, and into a public channel the bot isn't in.

/** Largest file copied, as each one is held in memory while it is copied. */
export const MAX_FILE_MB = 20;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/** The file types an image block can show. */
const IMAGE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif']);

/** Slack refuses to show an image it is still processing, so the message is tried again for about a minute. */
const IMAGE_WAITS_MS = [2, 4, 8, 15, 30].map((s) => s * 1000);

/** A file of a message, as events, message history and files.info describe it. */
export interface AttachedFile {
  id?: string | null;
  name?: string | null;
  title?: string | null;
  filetype?: string | null;
  size?: number | null;
  mode?: string | null;
  permalink?: string | null;
  url_private_download?: string | null;
}

export type FileProblem = 'tooLarge' | 'notDownloadable' | 'needsMember' | 'noPermission' | 'failed';

export interface Copies {
  /** The copies made, to delete them later. */
  fileIds: string[];
  /** The files that couldn't be copied. */
  problems: { name: string; problem: FileProblem }[];
}

class FileError extends Error {
  readonly problem: FileProblem;

  constructor(problem: FileProblem) {
    super(problem);
    this.problem = problem;
  }
}

export function isImage(file: AttachedFile): boolean {
  return IMAGE_TYPES.has((file.filetype ?? '').toLowerCase());
}

export function fileName(file: AttachedFile): string {
  return file.name || file.title || file.id || 'file';
}

function problemOf(error: unknown): FileProblem {
  if (error instanceof FileError) return error.problem;
  const code = errorCode(error);
  if (code === 'missing_scope') return 'noPermission';
  if (code === 'not_in_channel') return 'needsMember';
  return 'failed';
}

/**
 * Why a file won't be copied, when its description already says so, before trying: for a form to refuse it. With
 * `imagesOnly`, for a public channel the bot isn't in, any other file won't go either.
 */
export function foreseeProblem(file: AttachedFile, imagesOnly = false): FileProblem | undefined {
  if ((file.size ?? 0) > MAX_FILE_BYTES) return 'tooLarge';
  if (!file.url_private_download || ['external', 'hidden_by_limit', 'tombstone'].includes(file.mode ?? '')) {
    return 'notDownloadable';
  }
  if (imagesOnly && !isImage(file)) return 'needsMember';
  return undefined;
}

/** The files among `files` that won't be copied, and why, as far as their descriptions tell. */
export function foreseenProblems(files: readonly AttachedFile[], imagesOnly = false): Copies['problems'] {
  return files.flatMap((file) => {
    const problem = foreseeProblem(file, imagesOnly);
    return problem ? [{ name: fileName(file), problem }] : [];
  });
}

/** The files picked in a form's file field, in its `attachments` block: their uploader owns them, the bot copies them. */
export function filesInForm(
  values: Record<string, Record<string, { files?: AttachedFile[] }>>,
): AttachedFile[] {
  return values.attachments?.files?.files ?? [];
}

async function download(client: WebClient, file: AttachedFile): Promise<Buffer> {
  const foreseen = foreseeProblem(file);
  if (foreseen) throw new FileError(foreseen);
  const response = await fetch(file.url_private_download!, { headers: { Authorization: `Bearer ${client.token}` } });
  if (!response.ok) throw new FileError('failed');
  // Without the files:read permission, Slack answers with its sign-in page instead of the file.
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('text/html') && file.filetype !== 'html') throw new FileError('noPermission');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_FILE_BYTES) throw new FileError('tooLarge');
  return data;
}

/** Uploads a copy, which stays unshared until its upload is completed with a destination. */
async function upload(
  client: WebClient,
  file: AttachedFile,
  title = fileName(file),
): Promise<{ id: string; title: string }> {
  const data = await download(client, file);
  const name = fileName(file);
  const { upload_url, file_id } = await client.files.getUploadURLExternal({ filename: name, length: data.length });
  if (!upload_url || !file_id) throw new FileError('failed');
  const sent = await fetch(upload_url, { method: 'POST', body: new Uint8Array(data) });
  if (!sent.ok) throw new FileError('failed');
  return { id: file_id, title };
}

/** The files of `ids`, as files.info describes them; one it can't read comes back with nothing to download. */
export async function filesById(client: WebClient, ids: readonly string[]): Promise<AttachedFile[]> {
  return Promise.all(
    ids.map(async (id) => {
      try {
        return ((await client.files.info({ file: id })).file as AttachedFile | undefined) ?? { id };
      } catch {
        return { id };
      }
    }),
  );
}

/**
 * Copies files into a conversation the bot is in, as one message of the bot's own, in a thread if `threadTs`. The
 * message can carry a `header` block above the files, and each copy a `title` other than its name.
 */
export async function uploadCopies(
  client: WebClient,
  files: readonly AttachedFile[],
  to: { channel: string; threadTs?: string },
  options: { header?: KnownBlock; title?: (file: AttachedFile) => string } = {},
): Promise<Copies> {
  const copies: Copies = { fileIds: [], problems: [] };
  const uploaded: { file: AttachedFile; copy: { id: string; title: string } }[] = [];
  for (const file of files) {
    try {
      uploaded.push({ file, copy: await upload(client, file, options.title?.(file)) });
    } catch (error) {
      copies.problems.push({ name: fileName(file), problem: problemOf(error) });
    }
  }
  if (uploaded.length === 0) return copies;
  try {
    const destination = to.threadTs ? { channel_id: to.channel, thread_ts: to.threadTs } : { channel_id: to.channel };
    const files = uploaded.map((u) => u.copy) as [{ id: string; title: string }];
    const header = options.header ? { blocks: [options.header] } : {};
    await client.files.completeUploadExternal({ files, ...destination, ...header });
    copies.fileIds.push(...files.map((f) => f.id));
  } catch (error) {
    // Named as they were sent, not by the titles of their copies.
    const problem = problemOf(error);
    copies.problems.push(...uploaded.map((u) => ({ name: fileName(u.file), problem })));
  }
  return copies;
}

/**
 * Shows images in an ordinary message, which `post` sends with their blocks and which may carry any name: the copies
 * are uploaded unshared, and Slack shares them with the message. Returns the message's ts too.
 */
export async function showImages(
  client: WebClient,
  images: readonly AttachedFile[],
  post: (blocks: ImageBlock[]) => Promise<string | undefined>,
  waits: readonly number[] = IMAGE_WAITS_MS,
): Promise<Copies & { ts?: string }> {
  const copies: Copies & { ts?: string } = { fileIds: [], problems: [] };
  const shown: { id: string; title: string }[] = [];
  for (const image of images) {
    try {
      const copy = await upload(client, image);
      await client.files.completeUploadExternal({ files: [copy] });
      shown.push(copy);
    } catch (error) {
      copies.problems.push({ name: fileName(image), problem: problemOf(error) });
    }
  }
  if (shown.length === 0) return copies;

  const blocks = shown.map(({ id, title }): ImageBlock => ({ type: 'image', slack_file: { id }, alt_text: title }));
  for (let attempt = 0; ; attempt++) {
    try {
      copies.ts = await post(blocks);
      copies.fileIds.push(...shown.map((s) => s.id));
      return copies;
    } catch (error) {
      if (errorCode(error) === 'invalid_blocks' && attempt < waits.length) {
        await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
        continue;
      }
      await deleteCopies(client, shown.map((s) => s.id)).catch(() => {});
      copies.problems.push(...shown.map((s) => ({ name: s.title, problem: problemOf(error) })));
      return copies;
    }
  }
}

/** Deletes copies, which also removes the messages that held only them. */
export async function deleteCopies(client: WebClient, fileIds: readonly string[]): Promise<void> {
  for (const file of fileIds) {
    try {
      await client.files.delete({ file });
    } catch (error) {
      if (!['file_not_found', 'file_deleted'].includes(errorCode(error))) throw error;
    }
  }
}

/** The names of the files of `files` that were copied: those without a problem. */
export function copiedNames(files: readonly AttachedFile[], problems: Copies['problems']): string[] {
  const failed = problems.map((p) => p.name);
  return files.map(fileName).filter((name) => {
    const at = failed.indexOf(name);
    if (at === -1) return true;
    failed.splice(at, 1);
    return false;
  });
}

/**
 * What went wrong with each file, for the team or, without the technical details, for the person: one per line in a
 * message, or one after the other in `plain` text, as for a form's error.
 */
export function describeProblems(
  t: Strings,
  problems: Copies['problems'],
  audience: 'team' | 'person',
  format: 'mrkdwn' | 'plain' = 'mrkdwn',
): string {
  const lines = problems.map(({ name, problem }) => {
      const params = { name: format === 'plain' ? name : escapeMrkdwn(name) };
      if (problem === 'tooLarge') return t.files.tooLarge({ ...params, max: MAX_FILE_MB });
      if (problem === 'notDownloadable') return t.files.notDownloadable(params);
      if (audience === 'team' && problem === 'needsMember') return t.files.needsMember(params);
      if (audience === 'team' && problem === 'noPermission') return t.files.noPermission(params);
      return t.files.failed(params);
  });
  return format === 'plain' ? lines.join('; ') : lines.map((line) => `• ${line}`).join('\n');
}
