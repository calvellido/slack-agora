# Guide

Everything about using and running Agora, in detail. The [README](README.md) has the overview and a quick start.

## For people writing to the team

### With your name

To write with your name, use the bot's *Messages* tab, @mention it in a channel it is in, or open a form with `WRITE_COMMAND` or the button on the bot's *Home* tab. The whole team reads it, and the replies come back where you wrote: in the *Messages* tab, or in the thread of your mention. What you send from the form also goes to the *Messages* tab, with a copy of your message, so you can keep writing there. The bot marks every message it receives with :incoming_envelope:, so you know it got there, and when an @mention starts a conversation it also thanks you in a note only you see. If a message can't reach the team, the bot tells you, so you can send it again.

Editing or deleting a message in the *Messages* tab does the same for the team: an edit changes the team's copy, and deleting it takes your message and its files out of the team's channel, leaving a note there that you deleted it. The bot tells you each time. @mentions aren't followed this way, so the team keeps what you first wrote: to correct something, write again.

Files you attach, up to 20 MB each, in the *Messages* tab, with an @mention or in the form, which has a field for them, reach the team with your message, and the files the team attaches to its replies reach you the same way. If one can't be copied, for example because it's larger or it's a link to another service, the bot tells you which, so you can share a link instead: in your DM, in the form, or in a note only you see by your @mention.

### Without your name

To write without your name, open *Anonymous messages*, from the button on the bot's *Home* tab or with `ANONYMOUS_COMMAND`. That window is where you write, read the team's replies (new ones are marked 🆕) and write again. Nothing stays in your Slack messages, and your anonymous conversations never show on the *Home* tab, only in that window. You can have up to 3 of them open at once.

While a conversation is open, the menu beside each of your messages edits or deletes it, for example to take out a detail that could give you away. The team sees that you edited or deleted a message, though not what it said before, and may already have read it. A reply the team withdraws stays in its place too, as *Reply deleted*, without its text.

Anonymous conversations are text only: files can't be attached to them, and the files the team attaches to its replies aren't sent, so nothing attached can give anyone away.

### Ending an anonymous conversation

When you are done, use *End conversation* in the window. The bot then forgets the conversation was yours, and you can also ask it to delete your messages from the team's channel. If it's the team that ends it, or it goes 30 days without messages, you can still read it, or delete it, for 7 more days.

Those numbers are the defaults, and each deployment can change them in [.env.example](.env.example).

### Language

Everything you see on your own, like the *Home* tab, the windows or messages only you can see, is in your Slack language: English or Spanish, and English for any other language.

## For the team

### Conversations

Every conversation is a thread in the team channel, and later messages from the same person go to the same thread. Follow a thread (*⋯ > Get notified about new replies*) to hear about new messages in it. A DM starts a new thread after 7 days without activity.

### Replying as the bot

Writing in a thread is internal discussion: the person doesn't see it. To send a message as the bot, add :outbox_tray: to it. The bot sends it and marks it with :white_check_mark:, or, if Slack refuses it, tells you why in a note only you see. Edits made after that are sent too, and the person sees the reply as edited. A reply sent as files alone can't be given text later, and a reply can't be left without text: the bot says so, and :wastebasket: deletes what was sent. Encrypted anonymous conversations are answered from their window instead (see below); in those that aren't, the author's window always shows the current text of each reply.

Files attached to the reply, up to 20 MB each, are sent with it, and a reply can be files alone. Any that can't be sent are listed in the thread, for the whole team. Deleting the reply with :wastebasket: deletes its files too.

### Posting as the bot

To post as the bot, use the button on the bot's *Home* tab, `PUBLISH_COMMAND`, or the message shortcut, which copies the message you use it on. It opens a form to post in a channel, DM people, or both. Public channels work without inviting the bot; private ones need `/invite`. Once sent, the form shows how it went for each channel and person, with a link to the post. Every post is also recorded in the team channel with who made it, and a DM starts a conversation thread. To delete something the bot sent, add :wastebasket: to its record in the team channel; on anything else, :wastebasket: gets a note saying what it deletes.

