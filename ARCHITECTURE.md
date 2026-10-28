# Architecture

How Agora is built. If you just want to use or run it, see the [README](README.md) and the [guide](GUIDE.md).

## The big picture

Agora is one long-running Node process. It connects to Slack with [Bolt](https://docs.slack.dev/tools/bolt-js) in _Socket Mode_: the process opens a WebSocket to Slack and receives every event (DMs, mentions, reactions, commands, button clicks, form submissions) through it, then acts through Slack's Web API. Nothing connects to the machine it runs on, so it needs no public URL, but it must stay running: events sent while it isn't connected can be lost (see "After downtime" below).

It keeps a small SQLite database (`node:sqlite`, no dependency) with Slack IDs, timestamps and keyed hashes, and the text of anonymous conversations, encrypted. Every other message's text stays in Slack, and anything the bot shows again is read back from it.

TypeScript runs directly with Node's type stripping: there is no build step, and imports name `.ts` files.

Imports come in three groups: packages; then `#src/…` for another part of the app (`#src/slack/blocks.ts`); then `./…` for a file in the same folder. `#src/*` is a Node subpath import declared in `package.json`, so Node resolves it at run time and TypeScript when type checking; `tsconfig.json` `paths` would only do the latter.

## Code map

```text
src/
  main.ts            Entry point: settings, database, Slack connection, features, start, background work, console.
  launcher.ts        What `pnpm start` runs: main.ts in a process of its own, started again when it asks to.
  config.ts          Reads .env: AppSettings (what names the deployment, shared with the manifest) and Config,
                     running ANON_SECRET_COMMAND when the secret comes from the keychain.
  deps.ts            Deps: the shared services every feature receives.
  log.ts             The log, shared with Bolt and the Slack clients, and its levels, trace included.
  activity.ts        What the bot did since it started, in counts and times, for the console's status.
  monitor.ts         Calls HEARTBEAT_URL while connected to Slack, for a monitor to alert when the calls stop.
  updated.ts         Telling the team channel when the bot starts on another version than it last ran.

  console/           Commands typed in the bot's terminal.
    index.ts           Reading them, and printing log lines above what is being typed.
    commands.ts        status, log, restart and update.
    status.ts          How the bot is doing, in counts and times.
    update.ts          Finding a newer release among the repository's tags, and installing it.
    restart.ts         How the bot asks the launcher to start it again.

  lib/               Generic helpers, nothing Slack-specific.
    once.ts            Doing something once per key, such as telling someone about a message once.
    serialized.ts      Runs tasks with the same key one after another.
    time.ts            DAY, and durations such as "2 h 14 min".
    url.ts             Addresses as people read them, without https://.
    version.ts         The version that is running, from package.json, and comparing versions.

  slack/             Slack plumbing shared by the features.
    identity.ts        The bot's own name, avatar, IDs and permissions, read from Slack at start.
    connection.ts      Following the Socket Mode connection as it opens and is lost.
    team-directory.ts  Who is in the team channel: who may act as the bot, and who the Home tab can list.
    messages.ts        Fetching a message or thread, and posting in a thread that may no longer exist.
    blocks.ts          Small Block Kit pieces: context lines, quoted messages, dates, modal titles.
    richtext.ts        Rich text from and to what people type, and plain-text fallbacks.
    errors.ts          The Slack error code of a failed call.
    notices.ts         Posting the bot's notices in the team channel, under their own name and icon.
    files.ts           Copying the files of messages: downloads, uploads, images shown in a message, what went wrong.
    testing.ts         Stand-ins for Slack's errors, file API and file servers, for tests.
    unknown-shortcuts.ts  Logging shortcuts the app settings have but this version doesn't.

  storage/           The SQLite database, one file per kind of data. Store (index.ts) groups them.
    database.ts        Schema, migrations, and emptying it.
    conversations.ts   Conversations by DM or @mention, and their thread in the team channel.
    deliveries.ts      What the bot sent on the team's behalf, so it can be deleted later.
    relays.ts          What relaying each DM posted in the team channel, so the copy can follow its edits.
    anonymous.ts       Anonymous conversations, their keys, and their messages: from whom, and their encrypted text.
    heartbeat.ts       When the bot was last running, and which version.
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
    changes.ts         Edits and deletions of DMs, which the team's copy follows.
    write.ts           The form to write with your name, from the command, the shortcut or the Home tab.
    mentions.ts        @mentions in other channels.
    replies.ts         The team's reactions: send a reply as the bot, delete what it sent.
    downtime.ts        The heartbeat, which DMs were missed, catching up on start and after a sleep or a lost
                       connection, and the "back online" note.

  publish/           Posting as the bot.
    index.ts           The Home tab button, the optional command and message shortcut, and the form submission.
    form.ts            The form, and whether the bot can post in the chosen channel.
    send.ts            Posting in a channel or DMing someone, and the record left in the team channel.

  home/              The Home tab, the same for everyone in their language, plus a part for team members.
    index.ts           Publishes it whenever someone opens it.
    view.ts            Its blocks.
    status.ts          The team's button to see the bot's status, with less than the console's.
    updates.ts         The team's button to check for a newer release on GitHub, which only tells.

  anonymous/         Anonymous mode.
    window.ts          The author's side: the "Anonymous messages" window and everything done from it.
    team.ts            The team's side: thread buttons, its window to read, reply, edit and delete, the hourly cleanup.
    thread.ts          What the bot posts in the team channel for an anonymous conversation, and reading it back.
    views.ts           The Block Kit views of both sides.
    keys.ts            The keyed hash that links a conversation to its author, and the private handle.
    content.ts         Encrypting anonymous conversations' text, with a key of its own for each conversation.

  manifest/          The Slack app's manifest.
    index.ts           Builds it from AppSettings and what the code needs (scopes, events, callback IDs), and
                       says which scopes the bot's token lacks.
    cli.ts             `pnpm manifest`.
```

Each feature exports a `register…(app, deps)` function that adds its Bolt listeners; `main.ts` calls them in turn. Tests sit next to the code they cover, as `*.test.ts`.

## How a message travels

A DM to the bot (`inbox/dms.ts`). The `message` event arrives; `relay` posts it in the person's open thread in the team channel, or starts one (a new `conversations` row), and the bot reacts with :incoming_envelope: to mark it as received. A message written in the form (`inbox/write.ts`) takes the same path: `dms.write` opens the person's DM with the bot, relays the message as if it had arrived there, and posts a copy of it in the DM, where the team's replies will arrive. A team member writes a reply in the thread and adds the send emoji: `inbox/replies.ts` finds the conversation by the thread, claims a `deliveries` row (so it is sent only once), posts the reply in the DM as the bot, and marks the team member's message with :white_check_mark:. Editing the reply after that edits what was sent, through the team channel's `message` events (`message.groups`). The other way round, `relay` returns what it posted for a DM, which `dms.ts` keeps in `relays`, so that `inbox/changes.ts` can edit the team's copy when the person edits the DM, or empty it and delete its notices and the copies of its files when they delete it. Changes wait for the DM's own relay, which records the copy under the same `serialized` key, and are made one after another, as are a reply's send, edits and deletion. An @mention (`inbox/mentions.ts`) takes the same path as a DM, and the person gets a note only they see where they wrote. Whenever a message can't reach the team, the person is told to send it again.

Files (`slack/files.ts`). Slack doesn't share a file from one conversation into another, so whatever carries files copies them: the bot downloads each one (up to 20 MB, in memory) and uploads a copy. `relay` shows images in a notice in the thread, as an image block pointing at an unshared copy, which Slack shares with the message, and uploads other files into the thread after a notice line. A reply sent with the send emoji uploads its files into the person's DM after its text, and records the copies in `deliveries` so the delete emoji removes them too. Posts made with the posting form, with files attached in it or brought by the message shortcut, upload them after the text, or, in a public channel the bot isn't in, show the images in the message itself. What couldn't be copied is listed for the team in the thread or the record, and for the person where they wrote: in their DM, in the form and their copy of the message, or in a note only they see by their mention.

An anonymous message (`anonymous/`). The author submits the form in their window (`window.ts`); `thread.ts` records the conversation, with the author's keyed hash as its owner and a new key of its own (`content.ts`), keeps the message encrypted, and posts a placeholder in the team channel as *Anonymous message*, with an *Open* button. The team opens the conversation in a window (`team.ts`), where it reads and replies; each reply is kept encrypted too, and posted in the thread as a placeholder. Both windows read the conversation from the database (`thread.read`). The person can edit or delete their own messages from their window, and the team its replies from its own: the text changes in the database, or goes from it, and the thread says so in place (`showChange`, `editReply`, `withdrawReply`). Both windows keep a deleted message in its place, without its text. Changes to a thread's messages go one after another (`serialized`), so a status change and an edit don't undo each other. Both windows show 30 messages at a time, with buttons for earlier ones. An hourly cleanup destroys the keys of conversations ended `ANON_READABLE_DAYS` ago. A conversation from before encryption, or with `ANON_ENCRYPTED=false`, has its text in the thread instead: a team reply with the send emoji goes through `inbox/replies.ts` to `team.ts`, which only records it, and the author's window reads it back from the thread.

After downtime (`inbox/downtime.ts`). On start, the bot compares the last heartbeat with now, lists its DM conversations, relays every DM since then that lacks its :incoming_envelope:, apologises to each sender, and posts a note in the team channel if it was away more than 5 minutes. While it runs, it does the same in two cases: when its machine wakes from sleep, noticed as the minute's timer ticking late (timers stop while the machine sleeps, the clock doesn't), and when Socket Mode connects again after more than a minute without a connection. Shorter losses, such as Slack renewing the connection, are left to Slack's retries. Right after waking, the old connection can still look open, so the catch-up waits for a tick on time or a new connection. A catch-up that fails is tried again on the next tick. If the bot stops before catching up, its last heartbeat is when the DMs started to be missing, so the next start catches them up.

