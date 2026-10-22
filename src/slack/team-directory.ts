import type { WebClient } from '@slack/web-api';

/** Someone in the team channel, as the Home tab shows them. */
export interface Person {
  id: string;
  name: string;
  avatar?: string;
}

/** Who is in the team channel, which is who may act as the bot, and who reads what people write to it. */
export class TeamDirectory {
  #client: WebClient;
  #channelId: string;
  #ttlMs: number;
  #members = new Set<string>();
  #fetchedAt = 0;
  /** Each member, or null for bots and deactivated accounts, which aren't people reading. */
  #people = new Map<string, { person: Person | null; fetchedAt: number }>();

  constructor(client: WebClient, channelId: string, ttlMs = 5 * 60_000) {
    this.#client = client;
    this.#channelId = channelId;
    this.#ttlMs = ttlMs;
  }

  async isMember(userId: string): Promise<boolean> {
    return (await this.#currentMembers()).has(userId);
  }

  /** The people in the team channel, by name: its members without bots, Slackbot or deactivated accounts. */
  async people(): Promise<Person[]> {
    const found: Person[] = [];
    for (const id of await this.#currentMembers()) {
      const person = await this.#person(id);
      if (person) found.push(person);
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  async #currentMembers(): Promise<Set<string>> {
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
    return this.#members;
  }

  async #person(userId: string): Promise<Person | null> {
    const cached = this.#people.get(userId);
    if (cached && Date.now() - cached.fetchedAt < 12 * this.#ttlMs) return cached.person;
    const { user } = await this.#client.users.info({ user: userId });
    const isPerson = user && !user.is_bot && !user.deleted && userId !== 'USLACKBOT';
    const name = user?.profile?.display_name || user?.real_name || user?.name || userId;
    const person = isPerson ? { id: userId, name, avatar: user.profile?.image_72 } : null;
    this.#people.set(userId, { person, fetchedAt: Date.now() });
    return person;
  }
}