The form has a field to attach files, up to 10, and the message shortcut also lists the files of the message you use it on, ticked, so you can untick any you don't want posted. A post can be files alone, and the bot posts copies, so the post shows only the bot; the files you attach in the form stay in your own Slack files. Each file can be up to 20 MB, and in a public channel the bot isn't in, it can only post images: other files need the bot invited there first. The form refuses to post files it can tell won't go, saying which and why, so you can remove them or choose another channel. The record in the team channel names the files posted, without copying them there, and says if one still failed while it was being copied. :wastebasket: on the record deletes the files too.

### Who sees the command and the shortcut

Slack shows an app's commands and shortcuts to everyone in the workspace, and has no way to show them only to some people. So anyone can see the command and the message shortcut for posting, although only the team can use them, and anyone else who tries just gets a note saying so. The button on the *Home* tab only shows to the team. To keep the command or the shortcut out of sight, set `PUBLISH_COMMAND=` (empty) or `PUBLISH_SHORTCUT=false` in `.env` and update the app's manifest (see *Setting it up*); the team then posts from the *Home* tab.

### Commands or shortcuts

When someone types `/`, Slack lists the app's commands next to its global shortcuts. Agora can have both for writing to the team, `WRITE_SHORTCUT=true` and `ANONYMOUS_SHORTCUT=true`, but they're off by default, and it's best to keep them off: a command and a shortcut that open the same form, side by side in the same list, look like two different things, and people can't tell which to use. The commands also take text, so `/agora-write Hello` opens the form already written, and people who don't use commands have the buttons on the bot's *Home* tab. If you'd rather offer shortcuts, consider leaving the matching command out, with `WRITE_COMMAND=` (empty); the anonymous command is always there.

### Anonymous conversations

Anonymous conversations arrive as *Anonymous message*, with no name or code. Their text is encrypted, so the thread only says a message arrived: *Open*, on its first message or on the person's later ones, shows the conversation in a window, where you also reply. The window shows 30 messages at a time, with buttons to read earlier or later ones. Anyone in the team can edit or delete a reply there, from the menu beside it, and :wastebasket: on a reply's placeholder in the thread withdraws it too. A deleted reply stays in its place, saying who deleted it, in the thread and in the window, and the person sees it as deleted, without its text or any names. An edited reply says who edited it last, in the thread and in the window, and the person sees it marked as edited, without names. The person can edit or delete their own messages too, while the conversation is open: the thread says so in place, without notifying anyone, and the window marks the edited ones, so check it before replying to an older message. What you write in the thread itself is internal discussion, as in other conversations, but it isn't encrypted, so don't quote the person's messages there.

*End conversation* on the thread ends one. Once the bot no longer knows who wrote it, a delete button on the thread removes everything the bot posted there, the person's messages and the team's replies. A year after a conversation ends (`ANON_READABLE_DAYS`), the bot destroys its key, and its text is gone from the database for good; backups made before still hold it, for whoever also has `ANON_SECRET`.

With `ANON_ENCRYPTED=false`, and in conversations from before 3.0.0, the text is in the thread instead, and you reply there with :outbox_tray:, as in other conversations. Your own replies then stay until each of you deletes theirs.

### Who can act as the bot

Only members of the team channel can act as the bot. What the bot posts in the team channel is in `TEAM_LANGUAGE`, since everyone there shares it.

### The team's voice and the bot's own

Only what the team sends is posted as the bot itself: replies sent with :outbox_tray: and posts made from the posting form. Everything the bot does on its own comes from a separate sender with a robot icon, named after the bot (for example *Agora · notices*, or *Agora · avisos* in Spanish): the messages it relays into the team channel, anonymous messages, its notices there (a conversation ending, a reply withdrawn, the bot back online) and its automatic replies to people. Short notices and automatic replies show as small grey text.

