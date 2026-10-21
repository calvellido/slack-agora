# Agora

[![Version](https://img.shields.io/github/package-json/v/calvellido/slack-agora)](package.json)
[![Node](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcalvellido%2Fslack-agora%2Fmain%2Fpackage.json&query=%24.engines.node&label=node&color=339933&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Slack Bolt](https://img.shields.io/github/package-json/dependency-version/calvellido/slack-agora/@slack/bolt?label=slack%20bolt&logo=slack)](https://docs.slack.dev/tools/bolt-js)
[![TypeScript](https://img.shields.io/github/package-json/dependency-version/calvellido/slack-agora/dev/typescript?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/github/license/calvellido/slack-agora)](LICENSE)

<img src="assets/agora-logo.png" alt="Agora logo" width="128" align="right">

A Slack bot that a team answers together, named after the public square where a community meets.

People write to the bot, with their name or anonymously. The conversations show up as threads in the team's private channel, and the team replies from there as the bot. Team members can also post, or start conversations, as the bot.

## For people writing to the team

### With your name

To write with your name, use the bot's *Messages* tab, @mention it in a channel it is in, or open a form with `WRITE_COMMAND`, the shortcut, or the button on the bot's *Home* tab. The whole team reads it, and the replies come back where you wrote: in the *Messages* tab, or in the thread of your mention. What you send from the form also goes to the *Messages* tab, with a copy of your message, so you can keep writing there. The bot marks every message it receives with :incoming_envelope:, so you know it got there.

### Without your name

To write without your name, open *Anonymous messages*, from the button on the bot's *Home* tab, with `ANONYMOUS_COMMAND`, or with the shortcut. That window is where you write, read the team's replies (new ones are marked 🆕) and write again. Nothing stays in your Slack messages, and your anonymous conversations never show on the *Home* tab, only in that window. You can have up to 3 of them open at once.

### Ending an anonymous conversation

When you are done, use *End conversation* in the window. The bot then forgets the conversation was yours, and you can also ask it to delete your messages from the team's channel. If it's the team that ends it, or it goes 30 days without messages, you can still read it, or delete it, for 7 more days.

Those numbers are the defaults, and each deployment can change them in [.env.example](.env.example).

### Language

Everything you see on your own, like the *Home* tab, the windows or messages only you can see, is in your Slack language: English or Spanish, and English for any other language.

## For the team

### Conversations

Every conversation is a thread in the team channel, and later messages from the same person go to the same thread. Follow a thread (*⋯ > Get notified about new replies*) to hear about new messages in it. A DM starts a new thread after 7 days without activity.

### Replying as the bot

Writing in a thread is internal discussion: the person doesn't see it. To send a message as the bot, add :outbox_tray: to it. The bot sends it and marks it with :white_check_mark:. Edits made after that are not sent, except in anonymous conversations, where the author's window always shows the current text of each reply.

### Posting as the bot

To post as the bot, use the button on the bot's *Home* tab, `PUBLISH_COMMAND`, or the message shortcut, which copies the message you use it on. It opens a form to post in a channel, DM people, or both. Public channels work without inviting the bot; private ones need `/invite`. Every post is recorded in the team channel with who made it, and a DM starts a conversation thread. To delete something the bot sent, add :wastebasket: to its record in the team channel.

### Who sees the command and the shortcut

Slack shows an app's commands and shortcuts to everyone in the workspace, and has no way to show them only to some people. So anyone can see the command and the message shortcut for posting, although only the team can use them, and anyone else who tries just gets a note saying so. The button on the *Home* tab only shows to the team. To keep the command or the shortcut out of sight, set `PUBLISH_COMMAND=` (empty) or `PUBLISH_SHORTCUT=false` in `.env` and update the app's manifest (see *Setting it up*); the team then posts from the *Home* tab.

### Anonymous conversations

Anonymous conversations arrive as *Anonymous message*, with no name or code, and *End conversation* on the thread ends one. Once the bot no longer knows who wrote it, a delete button on the thread removes everything the bot posted there. Your own replies stay until each of you deletes theirs.

### Who can act as the bot

Only members of the team channel can act as the bot. What the bot posts in the team channel is in `TEAM_LANGUAGE`, since everyone there shares it.

### The team's voice and the bot's own

Only what the team sends is posted as the bot itself: replies sent with :outbox_tray: and posts made from the posting form. Everything the bot does on its own comes from a separate sender with a robot icon, named after the bot (for example *Agora · notices*, or *Agora · avisos* in Spanish): the messages it relays into the team channel, anonymous messages, its notices there (a conversation ending, a reply withdrawn, the bot back online) and its automatic replies to people. Short notices and automatic replies show as small grey text.

## If the bot is down

Slack only delivers messages to a running bot, so nothing answers while it is down. The *Home* tab tells people that a message without :incoming_envelope: means the bot is offline. When it is back, it relays the DMs it missed, marked with when they were sent, and apologises once to each sender. If it was away for more than 5 minutes, or relayed any late DMs, it also tells the team channel how long it was offline.

### What isn't recovered

Some things are not recovered:

- @mentions made while it was down are lost.
- A :outbox_tray: added in that time does nothing. If no :white_check_mark: appears, remove it and add it again.
- Commands, buttons and windows show Slack's own error while the bot is down.

## Privacy

### Messages with your name

DMs and @mentions are not anonymous: the team sees who wrote them.

### Anonymous messages

With anonymous messages:

- The team sees the text and when it was sent, and nothing else. Nothing visible links two conversations from the same person, or someone's window to its thread.
- The windows are not messages, so nothing the author writes or reads is in their Slack history or in DM exports. An export of the team channel has the anonymous texts, without their authors.
- People nearby only see the conversations while the window is open.
- Whoever runs the server could find out who wrote an open conversation, and so could anyone who gets both the database and `ANON_SECRET`. To show people their replies, the bot keeps a scrambled code of each author's Slack ID, made with that secret, until the conversation ends and the bot forgets them. So keep the secret apart from backups of the database, and choose carefully who has access to the server.
- Deleted messages disappear from the team channel and from later exports, although on Enterprise plans the workspace owner can set a legal hold, which keeps deleted messages.
- What people write can identify them, through details, writing style or timing. The form warns about it.

### Security

The database keeps Slack IDs and timestamps, not message contents, which stay in Slack. The logs only contain Slack error codes. Never run with `LOG_LEVEL=debug` in a real workspace, as it can print whole messages, with names.

Nothing is unhackable, and Agora doesn't claim to be. It does its best to keep anonymous messages truly anonymous, following a basic security principle: make getting at what it protects so much hassle that it isn't worth it for a bad actor to try. If anyone tells you, as a hard fact, that something can't be hacked, they are lying to you.

[SECURITY.md](SECURITY.md) explains how someone could try to get at anonymous messages or the bot's data, what they could get, and how to make it harder.

## Setting it up

### What you need

You need Node 26.12.1 or later, and a machine that stays on. The bot only connects out to Slack, so it needs no public address or open port.

### Installing

1. Copy `.env.example` to `.env` and fill in the app's part: `APP_NAME`, the commands, `TEAM_LANGUAGE` and `ABOUT`, the text at the top of the *Home* tab. Run `pnpm install`, then `pnpm manifest`, which writes `manifest.yml`. [manifest.example.yml](manifest.example.yml) shows what you get with the defaults.
2. [Create a Slack app](https://api.slack.com/apps) *from a manifest* with that file, and install it.
3. In *Basic Information > App-Level Tokens*, generate a token with the `connections:write` scope (`xapp-...`).
4. In *OAuth & Permissions*, copy the Bot User OAuth Token (`xoxb-...`).
5. Create the team's private channel, run `/invite @<bot>` in it, and copy its ID from the channel details, at the bottom of *About*.
6. Generate the anonymity secret with `openssl rand -base64 32`, and keep a copy somewhere other than the server.
7. Fill in the rest of `.env` and start the bot with `pnpm start`.

### Settings and data

Every setting, with its default, is described in [.env.example](.env.example). The database lives in `data/`, so keep that folder between restarts.

### Starting over

To start over with an empty database, for example after testing, run `pnpm clean-db`. It asks first, and works with the bot running. Threads already in the team channel stay, but they are no longer conversations: replies from them aren't sent, people's next messages start new threads, and anonymous conversations disappear from their authors' windows.

### Changing the app later

To change the app later, for example its name, a command, or a new version that needs other permissions, change `.env`, run `pnpm manifest`, and paste `manifest.yml` into *App Manifest* (YAML) in the app settings. Don't change the app's settings in Slack by hand, as the next manifest would undo it.

### Moving to another team channel

Changing `TEAM_CHANNEL_ID`, say from a test channel to the real one, is safe with the same database. People's next messages start new threads in the new channel, and anonymous conversations from the old one drop out of people's windows.

### How the Home tab looks

The *Home* tab opens with the bot's avatar, its name and the `ABOUT` text. `ABOUT` can also have a large heading and small grey text, as [.env.example](.env.example) explains.

For a banner across the top instead of the avatar, put a wide image at a public https address, such as a GitHub repository, and set `HOME_BANNER_URL`. Slack fetches the image itself, so it can't come from the bot's machine. If Slack can't get it, the bot shows the tab without it and logs a warning.

The app's icon is uploaded in the app settings, in *Basic Information > Display Information*. [assets/](assets/) has the Agora logo for it, and a banner with the logo in the middle.

### A custom icon for the bot's own messages

Everything the bot posts on its own shows a robot by default, so it doesn't look like a message from the team. You can use your own image instead, for example the app's icon with a small badge in a corner, by adding it to the workspace as a custom emoji:

1. Prepare a square image in PNG, JPG or GIF. Slack recommends under 128 KB, with a transparent background.
2. In Slack, open the emoji menu from the smiley in the message field, choose *Add Emoji*, upload the image and give it a name, such as `team-notices`. If you can't, your workspace may only let owners or admins add emoji.
3. Set `NOTICE_EMOJI=team-notices` in `.env` and restart the bot.

When it starts, the bot checks that the emoji exists. If it doesn't, because the name has a typo or the emoji was deleted, it uses the robot and logs a warning. Any standard emoji works too, such as `NOTICE_EMOJI=gear`.

## Not yet

- Files are not forwarded in either direction, although the team is told when a message had some.
- Editing something the bot already sent.

## Working on the code

See [ARCHITECTURE.md](ARCHITECTURE.md).

## License

[MIT](LICENSE).
