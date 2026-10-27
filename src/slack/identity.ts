import type { WebClient } from '@slack/web-api';

/** How the bot appears in Slack, read from its own profile. */
export interface BotIdentity {
  botId: string;
  userId: string;
  name: string;
  avatar?: string;
  /** The permissions its token has, as Slack reports them; undefined if it didn't. */
  scopes?: string[];
}

export async function botIdentity(client: WebClient): Promise<BotIdentity> {
  const auth = await client.auth.test();
  if (!auth.bot_id || !auth.user_id) throw new Error('SLACK_BOT_TOKEN is not a bot token');
  const { user } = await client.users.info({ user: auth.user_id });
  return {
    botId: auth.bot_id,
    userId: auth.user_id,
    name: user?.profile?.display_name || user?.real_name || user?.name || 'Bot',
    avatar: user?.profile?.image_72,
    scopes: auth.response_metadata?.scopes,
  };
}
