# Architecture

How Agora is built. If you just want to use or run it, see the [README](README.md) and the [guide](GUIDE.md).

## The big picture

Agora is one long-running Node process. It connects to Slack with [Bolt](https://docs.slack.dev/tools/bolt-js) in _Socket Mode_: the process opens a WebSocket to Slack and receives every event (DMs, mentions, reactions, commands, button clicks, form submissions) through it, then acts through Slack's Web API. Nothing connects to the machine it runs on, so it needs no public URL, but it must stay running: events sent while it isn't connected can be lost (see "After downtime" below).

It keeps a small SQLite database (`node:sqlite`, no dependency) with Slack IDs, timestamps and keyed hashes only. Message contents stay in Slack: anything the bot shows again, such as an anonymous conversation, is read back from the team channel.

TypeScript runs directly with Node's type stripping: there is no build step, and imports name `.ts` files.

Imports come in three groups: packages; then `#src/…` for another part of the app (`#src/slack/blocks.ts`); then `./…` for a file in the same folder. `#src/*` is a Node subpath import declared in `package.json`, so Node resolves it at run time and TypeScript when type checking; `tsconfig.json` `paths` would only do the latter.

## Code map

```text
src/
  main.ts            Entry point: settings, database, Slack connection, features, start, background work.
  config.ts          Reads .env: AppSettings (what names the deployment, shared with the manifest) and Config.
  deps.ts            Deps: the shared services every feature receives.

  lib/               Generic helpers, nothing Slack-specific.
    serialized.ts      Runs tasks with the same key one after another.
    time.ts            DAY, and durations such as "2 h 14 min".
    url.ts             Addresses as people read them, without https://.
    version.ts         The version that is running, from package.json.

  slack/             Slack plumbing shared by the features.
    identity.ts        The bot's own name, avatar and IDs, read from Slack at start.
    team-directory.ts  Who is in the team channel: who may act as the bot, and who the Home tab can list.
    messages.ts        Fetching a message or thread, and posting in a thread that may no longer exist.
    blocks.ts          Small Block Kit pieces: context lines, quoted messages, dates, modal titles.
    richtext.ts        Rich text from and to what people type, and plain-text fallbacks.
    errors.ts          The Slack error code of a failed call.
    notices.ts         Posting the bot's notices in the team channel, under their own name and icon.

  storage/           The SQLite database, one file per kind of data. Store (index.ts) groups them.
    database.ts        Schema, migrations, and emptying it.
    conversations.ts   Conversations by DM or @mention, and their thread in the team channel.
    deliveries.ts      What the bot sent on the team's behalf, so it can be deleted later.
    anonymous.ts       Anonymous conversations and which of their messages came from whom.
    heartbeat.ts       When the bot was last running.
    cli.ts             `pnpm clean-db`.

  i18n/              Texts, from locales/*.yml.
    index.ts           Each person's language, and the texts built for it.
    catalog.ts         Reading the locale files, and the values each message takes.
    messages.ts        The Strings type, generated from locales/en.yml by `pnpm i18n`.
    generate.ts        Generating that type, and checking the other languages against English.
    cli.ts             `pnpm i18n`.

  inbox/             Conversations by DM or @mention.
    relay.ts           Posts a message in its conversation thread, or starts a new thread.
    dms.ts             DMs: live, written in the form, and caught up after downtime.
    write.ts           The form to write with your name, from the command, the shortcut or the Home tab.
    mentions.ts        @mentions in other channels.
    replies.ts         The team's reactions: send a reply as the bot, delete what it sent.
    downtime.ts        The heartbeat, which DMs were missed, and the "back online" note.

  publish/           Posting as the bot.
    index.ts           The Home tab button, the optional command and message shortcut, and the form submission.
    form.ts            The form, and whether the bot can post in the chosen channel.
    send.ts            Posting in a channel or DMing someone, and the record left in the team channel.

  home/              The Home tab, the same for everyone in their language, plus a part for team members.
    index.ts           Publishes it whenever someone opens it.
    view.ts            Its blocks.

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

A DM to the bot (`inbox/dms.ts`). The `message` event arrives; `relay` posts it in the person's open thread in the team channel, or starts one (a new `conversations` row), and the bot reacts with :incoming_envelope: to mark it as received. A message written in the form (`inbox/write.ts`) takes the same path: `dms.write` opens the person's DM with the bot, relays the message as if it had arrived there, and posts a copy of it in the DM, where the team's replies will arrive. A team member writes a reply in the thread and adds the send emoji: `inbox/replies.ts` finds the conversation by the thread, claims a `deliveries` row (so it is sent only once), posts the reply in the DM as the bot, and marks the team member's message with :white_check_mark:.

An anonymous message (`anonymous/`). The author submits the form in their window (`window.ts`); `thread.ts` posts it in the team channel as *Anonymous message* and records the conversation, with the author's keyed hash as its owner. A team reply with the send emoji goes through `inbox/replies.ts` to `anonymous/team.ts`, which only records it: the author's window reads it back from the thread when opened.

After downtime (`inbox/downtime.ts`). On start, the bot compares the last heartbeat with now, lists its DM conversations, relays every DM since then that lacks its :incoming_envelope:, apologises to each sender, and posts a note in the team channel if it was away more than 5 minutes.

## Data model

Slack keeps the messages, but not the links between them: nothing in Slack says that a thread in the team channel belongs to a given DM. The database keeps those links, and a little state, never message contents.

| Table | Holds | Needed so that |
| --- | --- | --- |
| `conversations` | DM and mention conversations: who, where replies go, their thread in the team channel | A reply sent from a thread reaches the right person, and their next message continues the same thread |
| `deliveries` | What the bot sent as the team: the record in the team channel, and the message it sent | The delete emoji can remove it later, and adding the send emoji twice doesn't send twice |
| `anon_conversations` | Anonymous conversations: private handle, thread, owner hash (cleared once purged), state | The author's window finds their conversations, and conversations end and are forgotten on schedule |
| `anon_messages` | Which messages of an anonymous thread came from the author or the team (deleted once purged) | The window shows only those, never the team's internal discussion in the same thread |
| `meta` | The last heartbeat | After downtime, the bot knows which DMs it missed and how long it was away |

### Why is a database needed?

The links for DMs and mentions could be hidden in message metadata, but finding a DM's thread would mean scanning the team channel's history on every message, which is slow and runs into rate limits. The link between an anonymous conversation and its author can't be in Slack at all: the workspace owner can read anything there, through exports or admin tools. It has to live outside Slack, under the control of whoever runs the bot, and be deletable, so the bot can forget the author once a conversation ends.

SQLite is used as the DB engine since is built into Node (`node:sqlite`), with no database server to run. Just one file in `data/`. The bot stores a few thousand rows a year at most so this shouldn't be an issue.

Conversations store the team channel their thread is in, and lookups only match the current `TEAM_CHANNEL_ID`. Expiring and purging anonymous conversations covers every channel, so no author link outlives its schedule.

## Who speaks: the team or the bot

The bot's own identity is only the team's voice: replies sent with the send emoji, and posts and DMs sent from the publish form. Everything the bot does on its own goes through `Notices` (`slack/notices.ts`), under a sender of its own, the bot's name with " · notices" and a robot icon (`chat:write.customize`): the messages it relays into the team channel, anonymous messages, what it reports there (a conversation ending or expiring, a reply withdrawn, a deletion, a failure, the bot back online, the record of something the team posted, the notices only one person sees) and its automatic replies in people's DMs. Short notices and automatic replies show as a small grey line; relayed and anonymous messages keep their full layout. The sender's name is in the team's language in the team channel, and in each person's language in their DM. A new kind of message should go through `Notices` unless it is something the team says.

## Why anonymous messages don't use the Messages tab

The Messages tab is a DM between the person and the bot, and a DM is stored under the person's name. On Business+ and Enterprise plans the workspace owner can export DMs, and the export would show that person writing the same text that appears anonymously in the team channel. Receiving only the replies by DM would give them away just the same, since each reply appears word for word in their DM and in the team thread.

Modals, the forms and windows apps open, are not messages: Slack keeps them out of people's history and out of exports. So the author writes through a form and reads the replies in a window, which the bot rebuilds from the team channel every time it opens. For the same reason the bot never notifies authors by DM, and their conversations never appear on the Home tab, which Slack keeps and shows whenever the bot is opened.

## Rules that keep anonymity

- The author's Slack ID is never stored, only `anonOwner(userId)`, an HMAC keyed with `ANON_SECRET`. It is cleared (`purge`) as soon as the conversation is forgotten.
- Anonymous conversations live in modals, never on the Home tab. Slack shows the last published Home tab when the bot is opened, before the bot can replace it, so anything on it can be seen over someone's shoulder. The Home tab is the same for everyone, apart from the part only team members get.
- Nothing visible links the author's window to the thread. The window refers to conversations by a random handle that never goes into the team channel; the team's buttons carry no value and find the conversation by the message they are on.
- No DMs to the author. A notification would stay in their history, and its time would match the reply in the team channel.
- No message contents or user IDs in logs. `app.error` logs Slack error codes only.

Break one of these and anonymous mode stops being anonymous.

## Things that were fixed by usage tests

- `reply_broadcast` is not used: replies stay in their thread, and copies in the channel only added noise.
- A thread can disappear. If its first message was deleted (or the thread is in another channel), Slack silently posts a "reply" as a standalone message. `postInThread` checks, takes it back, and lets the caller start over.
- node:sqlite returns null-prototype objects; `row()` in `storage/database.ts` hands out plain ones.
- Modal titles are limited to 24 characters, and the bot's name goes in some: use `modalTitle()`.
- Slack's 3-second limit: commands, actions and form submissions must be acknowledged quickly. Anonymous form submissions post first and acknowledge after, so the author only sees "sent" once it is in the team channel.

## Languages

The texts live in `locales/`, one YAML file per language, grouped by feature as the code is. They are written in [ICU MessageFormat](https://formatjs.github.io/docs/core-concepts/icu-syntax): `{user}` is a value, and `{days, plural, one {# day} other {# days}}` picks the right form for each language. `{bot}`, `{publishCommand}` and `{anonymousCommand}` are filled in everywhere.

English is the reference. `pnpm i18n` reads `locales/en.yml` and generates `src/i18n/messages.ts`, the `Strings` type, where a text that takes values is a function with those values named and typed: `t.inbox.thread.mentionHeader({ user, channel, permalink })`. Calling a text with a missing or wrong value fails the type check, and a test fails if the type is out of date with the English file. The same command checks the other languages: a translation can't use values the English text doesn't, nor keys it doesn't have, and must be valid ICU. A language may leave texts out; those show in English, and the command lists them.

`I18n` reads each person's Slack locale (`users.info`, cached for an hour) and falls back to English. What only one person sees uses `i18n.forUser(id)`; what the bot posts in the team channel uses `i18n.team`, in `TEAM_LANGUAGE`.

To add a language, copy `locales/en.yml` to `locales/<code>.yml`, with the language's code as Slack reports it (`fr` for `fr-FR`), translate what you can, and run `pnpm i18n`. To add a text, add it to `locales/en.yml`, run `pnpm i18n`, and translate it in the other files. To reword one, edit it and run `pnpm generate`, which also updates `manifest.example.yml` if it is one of the manifest's texts. The tests build what they expect from the same keys, so they don't depend on the wording.

## The Slack app's manifest

The app's settings in Slack are generated, never edited by hand. `manifest/index.ts` combines AppSettings (name, description, commands, language and the about text, from `.env`) with what the code needs (scopes, events, the shortcut callback IDs its handlers listen for). `pnpm manifest` writes `manifest.yml` for the deployment, which is not committed; `pnpm manifest --example` writes `manifest.example.yml` with the defaults, and a test fails if it is out of date. If you add an API call that needs a new scope, add it to `BOT_SCOPES`.

## Working on it

```sh
pnpm install
pnpm dev                  # runs with .env, restarting on changes
pnpm test                 # node:test, every src/**/*.test.ts
pnpm typecheck
pnpm check                # typecheck and test, as CI does
pnpm generate             # updates the generated files that are committed: the texts' types and manifest.example.yml
pnpm manifest             # writes manifest.yml from .env (--stdout prints it instead)
pnpm manifest --example   # updates manifest.example.yml
pnpm i18n                 # updates the texts' types from locales/en.yml, and checks the translations
pnpm clean-db             # empties the database, after asking
```

Use a test workspace or a test team channel for `.env`, and run a single copy per Slack app: Slack spreads events across every open connection.

## Releasing

CI (`.github/workflows/ci.yml`) runs `pnpm check` on every push to main and every pull request.

Changes go under *Unreleased* at the top of `CHANGELOG.md` as they are made, saying what deployers have to do, such as pasting a new manifest. To release them, give that section the new version and date (`## [1.1.0] - 2026-10-22`) and commit it. Then:

```sh
pnpm version patch        # or minor, or major
git push --follow-tags
```

`pnpm version` runs `pnpm check`, sets the new version in `package.json`, checks that the changelog has its section, and commits and tags it (`chore: release v1.0.1`, `v1.0.1`). If the changelog lacks the section it stops before committing: add it, undo the version change with `git checkout package.json`, and run it again. Pushing the tag starts the release workflow (`.github/workflows/release.yml`), which runs the tests, checks that the tag matches `package.json`, publishes the Docker image for linux/amd64 and linux/arm64, and creates the GitHub release with the changelog section as its notes.

The `Dockerfile` builds the image from `src/` and `locales/` only (see `.dockerignore`). Its entry point, `docker/entrypoint.sh`, runs the bot by default, or `manifest` or `clean-db`, each reading `.env` itself, as `pnpm start` does. `compose.yaml` is what Docker deployments run, and each release attaches it and `.env.example` (as `env.example`), so the README and the guide can link to the latest ones. GitHub creates the image's package as private: after the first release, make it public in the package's settings, so anyone can pull it.