One exception, which Slack imposes: apps can't upload files under another name. So relayed images show in a notice, but other relayed files, such as PDFs, appear as uploaded by the bot itself, right after a notice line saying whose they are.

### Status and updates

*Status*, on the team's part of the *Home* tab, says how the bot is doing, as the [console](#the-console)'s `status` does: its version and how long it has been running, its connection to Slack, the times its machine slept or the connection was lost, the DMs it relayed late, how much it handled and how much failed, the monitor's last call, any permissions the app lacks, the log's level and its memory. Of what failed, it only says how many and the last error code: what failed and when stay in the console, since knowing when an anonymous message failed to arrive would tell something about who wrote it. *Refresh* shows it again as it is now.

*Check for updates* says whether a newer release of the bot is out, with a link to what changed, and that it is installed on the bot's machine by whoever runs it (see [Updating](#updating)). Nothing is installed from Slack: whoever controls a team member's Slack account, the workspace's owner among them, could otherwise change the code running next to the anonymity secret. The button looks among the releases of the repository in `SOURCE_URL`, so it only shows when that is a repository on GitHub, as Agora's own is.

## If the bot is down

Slack only delivers messages to a running bot, so nothing answers while it is down. The *Home* tab tells people that a message without :incoming_envelope: means the bot is offline. At its bottom, next to the version, :large_green_circle: says the bot is running, with how long ago that was checked: the bot publishes the tab whenever someone opens it. A minute later, and when the bot stops, it says instead that opening the tab checks, since the bot can't change the tab once it is down: if it doesn't turn :large_green_circle: within a few seconds, the bot is offline. The green dot Slack shows next to the app's name doesn't tell: Slack shows it all the time, whether the bot runs or not. When it is back, whether it started again, its machine woke from sleep or its connection to Slack returned, it relays the DMs it missed, marked with when they were sent, and apologises once to each sender. If it was away for more than 5 minutes, or relayed any late DMs, it also tells the team channel how long it was offline.

### Getting alerted

To hear about it while the bot is down, and not only once it's back, give it a monitor to call. The bot calls `HEARTBEAT_URL` every `HEARTBEAT_MINUTES` while it is connected to Slack, once a day (1440) by default, and the monitor alerts you when the calls stop, whether the bot, its machine or its connection is down. The calls go out from the machine, so nothing needs to reach it, and they carry nothing but the fact that the bot is up.

