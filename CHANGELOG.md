# Changelog

What changed in each version, and what to do when updating to it. Versions follow [semantic versioning](https://semver.org), and each one's section here becomes the notes of its [GitHub release](https://github.com/calvellido/slack-agora/releases).

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
