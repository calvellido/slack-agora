import type { WebClient } from '@slack/web-api';

/** Who is in the team channel, which is who may act as the bot. */
export class TeamDirectory {
  #client: WebClient;
  #channelId: string;
  #ttlMs: number;
  #members = new Set<string>();
  #fetchedAt = 0;

  constructor(client: WebClient, channelId: string, ttlMs = 5 * 60_000) {
    this.#client = client;
    this.#channelId = channelId;
    this.#ttlMs = ttlMs;
  }

  async isMember(userId: string): Promise<boolean> {
    if (Date.now() - this.#fetchedAt > this.#ttlMs) {
      const members = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await this.#client.conversations.members({ channel: this.#channelId, cursor, limit: 200 });
        for (const id of page.members ?? []) members.add(id);
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      this.#members = members;
      this.#fetchedAt = Date.now();
    }
    return this.#members.has(userId);
  }
}
