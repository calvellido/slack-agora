import type { DatabaseSync } from 'node:sqlite';
import { AnonymousConversations } from './anonymous.ts';
import { Conversations } from './conversations.ts';
import { openDatabase } from './database.ts';
import { Deliveries } from './deliveries.ts';
import { Heartbeat } from './heartbeat.ts';

export type { AnonConversation, AnonMessage, ClosedBy } from './anonymous.ts';
export type { Conversation } from './conversations.ts';
export type { Delivery } from './deliveries.ts';

/** Everything the bot keeps, in one SQLite database. `teamChannel` is the current TEAM_CHANNEL_ID. */
export class Store {
  readonly conversations: Conversations;
  readonly deliveries: Deliveries;
  readonly anonymous: AnonymousConversations;
  readonly heartbeat: Heartbeat;
  #db: DatabaseSync;

  constructor(path: string, teamChannel: string) {
    this.#db = openDatabase(path);
    this.conversations = new Conversations(this.#db, teamChannel);
    this.deliveries = new Deliveries(this.#db);
    this.anonymous = new AnonymousConversations(this.#db, teamChannel);
    this.heartbeat = new Heartbeat(this.#db);
  }

  close(): void {
    this.#db.close();
  }
}