With [Healthchecks.io](https://healthchecks.io), which has a free plan and can also run on your own server:

1. Create a check, and set its period to how often the bot calls, `HEARTBEAT_MINUTES`, and its grace time to 5 or 10 minutes, so a restart for an update doesn't set it off. You hear about the bot being down after about the period and the grace time together, so a shorter `HEARTBEAT_MINUTES`, such as 5, lets the monitor alert you sooner.
2. Choose how it alerts you, such as by email or Telegram.
3. Set `HEARTBEAT_URL` in `.env` to the check's ping URL and restart the bot. The check shows as up after its first call.

Keep the ping URL secret: anyone with it could make the check look up.

### What isn't recovered

Some things are not recovered:

- @mentions made while it was down are lost.
- A :outbox_tray: added in that time does nothing. If no :white_check_mark: appears, remove it and add it again.
- Edits and deletions made in that time aren't followed: the other side keeps the message as it was.
- Commands, buttons and windows show Slack's own error while the bot is down.

## Privacy

### Messages with your name

DMs and @mentions are not anonymous: the team sees who wrote them.

Files are copied, not shared: the team channel keeps its copy even if the person deletes the original file, as with the text the bot relays, and exports of the channel include it. Deleting the whole DM deletes the team's copies of its text and files, and the note naming any that couldn't be copied, though not from exports already made. The bot holds each file in memory only while copying it, never on disk. Photos can carry details such as where and with what they were taken, which the bot doesn't remove.

### Anonymous messages

With anonymous messages:

- The team sees the text and when it was sent, and nothing else. Nothing visible links two conversations from the same person, or someone's window to its thread.
- The windows are not messages, so nothing the author writes or reads is in their Slack history or in DM exports.
- Their text, and the team's replies, aren't in Slack messages either: the bot keeps them on its server, encrypted, with a key of its own for each conversation. An export of the team channel only shows that anonymous messages arrived and when, and the team's discussion in the threads. With `ANON_ENCRYPTED=false`, it has the anonymous texts, without their authors.
- A year after a conversation ends, the bot destroys its key, which deletes its text from the database for good. Backups made before still hold the key and the text, readable with `ANON_SECRET`, so delete backups older than `ANON_READABLE_DAYS`.
- The text lives only in the bot's database: if the database or `ANON_SECRET` is lost, so are the conversations, which is one more reason to back up the database, apart from the secret.
- People nearby only see the conversations while the window is open.
- Whoever runs the server could find out who wrote a conversation the bot hasn't forgotten yet, and read conversations whose key isn't destroyed yet, and so could anyone who gets both the database and `ANON_SECRET`. To show people their replies, the bot keeps a scrambled code of each author's Slack ID, made with that secret, until the conversation ends and the bot forgets them, which also overwrites the code in the database file. So keep the secret apart from backups of the database, and choose carefully who has access to the server.
- Deleted messages disappear from the team channel and from later exports, although on Enterprise plans the workspace owner can set a legal hold, which keeps deleted messages.
- What people write can identify them, through details, writing style or timing. The form warns about it.

### Security

The database keeps Slack IDs and timestamps, and the text of anonymous conversations, encrypted. Every other message stays in Slack. The logs only contain Slack error codes. Never run with `LOG_LEVEL=debug` in a real workspace, as it can print whole messages, with names.

Nothing is unhackable, and Agora doesn't claim to be. It does its best to keep anonymous messages truly anonymous, following a basic security principle: make getting at what it protects so much hassle that it isn't worth it for a bad actor to try. If anyone tells you, as a hard fact, that something can't be hacked, they are lying to you.

[SECURITY.md](SECURITY.md) explains how someone could try to get at anonymous messages or the bot's data, what they could get, and how to make it harder.

## Setting it up

### What you need

You need a machine that stays on, with Docker, or with Node 26.12.1 or later and pnpm (`npm install --global pnpm`). The bot only connects out to Slack, so it needs no public address or open port.

### Installing

First get Agora's [latest release](https://github.com/calvellido/slack-agora/releases/latest), 1.0.0 in these examples:

- With Node, clone it at the release's tag and install it: `git clone --branch v1.0.0 https://github.com/calvellido/slack-agora.git`, then `pnpm install --prod` in its folder.
- With Docker, you only need two files, as [Running it with Docker](#running-it-with-docker) explains. The steps below use `pnpm`, and that section has the same commands for Docker.

Then:

1. Copy `.env.example` to `.env` and fill in the app's part: `APP_NAME`, the commands, `TEAM_LANGUAGE` and `ABOUT`, the text at the top of the *Home* tab. Run `pnpm manifest`, which writes `manifest.yml`. [manifest.example.yml](manifest.example.yml) shows what you get with the defaults.
2. [Create a Slack app](https://api.slack.com/apps) *from a manifest* with that file, and install it.
3. In *Basic Information > App-Level Tokens*, generate a token with the `connections:write` scope (`xapp-...`).
4. In *OAuth & Permissions*, copy the Bot User OAuth Token (`xoxb-...`).
5. Create the team's private channel, run `/invite @<bot>` in it, and copy its ID from the channel details, at the bottom of *About*.
6. Generate the anonymity secret with `openssl rand -base64 32`, and keep a copy somewhere other than the server. It is best kept out of `.env` too, in the system's keychain, as [Keeping ANON_SECRET apart](#keeping-anon_secret-apart) explains, which can also generate it there without anyone seeing it, if you choose to keep no copy ([A copy of ANON_SECRET, or none](#a-copy-of-anon_secret-or-none)).
7. Fill in the rest of `.env` and start the bot with `pnpm start`.

### Running it with Docker

Each release is published as an image, `ghcr.io/calvellido/slack-agora`, tagged with its version (`1.0.0`), its minor and major versions (`1.0` and `1`) and `latest`. [compose.yaml](compose.yaml) runs it with Docker Compose. Download it and the settings file, as `.env`, into an empty folder:

```sh
curl -LO https://github.com/calvellido/slack-agora/releases/latest/download/compose.yaml
curl -Lo .env https://github.com/calvellido/slack-agora/releases/latest/download/env.example
```

Then, in that folder, these take the place of the `pnpm` commands:

```sh
docker compose run --rm -T agora manifest > manifest.yml   # pnpm manifest
docker compose up -d                                       # pnpm start; the bot starts again with the machine
docker compose run --rm agora clean-db                     # pnpm clean-db
docker compose logs -f                                     # the bot's log
```

The database lives in a Docker volume, which Compose keeps between updates.

### Running it with Node

`pnpm start` runs the bot until you stop it. To keep it running, and have it start with the machine, run it as a service. With systemd, for example, save this as `/etc/systemd/system/agora.service`, with the folder you cloned, the path that `which node` gives, and a user that can write to `data/`:

```ini
[Unit]
Description=Agora
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/opt/slack-agora
ExecStart=/usr/bin/node --env-file=.env src/main.ts
Restart=always
User=agora

[Install]
WantedBy=multi-user.target
```

Then start it with `sudo systemctl enable --now agora`, and read its log with `journalctl -u agora`.

On macOS, run it as a LaunchAgent, which starts it when you log in and again whenever it stops. It runs in your session, so it can read the secret from the Keychain (see [Keeping ANON_SECRET apart](#keeping-anon_secret-apart)). Save this as `~/Library/LaunchAgents/agora.plist`, with the folder you cloned, the path that `which node` gives, and your home folder in the log's path, all written out in full, as launchd doesn't expand `~`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>agora</string>
  <key>WorkingDirectory</key>
  <string>/Users/you/slack-agora</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/node</string>
    <string>--env-file=.env</string>
    <string>src/main.ts</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/you/Library/Logs/agora.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/you/Library/Logs/agora.log</string>
</dict>
</plist>
```

Then start it with `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/agora.plist`, and read its log with `tail -f ~/Library/Logs/agora.log`. `launchctl kickstart -k gui/$(id -u)/agora` restarts it, after an update for example, and `launchctl bootout gui/$(id -u)/agora` stops it until you next log in; delete the file to stop it for good. macOS lists it among the background items in *System Settings > General > Login Items*, where it must stay allowed. A LaunchAgent doesn't get your shell's `PATH`, so a command in `ANON_SECRET_COMMAND` from outside the system's folders, such as 1Password's `op` installed with Homebrew, needs its full path.

### The console

When the bot runs in a terminal, with `pnpm start`, you can type commands there:

- `status` says how the bot is doing: its version and how long it has been running, its connection to Slack, the times its machine slept or the connection was lost, the DMs it relayed late, how much it handled and how much failed, the monitor's last call, and any permissions the app lacks. It shows counts and times, never people or messages.
- `log` shows the log's level, and `log trace` adds a line for each event, action or command the bot handles, saying what kind it was and how it went, but not who or what was written; `log info` goes back. The change lasts until the bot stops, and `LOG_LEVEL` in `.env` sets the level it starts with. The console can't turn on `debug`, which prints whole messages, with names.
- `update` looks for a newer release with the same major version, and shows what changed, and `update apply` installs it and restarts the bot. If its dependencies fail to install, the folder goes back to the version running, and the bot keeps running it. `update apply` needs a folder cloned at a release, as in [Installing](#installing), without changes of your own. A new major version is installed by hand, as its notes explain.
- `restart` stops the bot and starts it again, reading `.env` again.
- `help` lists them, and Ctrl-C stops the bot, or Ctrl-C twice while a command is still running, so as not to stop an update halfway.

`pnpm start` also starts the bot again if it stops with an error after running for over a minute, as a service would. It doesn't start with the machine, though: after a restart, start it again. A service (systemd, a LaunchAgent) or Docker runs the bot without a terminal, so without the console.

To keep the terminal running while you're away from it, run the bot in tmux (`brew install tmux` on macOS, `sudo apt install tmux` on Linux): `tmux new -s agora pnpm start`. Ctrl-B and then D leave it running in the background, and `tmux attach -t agora` takes you back to its console. Closing the terminal window doesn't stop it.

### Keeping ANON_SECRET apart

Whoever has both the database and `ANON_SECRET` can tell who wrote each anonymous conversation the bot hasn't forgotten, and read the encrypted ones, so the two should never be stored together. In `.env`, the secret sits next to the database, and goes wherever the folder is copied, synced or backed up.

While the bot runs, it needs the secret in memory, so nothing protects it from whoever controls the running machine. What keeping it apart protects are copies: a backup of `data/`, the folder synced to a cloud drive, a lost or stolen laptop.

The simplest way is the system's keychain. Leave `ANON_SECRET` empty in `.env`, and set `ANON_SECRET_COMMAND` to the command that prints it, which the bot runs when it starts. If the command fails, the bot doesn't start, and says why, without showing what the command printed.

On Linux, with the desktop's keyring (GNOME Keyring or KWallet):

1. Install its command-line tool, for example with `sudo apt install libsecret-tools`.
2. Store the secret: `secret-tool store --label="Agora ANON_SECRET" service agora key anon_secret`, and paste it when asked. Or generate it straight into the keyring, without anyone seeing it: `openssl rand -base64 32 | secret-tool store --label="Agora ANON_SECRET" service agora key anon_secret`.
3. In `.env`, leave `ANON_SECRET=` empty and set `ANON_SECRET_COMMAND=secret-tool lookup service agora key anon_secret`.

On macOS, with the Keychain:

1. Store the secret: `security add-generic-password -a "$USER" -s agora-anon-secret -w`, and paste it when asked. Or generate it straight into the Keychain, without anyone seeing it: `security add-generic-password -a "$USER" -s agora-anon-secret -w "$(openssl rand -base64 32)"`. It shows for a moment in that command's arguments, which only your own user can see.
2. In `.env`, leave `ANON_SECRET=` empty and set `ANON_SECRET_COMMAND=security find-generic-password -a "$USER" -s agora-anon-secret -w`.
3. The first time the bot starts, macOS asks whether to let it read that item: choose *Always Allow*.

A password manager with a command-line tool works the same way, such as 1Password's `op read "op://<vault>/<item>/<field>"`.

The keychain is encrypted with your login password and unlocked while you are logged in, so the bot can read it when you start it from your session. A service that starts with the machine, before anyone logs in, can't: run the bot from your session instead, as a user service (`systemctl --user` on Linux, a LaunchAgent on macOS, as in [Running it with Node](#running-it-with-node)) or from a terminal. Inside Docker, the command can't reach the host's keychain either, so with Docker the secret stays in `.env`, or in a file only the container reads.

### A copy of ANON_SECRET, or none

Nobody needs to know `ANON_SECRET`: the bot only needs the same one every time it starts. If it changes or is lost, every author loses their open anonymous conversations, and the text of every encrypted conversation can't be read any more, for good. Conversations with a name, posts and everything else don't depend on it. So whether to keep a copy outside the machine is a choice between recovering from a lost machine and leaving nothing anyone could leak:

- Keep one copy, sealed, outside the machine, which nobody looks at unless the machine is lost: an entry in the team's password manager, or a printed copy in a sealed envelope. Read it once from the keychain, with the same command as `ANON_SECRET_COMMAND`, and store it away. If the machine breaks, is lost or has its system reinstalled, the database from a backup and that copy bring everything back. The copy must never be kept with the database's backups, as the two together are the risk.
- Or keep none, generating it straight into the keychain as above, so that nobody ever knows it and nobody can be pressed to hand it over. A stolen backup of the database is then of no use for anonymous conversations. But losing the machine, or its keychain, loses them: the open ones disappear from their authors' windows, and the encrypted ones can't be read, while conversations with a name come back from the backup.

Keeping a copy suits a team that keeps anonymous conversations for a while, as `ANON_READABLE_DAYS` does by default for a year. Keeping none suits one that values leaving nothing behind over continuity, as anonymous conversations are short-lived by design.

### Running it on a laptop

A laptop works, since the bot only connects out, but some care keeps the database and the secret from leaving it together:

- Use a laptop the team controls, never one the company manages. Device management, backup and security tools run with administrator rights, and can read the database, the secret and the running bot.
- Encrypt its disk (LUKS on Linux, usually chosen when installing; FileVault on macOS, in *System Settings > Privacy & Security*), and lock its screen when you leave it.
- Keep the bot's folder out of synced folders, such as Dropbox, Google Drive or OneDrive, and, on macOS, out of *Desktop* and *Documents* when iCloud syncs them.
- Backups (Time Machine, Déjà Dup) should be encrypted, or leave the bot's folder out, and never include `.env` with the secret in it.

### Keeping a laptop awake

A laptop sleeps when it is idle or its lid closes, and the bot goes offline with it. When the laptop wakes, the bot catches up on the DMs it missed, as after any time offline (see [If the bot is down](#if-the-bot-is-down)), but nobody gets an answer meanwhile.

On Linux, `systemd-inhibit --what=sleep:handle-lid-switch pnpm start` keeps it awake while the bot runs, with its lid closed too.

On macOS, `caffeinate -s pnpm start` keeps it awake while on power, but closing the lid puts it to sleep all the same. To keep it running with its lid closed, turn sleep off:

```sh
sudo pmset -a disablesleep 1   # pmset -g then shows SleepDisabled 1; 0 turns sleep back on
```

The Mac then doesn't sleep at all until you turn sleep back on, on battery too, with its lid closed or not. So keep it plugged in, and never put it in a bag while it's on. Without changing that setting, a Mac only stays awake with its lid closed while it is plugged in and connected to a display, and an HDMI dummy plug counts as one.

After a restart, for example for a system update, an encrypted disk waits for its password before anything runs, and a bot run from your session, as a LaunchAgent or a user service, waits for you to log in. One run in a terminal, for its [console](#the-console), has to be started again. On a Mac with FileVault, typing the password at start-up also logs you in. Docker Desktop, too, only starts once you log in. So someone needs to be near the laptop, and a monitor tells you when the bot is down (see [Getting alerted](#getting-alerted)). A locked screen is fine: the bot keeps running while you're logged in.

### Updating

Each release's section in [CHANGELOG.md](CHANGELOG.md), which is also its release notes, says what changed and what to do. *Check for updates* on the team's part of the *Home* tab says when a newer release is out. When the bot starts on a new version, it tells the team channel, with a link to that release's notes on `SOURCE_URL` (Agora's repository, unless it says otherwise), and when it goes back to an earlier one, it says so too. When the app's manifest changes, for example with a new command or permission, generate it again and paste it, as in [Changing the app later](#changing-the-app-later).

- With Docker, `docker compose pull && docker compose up -d`. The `3` tag in `compose.yaml` gets every 3.x release; a new major version can need changes, which its notes explain, and a `compose.yaml` with its own tag. If yours still says `:1` or `:2`, download it again, or change its tag to `:3`.
- With Node, `git fetch --tags`, `git checkout` the new version's tag, `pnpm install --prod`, and restart the bot. With `pnpm start`, `update` and `update apply` in the bot's [console](#the-console) do it for you.

### Settings and data

Every setting, with its default, is described in [.env.example](.env.example). The database lives in `data/`, so keep that folder between restarts.

### Starting over

To start over with an empty database, for example after testing, run `pnpm clean-db`. It asks first, and works with the bot running. Threads already in the team channel stay, but they are no longer conversations: replies from them aren't sent, people's next messages start new threads, anonymous conversations disappear from their authors' windows, and the text of encrypted ones is lost, as it is only kept in the database.

### Changing the app later

To change the app later, for example its name, a command, or a new version that needs other permissions, change `.env`, run `pnpm manifest`, and paste `manifest.yml` into *App Manifest* (YAML) in the app settings. Don't change the app's settings in Slack by hand, as the next manifest would undo it.

### Moving to another team channel

Changing `TEAM_CHANNEL_ID`, say from a test channel to the real one, is safe with the same database. People's next messages start new threads in the new channel, and anonymous conversations from the old one drop out of people's windows. Their *Open* buttons in the old channel stop working too, so the team can no longer read encrypted ones from there.

### How the Home tab looks

The *Home* tab opens with the bot's avatar, its name and the `ABOUT` text. `ABOUT` can also have a large heading and small grey text, as [.env.example](.env.example) explains.

With `HOME_TEAM_MEMBERS=true`, the *Home* tab lists the people in the team channel, with their photos, after the `ABOUT` text, before any small grey text at its end, so whoever writes knows who will read it. The list follows the channel's members, without bots, a few minutes after anyone joins or leaves.

For a banner across the top instead of the avatar, put a wide image at a public https address, such as a GitHub repository, and set `HOME_BANNER_URL`. Slack fetches the image itself, so it can't come from the bot's machine. If Slack can't get it, the bot shows the tab without it and logs a warning.

At the bottom, the *Home* tab says the bot is open source, links to its code and invites contributions, and the *About* tab ends with the same. Under that, the *Home* tab shows the version that is running. The link is Agora's repository. If you run a changed version, point `SOURCE_URL` to yours, so people can read the code that actually runs, or set it empty to leave the note out.

### The About tab

The app's *About* tab shows `APP_DESCRIPTION`, a short line, and `APP_LONG_DESCRIPTION`, a longer text of at least 174 characters, both in `TEAM_LANGUAGE`, since Slack has no way to give each language its own. They're for anyone who looks the app up, while the *Home* tab is for the people who use it. Without `APP_LONG_DESCRIPTION`, the *About* tab has the `ABOUT` text in `TEAM_LANGUAGE`. Slack shows that tab as plain text, without links, so links in it keep their address, after their text.

`APP_COLOR` is the background of the card with the app's details, which shows when someone hovers over or clicks its name. Slack only accepts dark colours, and `pnpm manifest` warns about light ones.

The app's icon is uploaded in the app settings, in *Basic Information > Display Information*. [assets/](assets/) has the Agora logo for it, and a banner with the logo in the middle.

### A custom icon for the bot's own messages

Everything the bot posts on its own shows a robot by default, so it doesn't look like a message from the team. You can use your own image instead, for example the app's icon with a small badge in a corner, by adding it to the workspace as a custom emoji:

1. Prepare a square image in PNG, JPG or GIF. Slack recommends under 128 KB, with a transparent background.
2. In Slack, open the emoji menu from the smiley in the message field, choose *Add Emoji*, upload the image and give it a name, such as `team-notices`. If you can't, your workspace may only let owners or admins add emoji.
3. Set `NOTICE_EMOJI=team-notices` in `.env` and restart the bot.

When it starts, the bot checks that the emoji exists. If it doesn't, because the name has a typo or the emoji was deleted, it uses the robot and logs a warning. Any standard emoji works too, such as `NOTICE_EMOJI=gear`.

## Not yet

- Editing a post made with the posting form: delete it and post it again.

More ideas, and what each would take, are in [ROADMAP.md](ROADMAP.md).
