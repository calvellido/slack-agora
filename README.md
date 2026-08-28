# Agora

A Slack bot that a team answers together, named after the public square where a community meets. People write to
the bot, and the conversations show up as threads in the team's private channel, where the team replies as the bot.
Team members can also post, or start conversations, as the bot.

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

### Languages

Everything someone sees on their own (the Home tab, the post form, messages only they see) is in their Slack
language. What the bot posts in the team channel is shared, so it is in `TEAM_LANGUAGE`. The bot speaks English
(the default, also for any language it doesn't know) and Spanish. To add a language, copy
[src/i18n/es.ts](src/i18n/es.ts), translate it, and add it to [src/i18n/index.ts](src/i18n/index.ts).

The texts call the people behind the bot "the *name* team", with the bot's name, so they read well for any team.
`ABOUT` (and `ABOUT_ES`, ...) adds a text of your own at the top of the Home tab, saying who they are. The
manifest's shortcut name and command description are in `TEAM_LANGUAGE`, since Slack shows them the same to
everyone.

## Setup

1. Copy `.env.example` to `.env` and set the app's part: `APP_NAME`, the command, `TEAM_LANGUAGE` and `ABOUT`.
   Run `pnpm install`, then `pnpm manifest`, which writes `manifest.yml`. [manifest.example.yml](manifest.example.yml)
   shows what you get with the defaults.
2. [Create a Slack app](https://api.slack.com/apps) *from a manifest* with that file, and install it.
3. **Basic Information > App-Level Tokens**: generate a token with the `connections:write` scope (`xapp-...`).
4. **OAuth & Permissions**: copy the Bot User OAuth Token (`xoxb-...`).
5. Create the team's private channel, run `/invite @<bot>` in it, and copy its ID from the channel details (bottom
   of *About*).
6. Fill in the rest of `.env` and run it (Node 22.18 or later): `pnpm start`.

**Changing the app** (its name, a command, a new version of the bot that needs other scopes): change `.env`, run
`pnpm manifest`, and paste `manifest.yml` into **App Manifest** (YAML) in the app settings. Don't edit the app's
settings in Slack by hand: the next manifest would undo it. `manifest.yml` is generated, so it isn't committed.

Socket Mode only opens an outgoing connection to Slack, so it runs on any machine without a public URL. It must
stay running for the bot to work, and `data/` holds the database: keep it between restarts.

## Data

The database stores Slack IDs and timestamps: which DM or thread belongs to which team channel thread, and what the
bot sent. Message contents stay in Slack. Logs contain Slack error codes only. Never run `LOG_LEVEL=debug` in a
real workspace: it can print whole payloads, with names and messages.

DMs to the bot are not anonymous: the team sees who wrote them.

## Not yet

- Files are not forwarded in either direction (the team is told when a message had some).
- Editing something the bot already sent.

## Development

```sh
pnpm dev        # restart on changes
pnpm test
pnpm typecheck
```
