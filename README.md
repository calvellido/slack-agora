# Agora

[![Version](https://img.shields.io/github/package-json/v/calvellido/slack-agora)](package.json)
[![Node](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcalvellido%2Fslack-agora%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&color=339933&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Slack Bolt](https://img.shields.io/github/package-json/dependency-version/calvellido/slack-agora/@slack/bolt?label=slack%20bolt&logo=slack)](https://docs.slack.dev/tools/bolt-js)
[![TypeScript](https://img.shields.io/github/package-json/dependency-version/calvellido/slack-agora/dev/typescript?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/github/license/calvellido/slack-agora)](LICENSE)

<img src="assets/agora-logo.png" alt="Agora logo" width="128" align="right">

A Slack bot that a team answers together, named after the public square where a community meets.

People write to the bot, with their name or anonymously. The conversations show up as threads in the team's private channel, and the team replies from there as the bot. Team members can also post, or start conversations, as the bot.

## What it does

- People write to the team with their name, from the bot's *Messages* tab, a form or an @mention, and get the replies in the same place, with files both ways.
- Or without their name, in the *Anonymous messages* window, where they also read the team's replies. Nothing stays in their Slack messages, the text is encrypted outside Slack, and the bot forgets who wrote a conversation once it ends.
- Each conversation is a thread in the team's private channel. The team discusses it there, and sends a reply as the bot by adding :outbox_tray: to it, or, for anonymous conversations, from the window their *Open* button shows.
- Team members can also post in channels, or write to people, as the bot.
- What people see on their own is in their Slack language, English or Spanish, and what the bot posts in the team channel is in the team's.

## Privacy

Messages with your name are not anonymous: the team sees who wrote them. With anonymous messages the team sees the text and when it was sent, and nothing else, and nothing the author writes or reads stays in their Slack history or in DM exports. By default, their text is encrypted on the bot's server, so an export of the team channel doesn't have it, as long as the team doesn't quote it in the thread.

Nothing is unhackable, and Agora doesn't claim to be. [SECURITY.md](SECURITY.md) explains how someone could try to get at anonymous messages, what they could get, and how to make it harder.

## Getting started

You need a machine that stays on, with Docker. The bot only connects out to Slack, so it needs no public address or open port. In an empty folder:

```sh
curl -LO https://github.com/calvellido/slack-agora/releases/latest/download/compose.yaml
curl -Lo .env https://github.com/calvellido/slack-agora/releases/latest/download/env.example
```

1. Fill in the app's part of `.env`: its name, the commands, the team's language and the text for the *Home* tab. Then generate the Slack app's manifest: `docker compose run --rm -T agora manifest > manifest.yml`.
2. [Create a Slack app](https://api.slack.com/apps) *from a manifest* with that file, and install it.
3. Fill in the rest of `.env`: the app's two tokens, the ID of the team's private channel, with the bot invited to it, and a secret for anonymous messages, which is best kept in your system's keychain instead ([Keeping ANON_SECRET apart](GUIDE.md#keeping-anon_secret-apart)). The [guide](GUIDE.md#installing) says where to find each one.
4. Start the bot: `docker compose up -d`.

## Documentation

- [GUIDE.md](GUIDE.md): everything in detail, from using it, as a person or as the team, and what happens while it's down, to running it with Docker or Node, updating it, and customizing it.
- [SECURITY.md](SECURITY.md): how someone could try to get at anonymous messages or the bot's data, and how to make it harder.
- [ARCHITECTURE.md](ARCHITECTURE.md): how the code works.
- [CHANGELOG.md](CHANGELOG.md): what changed in each version, and what to do when updating.
- [ROADMAP.md](ROADMAP.md): ideas for what could come next, and what each would take.

## Contributing

Ideas, bug reports and improvements are welcome, as issues and pull requests in [this repository](https://github.com/calvellido/slack-agora). [ROADMAP.md](ROADMAP.md) lists ideas that are open to anyone. [ARCHITECTURE.md](ARCHITECTURE.md) explains how the code works, and `pnpm check` runs the same checks as CI.

## License

[MIT](LICENSE).
