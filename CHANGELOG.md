# Changelog

What changed in each version, and what to do when updating to it. Versions follow [semantic versioning](https://semver.org), and each one's section here becomes the notes of its [GitHub release](https://github.com/calvellido/slack-agora/releases).

## [Unreleased]

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

[1.2.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.2.0
[1.1.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.1.0
[1.0.0]: https://github.com/calvellido/slack-agora/releases/tag/v1.0.0