## Data model

Slack keeps the messages, but not the links between them: nothing in Slack says that a thread in the team channel belongs to a given DM. The database keeps those links, a little state, and the encrypted text of anonymous conversations, which is what keeps it out of Slack messages and exports.

| Table | Holds | Needed so that |
| --- | --- | --- |
| `conversations` | DM and mention conversations: who, where replies go, their thread in the team channel | A reply sent from a thread reaches the right person, and their next message continues the same thread |
| `deliveries` | What the bot sent as the team: the record in the team channel, the message it sent, and the copies of its files | The delete emoji can remove it later, adding the send emoji twice doesn't send twice, and edits reach what was sent |
| `relays` | What the bot posted in the team channel for each DM: the copy of its text, the notices with its images and naming the files that couldn't be copied, and the copies of its files | Editing or deleting the DM does the same to the team's copy |
| `anon_conversations` | Anonymous conversations: private handle, thread, owner hash (cleared once purged), state, whether encrypted, and its key, itself encrypted (destroyed `ANON_READABLE_DAYS` after it ends) | The author's window finds their conversations, conversations end and are forgotten on schedule, and their text stays readable only while the key exists |
| `anon_messages` | Which messages of an anonymous thread came from the author or the team, which team member sent each reply and who last edited or deleted it, and, if encrypted, their text (nulled when a message is deleted; the rows go once purged, or, if encrypted, once the key is destroyed) | The windows show only those, never the team's internal discussion in the same thread |
| `meta` | The last heartbeat | After downtime, the bot knows which DMs it missed and how long it was away |

