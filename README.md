# Agora

A Slack bot that a team answers together, named after the public square where a community meets.

People write to the bot, with their name or anonymously. The conversations show up as threads in the team's private channel, and
the team replies from there as the bot. Team members can also post, or start conversations, as the bot.

## For people writing to the team

- **With your name.** Write to the bot from its *Messages* tab, or @mention it in a channel it is in. The whole team
  reads it, and replies come back in the same place. The bot marks every message it receives with :incoming_envelope:.
- **Without your name.** Open *Anonymous messages*: the button on the bot's *Home* tab, `ANONYMOUS_COMMAND`, or the
  shortcut. Write there, read the team's replies there (new ones are marked 🆕), and write again. Nothing stays in
  your Slack messages, and your anonymous conversations never appear on the *Home* tab, only in that window.
- **Ending an anonymous conversation.** *End conversation* in the window. The bot then forgets it was yours, and you
  can also have it delete your messages from the team's channel. If the team ends it, or it goes 30 days without
  messages, you can still read it, or delete it, for 7 more days.
- Each person can have 3 anonymous conversations open at once.

These numbers are the defaults, and each deployment can change them (see [.env.example](.env.example)).

Everything you see on your own (the *Home* tab, the windows, messages only you see) is in your Slack language:
English or Spanish, and English for any other language.

## For the team

- **Every conversation is a thread** in the team channel. Later messages from the same person go to the same
  thread; follow it (*⋯ > Get notified about new replies*) to hear about them. A DM starts a new thread after 7 days
  without activity.
- **Replying.** Write in the thread as usual: that is internal discussion. To send a message as the bot, add
  :outbox_tray: to it. The bot sends it and marks it with :white_check_mark:. In anonymous conversations the reply
  shows in the author's window, and so do later edits; in the others, edits made after sending are not sent.
- **Posting as the bot.** `PUBLISH_COMMAND`, or the message shortcut (which copies that message), opens a form to
  post in a channel, DM people, or both. Public channels work without inviting the bot; private ones need `/invite`.
  Every post is recorded in the team channel with who made it, and a DM starts a conversation thread.
- **Deleting.** Add :wastebasket: to the team channel record of something the bot sent and the bot deletes it.
- **Anonymous conversations** arrive as *Anonymous message*, with no name or code. *End conversation* on the thread
  ends one. Once the bot no longer knows who wrote it, a delete button removes everything the bot posted in the
  thread. Team members' own replies stay until each of them deletes theirs.
- Only members of the team channel can act as the bot.

What the bot posts in the team channel is in `TEAM_LANGUAGE`, since everyone there shares it.

## When the bot is down

Slack only delivers messages to a running bot, so nothing answers while it is down.

- **No DM is lost.** The *Home* tab tells people that a message without :incoming_envelope: means the bot is
  offline. When it is back, it relays the DMs it missed, marked with when they were sent, and apologises once to each
  sender.
- **The team hears about it.** After more than 5 minutes away, or if it relayed any late DMs, the bot says in the
  team channel how long it was offline.
- **Not recovered:** @mentions made while it was down. A :outbox_tray: added while it was down does nothing: if no
  :white_check_mark: appears, remove it and add it again. Commands, buttons and windows show Slack's own error.

## Privacy

DMs and @mentions are not anonymous: the team sees who wrote them.

For anonymous messages:

- **The team** sees the text and when it was sent, nothing else. Nothing visible links two conversations from the
  same person, or someone's window to its thread.
- **The workspace owner.** The windows are not messages, so nothing the author writes or reads is in their history
  or in DM exports. An export of the team channel has the anonymous texts, without their authors.
- **People nearby** only see the conversations while the window is open.
- **Whoever runs the server** could find out who wrote an open conversation, as could anyone who gets both the
  database and `ANON_SECRET`. To show people their replies, the bot keeps a scrambled code of each author's Slack ID,
  made with that secret, until the conversation ends and the bot forgets them. Keep the secret apart from backups of
  the database, and choose carefully who has access to the server.
- **Deleted messages** disappear from the team channel and from later exports. On Enterprise plans the workspace
  owner can set a legal hold, which keeps deleted messages.
- **What people write** can identify them: details, writing style, or timing. The form warns about it.

The database keeps Slack IDs and timestamps, not message contents, which stay in Slack. The logs only contain Slack
error codes. Never run with `LOG_LEVEL=debug` in a real workspace: it can print whole messages, with names.

## Setting it up

You need Node 22.18 or later, and a machine that stays on: the bot only connects out to Slack, so it needs no
public address or open port.

1. Copy `.env.example` to `.env` and set the app's part: `APP_NAME`, the commands, `TEAM_LANGUAGE` and `ABOUT` (the
   text at the top of the *Home* tab). Run `pnpm install`, then `pnpm manifest`, which writes `manifest.yml`.
   [manifest.example.yml](manifest.example.yml) shows what you get with the defaults.
2. [Create a Slack app](https://api.slack.com/apps) *from a manifest* with that file, and install it.
3. **Basic Information > App-Level Tokens**: generate a token with the `connections:write` scope (`xapp-...`).
4. **OAuth & Permissions**: copy the Bot User OAuth Token (`xoxb-...`).
5. Create the team's private channel, run `/invite @<bot>` in it, and copy its ID from the channel details (bottom
   of *About*).
6. Generate the anonymity secret with `openssl rand -base64 32`, and keep a copy somewhere other than the server.
7. Fill in the rest of `.env` and start it: `pnpm start`.

Every setting, with its default, is described in [.env.example](.env.example). `data/` holds the database: keep it
between restarts.

**Changing the app** (its name, a command, a new version that needs other permissions): change `.env`, run
`pnpm manifest`, and paste `manifest.yml` into **App Manifest** (YAML) in the app settings. Don't change the app's
settings in Slack by hand: the next manifest would undo it.

**Changing `TEAM_CHANNEL_ID`** (for example from a test channel to the real one) is safe with the same database.
People's next messages start new threads in the new channel, and anonymous conversations from the old one drop out
of people's windows.

## Not yet

- Files are not forwarded in either direction (the team is told when a message had some).
- Editing something the bot already sent.

## Working on the code

See [ARCHITECTURE.md](ARCHITECTURE.md).
