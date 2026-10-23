# Security

Nothing is unhackable, and Agora doesn't claim to be. It does its best to keep anonymous messages truly anonymous, following a basic security principle: make getting at what it protects so much hassle that it isn't worth it for a bad actor to try.

## What needs protecting

Mainly, the link between an anonymous message and its author. The messages themselves are in the team channel, where the whole team reads them anyway. Then there are the two Slack tokens in `.env`: the bot token reads the bot's DMs and the team channel, and the app-level token receives the events Slack sends the bot.

## Who could get what

| Who | How | What they would get |
| --- | --- | --- |
| Whoever controls the server: its operator, the hosting company, an intruder | Using `ANON_SECRET` to match the scrambled codes in the database against every member of the workspace, or changing the code to log senders | The authors of open conversations, and of every new message once the code is changed |
| Anyone with the app-level token, or a collaborator on the Slack app | Opening a second connection as the bot, which receives some of the anonymous submissions with the sender's Slack ID | The authors of future anonymous messages |
| Anyone with an old backup of the database and the secret | The same matching as on the server | The authors of conversations that were open when the backup was made |
| The workspace owner | Exporting the team channel, and comparing message times with its access logs (Enterprise plans) | The anonymous texts without their authors, and guesses from timing |
| The team, or anyone who knows the author | Reading the details, the writing style and the timing | Whatever the content itself gives away |
| Anyone in the author's Slack account | Opening *Anonymous messages* | That person's conversations that haven't ended |

The scrambled code protects nothing once someone has the secret: there are only a few hundred Slack IDs to try. That is why the secret must never sit next to the database or its backups. Once a conversation is forgotten, the bot overwrites the link in the database file and empties its log, where SQLite would otherwise keep an earlier copy for a while, so it is gone from the database. It is not gone from older backups, nor from old copies of blocks the server's disk itself may keep.

Some things don't work for an attacker. Without the secret, the codes can't be guessed (it has 256 bits). The network traffic is encrypted, and the server has no open port besides SSH, because the bot only connects out. The logs hold only error codes, as long as `LOG_LEVEL=debug` is never used in a real workspace.

## Keeping the risk low

- Give access to the server and to the app's collaborators to one or two trusted people, with SSH keys, and regenerate both tokens when one of them leaves.
- Keep `ANON_SECRET` out of the backups, encrypt the backups, and delete old ones.
- Encrypt the server's disk, so the old blocks it may keep after the bot overwrites something can't be read.
- Deploy only reviewed code from the repository.
- Keep `ANON_IDLE_DAYS` short, so the bot forgets authors sooner.
- If you write anonymously, leave out details only you would know, end conversations you no longer need, and don't use a shared or unlocked computer.

## What the design can't prevent

A dishonest operator, because the bot has to know who is writing to show them the replies. A design where each person keeps a private key to read their replies would leave nothing on the server linking conversations to people, at the cost of losing the conversation if the key is lost. Even then, a modified server could still capture senders as their messages arrive.
