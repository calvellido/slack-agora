# Architecture

How Agora is built. If you just want to use it, you only need the [README](README.md).

## The big picture

Agora is one long-running Node process. It connects to Slack with [Bolt](https://docs.slack.dev/tools/bolt-js) in **Socket Mode**: the process opens a WebSocket to Slack and receives every event (DMs, mentions, reactions, commands, button clicks, form submissions) through it, then acts through Slack's Web API. Nothing connects to the machine it runs on, so it needs no public URL, but it must stay running: events sent while it isn't connected can be lost (see "After downtime" below).

It keeps a small SQLite database (`node:sqlite`, no dependency) with Slack IDs, timestamps and keyed hashes only. Message contents stay in Slack: anything the bot shows again, such as an anonymous conversation, is read back from the team channel.

TypeScript runs directly with Node's type stripping: there is no build step, and imports name `.ts` files.

**Imports** come in three groups: packages; then `#src/…` for another part of the app (`#src/slack/blocks.ts`); then `./…` for a file in the same folder. `#src/*` is a Node subpath import declared in `package.json`, so Node resolves it at run time and TypeScript when type checking; `tsconfig.json` `paths` would only do the latter. The shorter `#/*` needs a newer Node than the 22 this project supports.

## Code map

```text
src/
  main.ts            Entry point: settings, database, Slack connection, features, start, background work.
  config.ts          Reads .env: AppSettings (what names the deployment, shared with the manifest) and Config.
  deps.ts            Deps: the shared services every feature receives.

  lib/               Generic helpers, nothing Slack-specific.
    serialized.ts      Runs tasks with the same key one after another.
    time.ts            DAY, and durations such as "2 h 14 min".

  slack/             Slack plumbing shared by the features.
    identity.ts        The bot's own name, avatar and IDs, read from Slack at start.
    team-directory.ts  Who is in the team channel, which is who may act as the bot.
    messages.ts        Fetching a message or thread, and posting in a thread that may no longer exist.
    blocks.ts          Small Block Kit pieces: context lines, quoted messages, dates, modal titles.
    richtext.ts        Rich text from and to what people type, and plain-text fallbacks.
    errors.ts          The Slack error code of a failed call.

  storage/           The SQLite database, one file per kind of data. Store (index.ts) groups them.
    database.ts        Schema and migrations.
    conversations.ts   Conversations by DM or @mention, and their thread in the team channel.
    deliveries.ts      What the bot sent on the team's behalf, so it can be deleted later.
    anonymous.ts       Anonymous conversations and which of their messages came from whom.
    heartbeat.ts       When the bot was last running.

  i18n/              Texts. en.ts is the reference; es.ts has the same keys. index.ts picks each person's language.

  inbox/             Conversations by DM or @mention.
    relay.ts           Posts a message in its conversation thread, or starts a new thread.
    dms.ts             DMs, live and caught up after downtime.
    mentions.ts        @mentions in other channels.
    replies.ts         The team's reactions: send a reply as the bot, delete what it sent.
    downtime.ts        The heartbeat, which DMs were missed, and the "back online" note.

  publish/           Posting as the bot.
    index.ts           The command, the message shortcut, and the form submission.
    form.ts            The form, and whether the bot can post in the chosen channel.
    send.ts            Posting in a channel or DMing someone, and the record left in the team channel.

  home/              The Home tab, the same for everyone in their language.

  anonymous/         Anonymous mode.
    window.ts          The author's side: the "Anonymous messages" window and everything done from it.
    team.ts            The team's side: thread buttons, replies, withdrawn replies, the hourly cleanup.
    thread.ts          What the bot posts in the team channel for an anonymous conversation.
    views.ts           The Block Kit views of both sides.
    keys.ts            The keyed hash that links a conversation to its author, and the private handle.

  manifest/          The Slack app's manifest.
    index.ts           Builds it from AppSettings and what the code needs (scopes, events, callback IDs).
    cli.ts             `pnpm manifest`.
```

Each feature exports a `register…(app, deps)` function that adds its Bolt listeners; `main.ts` calls them in turn. Tests sit next to the code they cover, as `*.test.ts`.

## How a message travels

**A DM to the bot** (`inbox/dms.ts`). The `message` event arrives; `relay` posts it in the person's open thread in the team channel, or starts one (a new `conversations` row), and the bot reacts with :incoming_envelope: to mark it as received. A team member writes a reply in the thread and adds the send emoji: `inbox/replies.ts` finds the conversation by the thread, claims a `deliveries` row (so it is sent only once), posts the reply in the DM as the bot, and marks the team member's message with :white_check_mark:.

**An anonymous message** (`anonymous/`). The author submits the form in their window (`window.ts`); `thread.ts` posts it in the team channel as *Anonymous message* and records the conversation, with the author's keyed hash as its owner. A team reply with the send emoji goes through `inbox/replies.ts` to `anonymous/team.ts`, which only records it: the author's window reads it back from the thread when opened.

**After downtime** (`inbox/downtime.ts`). On start, the bot compares the last heartbeat with now, lists its DM conversations, relays every DM since then that lacks its :incoming_envelope:, apologises to each sender, and posts a note in the team channel if it was away more than 5 minutes.

## Data model

| Table | Holds |
| --- | --- |
| `conversations` | DM and mention conversations: who, where replies go, their thread in the team channel |
| `deliveries` | What the bot sent as the team: the record in the team channel, and the message it sent |
| `anon_conversations` | Anonymous conversations: private handle, thread, owner hash (cleared once purged), state |
| `anon_messages` | Which messages of an anonymous thread came from the author or the team (deleted once purged) |
| `meta` | The last heartbeat |

Conversations store the team channel their thread is in, and lookups only match the current `TEAM_CHANNEL_ID`. Expiring and purging anonymous conversations covers every channel, so no author link outlives its schedule.

## Rules that keep anonymity

Break one of these and anonymous mode stops being anonymous:

- **The author's Slack ID is never stored**, only `anonOwner(userId)`, an HMAC keyed with `ANON_SECRET`. It is cleared (`purge`) as soon as the conversation is forgotten.
- **Anonymous conversations live in modals, never on the Home tab.** Slack shows the last published Home tab when the bot is opened, before the bot can replace it, so anything on it can be seen over someone's shoulder. The Home tab is the same for everyone.
- **Nothing visible links the author's window to the thread.** The window refers to conversations by a random handle that never goes into the team channel; the team's buttons carry no value and find the conversation by the message they are on.
- **No DMs to the author.** A notification would stay in their history, and its time would match the reply in the team channel.
- **No message contents or user IDs in logs.** `app.error` logs Slack error codes only.

## Things that were fixed by usage tests

- **`reply_broadcast` is not used**: replies stay in their thread, and copies in the channel only added noise.
- **A thread can disappear.** If its first message was deleted (or the thread is in another channel), Slack silently posts a "reply" as a standalone message. `postInThread` checks, takes it back, and lets the caller start over.
- **node:sqlite returns null-prototype objects**; `row()` in `storage/database.ts` hands out plain ones.
- **Modal titles are limited to 24 characters**, and the bot's name goes in some: use `modalTitle()`.
- **Slack's 3-second limit**: commands, actions and form submissions must be acknowledged quickly. Anonymous form submissions post first and acknowledge after, so the author only sees "sent" once it is in the team channel.

## Languages

`i18n/en.ts` returns every text, built with the names it mentions (the bot's name and the commands). Every other language returns the same keys, which the type checker and a test enforce. `I18n` reads each person's Slack locale (`users.info`, cached for an hour) and falls back to English. What only one person sees uses `i18n.forUser(id)`; what the bot posts in the team channel uses `i18n.team`, in `TEAM_LANGUAGE`.

To add a language: copy `es.ts`, translate it, and list it in `LANGUAGES` in `i18n/index.ts`.

## The Slack app's manifest

The app's settings in Slack are generated, never edited by hand. `manifest/index.ts` combines AppSettings (name, description, commands, language and the about text, from `.env`) with what the code needs (scopes, events, the shortcut callback IDs its handlers listen for). `pnpm manifest` writes `manifest.yml` for the deployment, which is not committed; `pnpm manifest --example` writes `manifest.example.yml` with the defaults, and a test fails if it is out of date. If you add an API call that needs a new scope, add it to `BOT_SCOPES`.

## Working on it

```sh
pnpm install
pnpm dev                  # runs with .env, restarting on changes
pnpm test                 # node:test, every src/**/*.test.ts
pnpm typecheck
pnpm manifest             # writes manifest.yml from .env
pnpm manifest --example   # updates manifest.example.yml
```

Use a test workspace or a test team channel for `.env`, and run a single copy per Slack app: Slack spreads events across every open connection.
