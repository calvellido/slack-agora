# Agora

A Slack bot that a team answers together, named after the public square where a community meets. People write to
the bot, with their name or anonymously. The conversations show up as threads in the team's private channel, and
the team replies from there as the bot. Team members can also post, or start conversations, as the bot.

Everything that names a deployment lives in `.env`: the app's name and description, the commands, the team's
language, the text introducing the team. The Slack app's manifest is built from it with `pnpm manifest`, so the two
can't drift apart. The running bot reads its name and avatar from Slack.

## What it does

- **Inbox.** A DM to the bot, or an @mention of it in a channel it is in, opens a thread in the team channel. Later
  messages from the same person go to the same thread, without a copy in the channel, so the channel only shows new
  conversations. Follow a thread (*⋯ > Get notified about new replies*) to hear about them. A DM starts a new thread
  after `INBOX_IDLE_DAYS` (7) without activity.
- **Replying.** Write in the thread as usual: that is internal discussion. To send a message as the bot, add
  :outbox_tray: to it. The bot sends it and marks it with :white_check_mark:. Edits made afterwards are not sent.
- **Posting as the bot.** `PUBLISH_COMMAND` (or the message shortcut, which prefills the text) opens a form to post
  in a channel and/or DM people. Public channels work without inviting the bot; private ones need `/invite`. Every
  post is recorded in the team channel with who made it, and DMs start a conversation thread there.
- **Deleting.** Add :wastebasket: to the team channel record of something the bot sent (the reply, the publication
  record or the DM thread) and the bot deletes it.
- Only members of the team channel can act as the bot.

### Anonymous messages

- **Where.** Everything happens in the *Anonymous messages* window, opened from the button on the bot's Home tab,
  with `ANONYMOUS_COMMAND` or with the global shortcut. It lists the person's conversations, or only general
  information if they have none. The Home tab is the same for everyone and never shows them: Slack shows the last
  published Home tab whenever the bot is opened, so a colleague glancing at the screen could see it.
- **Writing.** *New conversation* opens a form. The message arrives in the team channel as *Anonymous message*,
  with no name or code. Opening a conversation shows it as a chat, with the bot's name and avatar, and a reply box
  underneath. Later messages from the author stay inside the thread.
- **Replying.** Same as any thread: write and add :outbox_tray:. The reply appears in the author's conversation.
  Later edits to a reply also show there.
- **No notifications.** A DM saying "you have a reply" would sit in the author's history, and its time would match
  the reply in the team channel. Authors check the window instead, where new replies are marked 🆕.
- **Ending.** Both sides *end* a conversation, a different word from closing the window.
  - The author can end it from the window. The bot forgets them at once, and they can choose to have the bot delete
    everything it posted in the thread, their messages included.
  - The team can end it with the button on the thread. The author still sees it for `ANON_CLOSED_VISIBLE_DAYS` (7)
    days, and can delete their messages during that time, then the bot forgets them.
  - It ends by itself after `ANON_IDLE_DAYS` (30) days without messages from either side, and then behaves as if
    the team had ended it.
- **Deleting in the team channel.** Once the bot no longer knows who wrote a conversation, the thread shows a delete
  button: the bot deletes everything it posted there, and every record of the conversation. It can only delete its
  own messages, so team members' replies stay until each of them deletes theirs.
- Each person can have `ANON_MAX_OPEN` (3) open anonymous conversations.

### Languages

