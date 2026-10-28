# Changelog

What changed in each version, and what to do when updating to it. Versions follow [semantic versioning](https://semver.org), and each one's section here becomes the notes of its [GitHub release](https://github.com/calvellido/slack-agora/releases).

## Unreleased

- A minute after the *Home* tab says the bot is online, it says when the bot was last online, and that opening the tab again checks. Until now it said that opening it checks, and to watch for :large_green_circle:, which read as the bot being offline to whoever still had the tab open. It says "green" in words, so nothing shows :large_green_circle: while the bot may be offline.

No new permissions or settings: updating the bot is enough.

## [3.7.2] - 2026-10-28

- *Check for updates* says when GitHub refuses to answer for now, and until when, instead of that it couldn't be reached. Without an account, GitHub answers 60 calls an hour from the same network, shared by every app there, so they can run out. Until then, pressing the button doesn't ask GitHub again. When GitHub can't be reached at all, the log says why, such as a certificate the bot doesn't trust, instead of only `fetch failed`.

No new permissions or settings: updating the bot is enough.

## [3.7.1] - 2026-10-28

- DMs sent while the bot was down are no longer lost when it can't catch up on them right away. Until now, the bot noted it was running as soon as it started, before connecting to Slack: if it then failed to connect, as when a machine starts without a network, or catching up failed, or it stopped before finishing, the next start only looked back to then. Now the bot catches up once it connects, tries again every minute if that fails, and only notes it was running once it has caught up, which also covers a crash while its connection to Slack is lost.
- Catching up reads all of a DM's messages since the bot went away, not only the latest 200, and the replies in its threads, which it skipped: those under the team's replies among them.
- A reply in a thread of a DM that is also sent to the DM reaches the team. Until now, the bot ignored it, live or after downtime.
- The forms that send or change a message no longer show an error when Slack is slow, though the message went, which could have it sent twice: writing to the team with your name, and the anonymous ones, both the person's and the team's. After 2 seconds, the form says it is sending, and then how it went.
- Posting as the bot no longer says it failed when it went out but its record couldn't be posted in the team channel, which could have it posted twice. The form says it went out without a record, so it can't be deleted with the delete emoji.
- The hourly cleanup of anonymous conversations goes on when Slack refuses to change one of their threads: until now, that stopped it, holding back forgetting authors and destroying keys until a later hour, and leaving other expired conversations without their note in the team channel.
- A reply sent with the send emoji can be deleted, and its edits follow, even when telling the team that some of its files couldn't be sent fails.
- The *Home* tab opens when Slack can't say who is in the team channel for a moment, without the team's part, instead of not opening at all.
- `SEND_EMOJI` and `DELETE_EMOJI` can be written with colons, as `NOTICE_EMOJI` could: `:outbox_tray:` no longer leaves the send emoji doing nothing. They must be different emoji, and `HEARTBEAT_MINUTES` at most 35791 (about 24 days), as a longer wait made the bot call the monitor all the time: otherwise the bot now says so and doesn't start.

No new permissions or settings: updating the bot is enough.

## [3.7.0] - 2026-10-28

- At the bottom of the *Home* tab, next to the version, everyone sees whether the bot is running: :large_green_circle: when it has just published the tab, as it does whenever someone opens it, with how long ago that was. A minute later, and when the bot stops, it says that opening the tab checks, since the bot can't change it once it is down. Slack's own green dot next to the app's name is on all the time, so it doesn't tell.
- On the team's part of the *Home* tab, *Status* and *Check for updates* are a group of their own, *Maintenance*, apart from the button to post as the bot.

No new permissions or settings: updating the bot is enough.

## [3.6.0] - 2026-10-28

- *Status*, a button on the team's part of the *Home* tab, says how the bot is doing, as the console's `status` does, in the team's language, with *Refresh* to see it again. Of what failed, it only says how many and the last error code: what failed and when stay in the console. It only shows: changing the log's level, restarting and updating are only done from the console.

No new permissions or settings: updating the bot is enough.

## [3.5.0] - 2026-10-28

- *Check for updates*, a button on the team's part of the *Home* tab, says whether a newer release is out, with a link to what changed, and that whoever runs the bot installs it on its machine, from the console or with Docker. It only tells: nothing is installed from Slack. It looks among the releases of `SOURCE_URL`'s repository on GitHub, so it shows only when that is one, as Agora's own repository is.

No new permissions or settings: updating the bot is enough.

## [3.4.0] - 2026-10-28

- When the bot starts on a new version, it tells the team channel, as it does when it is back online, with a link to what changed: the release's notes on `SOURCE_URL`, which is Agora's repository unless it says otherwise. Going back to an earlier version is told too. The first time a version is announced, the bot doesn't know which one it ran before, so it only says it was updated.

No new permissions or settings: updating the bot is enough.

## [3.3.0] - 2026-10-27

- The console: when the bot runs in a terminal with `pnpm start`, commands typed there say how it is doing (`status`), change the log's level (`log`), restart it (`restart`), and look for a newer release and install it (`update`, `update apply`). `pnpm start` now runs the bot through a launcher, which starts it again for those, and when it stops with an error after running for over a minute. While a command is still running, such as an update, Ctrl-C has to be pressed twice to stop the bot. See *The console* in the guide.
- `LOG_LEVEL=trace`: what `info` logs, plus a line for each event, action or command the bot handles, saying what kind it was and how it went, without who or what was written. Log lines no longer name the library that wrote them.
- On start, the bot warns when its token lacks permissions the manifest asks for, as when a new version's manifest wasn't pasted into the app's settings yet, and `status` says so too.

No new permissions or settings: updating the bot is enough. `pnpm start` now runs the bot through the launcher; services that run `node src/main.ts` themselves, as the guide's systemd and LaunchAgent examples do, and the Docker image, run it as before, without the console.

## [3.2.0] - 2026-10-27

- The bot catches up while it runs, as it does when it starts: when its machine wakes from sleep, or its connection to Slack comes back after more than a minute, it relays the DMs it missed, apologises to their senders, and tells the team channel how long it was offline if that was more than 5 minutes. Until now, DMs sent while a laptop slept were lost. The log says how long the machine slept, or the connection was lost.
- The guide explains running the bot on macOS as a LaunchAgent, keeping a Mac awake with its lid closed, and what happens after the machine restarts, in *Running it with Node* and *Keeping a laptop awake*.

No new permissions or settings: updating the bot is enough.

## [3.1.0] - 2026-10-23

- `ANON_SECRET_COMMAND`: the command that prints `ANON_SECRET`, which the bot runs when it starts, so the secret can stay in the system's keychain instead of in `.env`, next to the database. The guide explains it for Linux and macOS, in *Keeping ANON_SECRET apart*, with advice for running the bot on a laptop, and the choice between keeping one sealed copy of the secret or none, generating it straight into the keychain so that nobody knows it.
- `compose.yaml` uses the image's `3` tag. It still said `1`, so Docker deployments that downloaded it got 1.x releases only.

If you run Agora with Docker, download `compose.yaml` again, or change its image's tag to `:3`, then `docker compose pull && docker compose up -d`. No new permissions: updating the bot is enough.

## [3.0.0] - 2026-10-23

- Anonymous conversations are encrypted. Their text, and the team's replies, are kept on the bot's server, encrypted with a key of their own for each conversation, and the team channel only shows placeholders, so an export of it has nothing to read. The team reads and replies with *Open*, on the thread's first message or the person's later ones, in a window like the author's, where anyone in the team can edit or delete a reply. An edited or deleted reply says who edited or deleted it, in its placeholder and in the team's window, without notifying anyone, and the person sees it marked as edited, or in its place as deleted, without its text. A year after a conversation ends (`ANON_READABLE_DAYS=365`), the bot destroys its key, and its text with it.
- The person can edit or delete each of their own messages from their window while the conversation is open, for example to take out a detail that could give them away. The thread says so in place, and the team's window marks the edited ones and keeps the deleted ones in their place, without their text. This works in conversations that aren't encrypted too.
- In an encrypted conversation, the send emoji no longer sends a message from the thread, since the thread isn't encrypted: on any message there, it points to *Open* instead, and the delete emoji says it only withdraws replies.
- Deleting an encrypted conversation, by the person when they end it or by the team once the bot has forgotten them, also deletes the team's replies, which are the bot's messages; only what team members wrote in the thread themselves stays.
- Both windows show 30 messages at a time, with buttons to read earlier ones, and keep what is typed in the reply box when they show a change.

This version changes how the team answers anonymous conversations, hence the major version. Conversations from before it keep their text in the thread, and are answered there as before. To keep the old way for new ones too, set `ANON_ENCRYPTED=false`. No new permissions or settings are needed: the keys are protected with `ANON_SECRET`. But the text of encrypted conversations now lives only in the database, so losing the database, or losing or changing `ANON_SECRET`, loses them: back up the database, apart from the secret. Backups also hold the keys of conversations the bot later destroys, so delete those older than `ANON_READABLE_DAYS`. `ANON_READABLE_DAYS` must be at least `ANON_CLOSED_VISIBLE_DAYS`.

## [2.3.1] - 2026-10-23

- When the bot forgets an anonymous author, their scrambled code is now overwritten in the database file, and in its write-ahead log, where SQLite kept an earlier copy of it for a while. A copy of the file taken after that can't give it back. On every start, the bot also rewrites the file, dropping what earlier versions deleted without overwriting.

No new permissions: updating the bot is enough. Earlier backups still hold the codes they were made with, so keep deleting old ones.

## [2.3.0] - 2026-10-22

- `HEARTBEAT_URL`: a monitor's address, such as a Healthchecks.io check's, that the bot calls every `HEARTBEAT_MINUTES` (a day by default) while it is connected to Slack, so the monitor alerts you when the bot, its machine or its connection is down. Nothing needs to reach the machine. See *Getting alerted* in the guide.

No new permissions: set `HEARTBEAT_URL` only if you want the alerts.

## [2.2.1] - 2026-10-22

- Editing or deleting a DM right after sending it, while its files were still being copied, now reaches the team's copy. So does a deletion right after an edit, which could put the edited text back.
- Deleting a DM also deletes the note naming its files that couldn't be copied, and a DM deleted while it has replies in its thread is deleted for the team too. When a step fails, the rest is still deleted, and the person is told what stayed.
- The person is told about every edit that doesn't reach the team, also after one that did, and when the team had already removed the message.
- Editing a reply while it is still being sent waits for it instead of being lost, and an edit always replaces what the person sees.
- A DM whose copy can't be recorded is still marked as received, so it isn't relayed a second time after a restart.

No new permissions: updating the bot is enough.

## [2.2.0] - 2026-10-22

- Editing a reply already sent edits what the person got, as anonymous conversations already did. A reply sent as files alone can't be given text later, nor a reply left without text, and the bot says so.
- Editing a DM edits the team's copy, keeping its header and small print. Deleting a DM takes its text out of the team's channel, leaving a note that the person deleted it, and deletes the copies of its files.
- Each time, whoever made the change is told it went through, once per message, or why it couldn't.
- DMs relayed by earlier versions stay as the team got them, as those versions kept no record of their copies, and the person is told so when they edit or delete one.

This version needs the `message.groups` event, for edits in the team channel: generate the manifest again and paste it into the app settings, which may ask to reinstall the app. Until then, edits of replies aren't sent.

## [2.1.0] - 2026-10-22

- @mentions get the :incoming_envelope: mark that DMs get, and when one starts a conversation, its author gets a note only they see, thanking them.
- A message that can't reach the team tells the person to send it again, instead of nothing.
- The posting form, once sent, shows how it went for each channel and person, with a link to the post, instead of closing.
- The delete emoji on something the bot didn't send says what it deletes. The buttons of anonymous threads say why when they can't act, and their notes show in the channel, where the buttons are, instead of inside the thread.
- Slack's usual refusals, such as a channel the bot isn't in, an archived one or one where only some people can post, are explained in words instead of by their codes.

No new permissions: updating the bot is enough.

## [2.0.0] - 2026-10-22

- Files in conversations with your name, both ways, up to 20 MB each, including from the form to write with your name, which has a field for them. What people attach reaches the team's thread, images in a notice and other files right after it, and what the team attaches to a reply reaches the person with the text. A reply can be files alone, and deleting it with the delete emoji deletes its files too.
- The posting form has a field to attach files, and posting with the message shortcut also posts the files of that message, listed in the form to untick any. A post can be files alone. The form refuses files it can tell won't be posted, saying which and why, before anything is sent, and the record in the team channel names the files posted. In a public channel the bot isn't in, it posts the images, and the record lists the other files, which need the bot invited there.
- When a file can't be copied, for being too large, a link to another service, or for lack of permission, the team sees which and why in the thread or the record, and the person is told about the ones they sent, where they sent them. In anonymous threads, the team sees in the thread that files aren't sent, instead of a note only one person saw for a moment.

This version needs two new permissions, `files:read` and `files:write`: generate the manifest again, paste it into the app settings and reinstall the app. Until then, the bot tells the team that it doesn't have permission for files.

## [1.5.0] - 2026-10-22

- The global shortcuts for the two forms, *Write to …* and *Anonymous message to …*, are now off by default, since Slack lists them next to the commands that open the same forms, which confuses people. `WRITE_SHORTCUT=true` and `ANONYMOUS_SHORTCUT=true` bring them back.
- The bot logs a warning when Slack sends a shortcut it doesn't know, which happens when the app's settings are older than its manifest, and Slack then shows the shortcut failing.

To keep those shortcuts, set those two settings before generating the manifest again. Otherwise, the next manifest you paste removes them, and people use the commands or the *Home* tab's buttons instead.

## [1.4.1] - 2026-10-22

- `pnpm manifest` warns when `APP_COLOR` is light, since Slack refuses light colours.

## [1.4.0] - 2026-10-22

- `HOME_TEAM_MEMBERS=true` lists the people in the team channel on the *Home* tab, with their photos, so people know who reads what they write.
- The *Home* tab has more space between the two ways to write and between the rows of the team's instructions, and all its buttons look the same, so neither way to write looks preferred.

## [1.3.0] - 2026-10-22

- The bottom of the *Home* tab shows the version that is running.
- `APP_LONG_DESCRIPTION` gives the *About* tab a text of its own, apart from the *Home* tab's `ABOUT`.
- Links in `ABOUT` keep their address on the *About* tab, in readable form, since Slack shows that tab without links.
- The *About* tab's note is shorter, and writes the code's address in readable form, since Slack shows that tab's text without links. To update it, generate the manifest again and paste it into the app settings.

## [1.2.0] - 2026-10-22

- The bottom of the *Home* tab and the end of the *About* tab say the bot is open source, link to its code and invite contributions. `SOURCE_URL` changes the link, for a fork, or removes the note.
- The README is now a short overview with a quick start, and `GUIDE.md` has the details.

To update the *About* tab, generate the manifest again and paste it into the app settings.

## [1.1.0] - 2026-10-21

- Simpler Docker setup: `compose.yaml` runs the bot with `docker compose up -d`, and the image takes `manifest` and `clean-db` as commands. Each release attaches `compose.yaml` and the settings template.

Nothing to do when updating: the `docker run` commands from 1.0.0 still work with the new image.

## [1.0.0] - 2026-10-21

The first release.

- People write to the team with their name: by DM, in the bot's *Messages* tab; with an @mention in a channel; or from a form, opened with a command, a shortcut or a button on the *Home* tab. Each conversation is a thread in the team's private channel.
- People write without their name in the *Anonymous messages* window, where they also read the team's replies and write again. Nothing stays in their Slack messages, and the bot forgets who wrote a conversation once it ends.
- The team replies from the thread by adding :outbox_tray: to a message, deletes what the bot sent with :wastebasket:, and posts or writes to people as the bot from a form.
- What the bot does on its own, such as relaying messages and its notices, comes from a separate sender, so the bot's own name is only the team's voice.
- After downtime, the bot relays the DMs it missed and tells the team how long it was offline.
- English and Spanish, by each person's Slack language.
- The Slack app's manifest is generated from `.env`, and the *Home* tab can have a heading, small text and a banner.
- `pnpm clean-db` empties the database.
- A Docker image, for linux/amd64 and linux/arm64.

[3.7.2]: https://github.com/calvellido/slack-agora/releases/tag/v3.7.2
[3.7.1]: https://github.com/calvellido/slack-agora/releases/tag/v3.7.1
[3.7.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.7.0
[3.6.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.6.0
[3.5.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.5.0
[3.4.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.4.0
[3.3.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.3.0
[3.2.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.2.0
[3.1.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.1.0
[3.0.0]: https://github.com/calvellido/slack-agora/releases/tag/v3.0.0
[2.3.1]: https://github.com/calvellido/slack-agora/releases/tag/v2.3.1
[2.3.0]: https://github.com/calvellido/slack-agora/releases/tag/v2.3.0
[2.2.1]: https://github.com/calvellido/slack-agora/releases/tag/v2.2.1
[2.2.0]: https://github.com/calvellido/slack-agora/releases/tag/v2.2.0
[2.1.0]: https://github.com/calvellido/slack-agora/releases/tag/v2.1.0
[2.0.0]: https://github.com/calvellido/slack-agora/releases/tag/v2.0.0
[1.5.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.5.0
[1.4.1]: https://github.com/calvellido/slack-agora/releases/tag/v1.4.1
[1.4.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.4.0
[1.3.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.3.0
[1.2.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.2.0
[1.1.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.1.0
[1.0.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.0.0