`relays` keeps its rows for as long as a DM may be deleted, which is any time. They hold only the Slack IDs of messages the team channel already shows with their author, so they reveal nothing the channel doesn't, and `pnpm clean-db` empties them with the rest.

### Why is a database needed?

The links for DMs and mentions could be hidden in message metadata, but finding a DM's thread would mean scanning the team channel's history on every message, which is slow and runs into rate limits. The link between an anonymous conversation and its author can't be in Slack at all: the workspace owner can read anything there, through exports or admin tools. It has to live outside Slack, under the control of whoever runs the bot, and be deletable, so the bot can forget the author once a conversation ends.

SQLite is used as the DB engine since is built into Node (`node:sqlite`), with no database server to run. Just one file in `data/`. The bot stores a few thousand rows a year at most so this shouldn't be an issue.

Conversations store the team channel their thread is in, and lookups only match the current `TEAM_CHANNEL_ID`. Expiring and purging anonymous conversations covers every channel, so no author link outlives its schedule.

## Who speaks: the team or the bot

Slack doesn't let apps upload files under another name, so relayed files that aren't images are the one exception: they are uploaded as the bot itself, after a notice line saying whose they are, while relayed images are shown in a notice. The bot's own identity is otherwise only the team's voice: replies sent with the send emoji, and posts and DMs sent from the publish form. Everything the bot does on its own goes through `Notices` (`slack/notices.ts`), under a sender of its own, the bot's name with " · notices" and a robot icon (`chat:write.customize`): the messages it relays into the team channel, anonymous messages, what it reports there (a conversation ending or expiring, a reply withdrawn, a deletion, a failure, the bot back online, the record of something the team posted, the notices only one person sees) and its automatic replies in people's DMs. Short notices and automatic replies show as a small grey line; relayed and anonymous messages keep their full layout. The sender's name is in the team's language in the team channel, and in each person's language in their DM. A new kind of message should go through `Notices` unless it is something the team says.