Everything someone sees on their own (the Home tab, the windows, messages only they see) is in their Slack
language. What the bot posts in the team channel is shared, so it is in `TEAM_LANGUAGE`. The bot speaks English
(the default, also for any language it doesn't know) and Spanish. To add a language, copy
[src/i18n/es.ts](src/i18n/es.ts), translate it, and add it to [src/i18n/index.ts](src/i18n/index.ts).

The texts call the people behind the bot "the *name* team", with the bot's name, so they read well for any team.
`ABOUT` (and `ABOUT_ES`, ...) adds a text of your own at the top of the Home tab, saying who they are. The
manifest's shortcut names and command descriptions are in `TEAM_LANGUAGE`, since Slack shows them the same to
everyone.

## Setup

1. Copy `.env.example` to `.env` and set the app's part: `APP_NAME`, the commands, `TEAM_LANGUAGE` and `ABOUT`.
   Run `pnpm install`, then `pnpm manifest`, which writes `manifest.yml`. [manifest.example.yml](manifest.example.yml)
   shows what you get with the defaults.
2. [Create a Slack app](https://api.slack.com/apps) *from a manifest* with that file, and install it.
3. **Basic Information > App-Level Tokens**: generate a token with the `connections:write` scope (`xapp-...`).
4. **OAuth & Permissions**: copy the Bot User OAuth Token (`xoxb-...`).
5. Create the team's private channel, run `/invite @<bot>` in it, and copy its ID from the channel details (bottom
   of *About*).
6. Generate the anonymity secret with `openssl rand -base64 32` and keep a copy somewhere other than the server.
7. Fill in the rest of `.env` and run it (Node 22.18 or later): `pnpm start`.

**Changing the app** (its name, a command, a new version of the bot that needs other scopes): change `.env`, run
`pnpm manifest`, and paste `manifest.yml` into **App Manifest** (YAML) in the app settings. Don't edit the app's
settings in Slack by hand: the next manifest would undo it. `manifest.yml` is generated, so it isn't committed.

**Changing `TEAM_CHANNEL_ID`** (for example from a test channel to the real one) is safe with the same database.
Each conversation belongs to the channel it started in, so after the change people's next messages start new
threads in the new channel. Anonymous conversations from the old channel drop out of people's window, and the bot
forgets their authors on the usual schedule.

Socket Mode only opens an outgoing connection to Slack, so it runs on any machine without a public URL. It must
stay running for the bot to work, and `data/` holds the database: keep it between restarts.

## Data

The database stores Slack IDs and timestamps: which DM or thread belongs to which team channel thread, and what the
bot sent. Message contents stay in Slack, including anonymous ones, which the window reads back from the team
channel. Logs contain Slack error codes only. Never run `LOG_LEVEL=debug` in a real workspace: it can print whole
payloads, with names and messages.

DMs to the bot are not anonymous: the team sees who wrote them, and the Home tab says so.

### What anonymity covers

- **The team** sees the text and when it was sent, nothing else. Nothing visible links two conversations from the
  same person, or the author's window to its thread: the window refers to conversations by a private random handle
  that never appears in the team channel, and the buttons in the team channel carry no identifier at all.
- **The workspace owner.** Modals are not messages, so nothing the author writes or reads is in their history or in
  DM exports. An export of the team channel has the anonymous texts, without their authors.
- **People nearby.** Conversations only show while the window is open. Opening the bot shows the same Home tab as
  for anyone else.
- **The database** holds, per open conversation, an HMAC of the author's Slack ID keyed with `ANON_SECRET`, plus
  the timestamps of their messages in the team channel. Without the secret that identifies no one. With the secret,
  anyone can compute the HMAC for every member of the workspace and find the match. So whoever runs the server can
  find out who wrote each conversation that isn't purged yet, and so could anyone who gets the database and the
  secret together. Keep the secret out of backups of `data/`.
- **Deleted messages** disappear from the team channel and from later exports. On Enterprise plans the workspace
  owner can set a legal hold, which keeps deleted messages, so deleting doesn't undo what such a hold captured.
- **What people write** can identify them: details, writing style, or timing (a message right after a meeting).
  The form warns about it.

## Not yet

- Files are not forwarded in either direction (the team is told when a message had some).
- Editing something the bot already sent.
- Files in anonymous messages.

## Development

```sh
pnpm dev        # restart on changes
pnpm test
pnpm typecheck
```