## Why anonymous messages don't use the Messages tab

The Messages tab is a DM between the person and the bot, and a DM is stored under the person's name. On Business+ and Enterprise plans the workspace owner can export DMs, and the export would show that person writing the same text the team gets anonymously. Receiving only the replies by DM would give them away just the same, since each reply would appear word for word in their DM and in the team's window, or, unencrypted, in the team thread.

Modals, the forms and windows apps open, are not messages: Slack keeps them out of people's history and out of exports. So the author writes through a form and reads the replies in a window, which the bot rebuilds every time it opens: from the database, decrypted, or, for a conversation that isn't encrypted, from the team channel. For the same reason the bot never notifies authors by DM, and their conversations never appear on the Home tab, which Slack keeps and shows whenever the bot is opened.

## Rules that keep anonymity

- The author's Slack ID is never stored, only `anonOwner(userId)`, an HMAC keyed with `ANON_SECRET`. It is cleared (`purge`) as soon as the conversation is forgotten, and overwritten on disk: the database overwrites what it deletes (`secure_delete`), empties its write-ahead log after forgetting an author, and rewrites its file on every start.
- Anonymous conversations live in modals, never on the Home tab. Slack shows the last published Home tab when the bot is opened, before the bot can replace it, so anything on it can be seen over someone's shoulder. The Home tab is the same for everyone, apart from the part only team members get.
- Nothing visible links the author's window to the thread. The window refers to conversations by a random handle that never goes into the team channel; the team's buttons carry no value and find the conversation by the message they are on. The menus to edit or delete a message carry its timestamp, which neither side sees.
- No DMs to the author. A notification would stay in their history, and its time would match the reply in the team channel.
- No message contents or user IDs in logs. `app.error` logs Slack error codes only.
- No files in anonymous conversations, either way: a file belongs to whoever uploads it, and can carry details about them.
- The text of encrypted conversations never goes into a Slack message: the thread holds placeholders, and only the windows show the text. Each conversation's key is kept encrypted with a key derived from `ANON_SECRET`, and destroying it is what deletes the text from the database. Backups made before still hold the key, so they must be kept apart from the secret, and deleted once older than `ANON_READABLE_DAYS`.

Break one of these and anonymous mode stops being anonymous.

## Things that were fixed by usage tests

- `reply_broadcast` is not used: replies stay in their thread, and copies in the channel only added noise.
- A thread can disappear. If its first message was deleted (or the thread is in another channel), Slack silently posts a "reply" as a standalone message. `postInThread` checks, takes it back, and lets the caller start over.
- node:sqlite returns null-prototype objects; `row()` in `storage/database.ts` hands out plain ones.
- Modal titles are limited to 24 characters, and the bot's name goes in some: use `modalTitle()`.
- Slack ignores custom names and icons on file uploads, contrary to its docs, so uploads always appear as the bot.
- An image block refuses a newly uploaded image until Slack has processed it, for up to about a minute: `showImages()` tries again.
- Deleting a file also removes the message that held only it, so deleting what the bot sent is its message, then its copies.
- A message with text of its own, such as the line above relayed files, stays when its file is deleted, showing a deleted file: `deleteCopiesAndMessages()` finds those messages through where Slack says each copy was shared, and deletes them too.
- A DM deleted while it has replies in its thread stays as a placeholder, which arrives as a `message_changed` of subtype `tombstone` instead of a `message_deleted`.
- Editing a message with `chat.update` keeps the name and icon it was posted under, so the copies of DMs stay notices when they follow an edit.
- Slack's 3-second limit: commands, actions and form submissions must be acknowledged quickly. Anonymous form submissions post first and acknowledge after, so the author only sees "sent" once it is in the team channel.

## Languages

The texts live in `locales/`, one YAML file per language, grouped by feature as the code is. They are written in [ICU MessageFormat](https://formatjs.github.io/docs/core-concepts/icu-syntax): `{user}` is a value, and `{days, plural, one {# day} other {# days}}` picks the right form for each language. `{bot}`, `{publishCommand}` and `{anonymousCommand}` are filled in everywhere.

English is the reference. `pnpm i18n` reads `locales/en.yml` and generates `src/i18n/messages.ts`, the `Strings` type, where a text that takes values is a function with those values named and typed: `t.inbox.thread.mentionHeader({ user, channel, permalink })`. Calling a text with a missing or wrong value fails the type check, and a test fails if the type is out of date with the English file. The same command checks the other languages: a translation can't use values the English text doesn't, nor keys it doesn't have, and must be valid ICU. A language may leave texts out; those show in English, and the command lists them.

`I18n` reads each person's Slack locale (`users.info`, cached for an hour) and falls back to English. What only one person sees uses `i18n.forUser(id)`; what the bot posts in the team channel uses `i18n.team`, in `TEAM_LANGUAGE`.

To add a language, copy `locales/en.yml` to `locales/<code>.yml`, with the language's code as Slack reports it (`fr` for `fr-FR`), translate what you can, and run `pnpm i18n`. To add a text, add it to `locales/en.yml`, run `pnpm i18n`, and translate it in the other files. To reword one, edit it and run `pnpm generate`, which also updates `manifest.example.yml` if it is one of the manifest's texts. The tests build what they expect from the same keys, so they don't depend on the wording.

## The Slack app's manifest

The app's settings in Slack are generated, never edited by hand. `manifest/index.ts` combines AppSettings (name, description, commands, language and the about text, from `.env`) with what the code needs (scopes, events, the shortcut callback IDs its handlers listen for). `pnpm manifest` writes `manifest.yml` for the deployment, which is not committed; `pnpm manifest --example` writes `manifest.example.yml` with the defaults, and a test fails if it is out of date. If you add an API call that needs a new scope, add it to `BOT_SCOPES`.

## The console

When the bot runs in a terminal, `console/` reads commands typed there. It is the only way in: nothing listens on the network, and nothing is controlled from Slack, whose workspace owner is who anonymity protects people from, and where a command's answers would end up in exportable messages.

The log is one `Log` (`log.ts`) shared with Bolt, the Socket Mode client and the Web API clients, so `log` changes the level for all of them. Besides Bolt's levels it has `trace`, which `activity.ts` feeds from a global middleware: a line for each event, action, command or form, named by the code's own names (event type, action and callback IDs), with how long it took and the error code if it failed, never IDs or text. The console can't set Bolt's `debug`, which logs whole payloads: the author and text of an anonymous message among them. `Activity` keeps the counts and times that `status` shows, in memory only. The Home tab's *Status* button (`home/status.ts`) shows the team the same, but of failures only how many and the last error code: what failed and when could tell when an anonymous message failed to arrive. What changes something (`log`, `restart`, `update apply`) is only in the console.

`pnpm start` runs `launcher.ts`, which runs `main.ts` in a child process with the terminal, and starts it again when it exits with `RESTART_CODE` (`restart`, `update apply`), or when it fails after running for over a minute, unless the launcher itself was asked to stop (SIGINT, SIGTERM), which it passes on to the bot. `update` fetches the repository's tags and reads the next release's notes from its `CHANGELOG.md`, within the same major version; `update apply` only works in a clean clone at the running version's tag, checks out the next one, installs its dependencies, and goes back to the running version's tag if that fails. A signed tag must verify. The update is `git` and `pnpm` run by the bot, in a session of their own so they can't ask for a password in its terminal, and the bot keeps running the code it loaded until it restarts. While a command runs, Ctrl-C has to be pressed twice, so as not to leave an update half done. `pnpm dev` has the console too, but no launcher: `node --watch` restarts the bot on changes instead.

## Working on it

```sh
pnpm install
pnpm dev                  # runs with .env, restarting on changes, with the console
pnpm start                # runs with .env through the launcher, which the console's restart and update need
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
