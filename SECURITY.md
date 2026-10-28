# Security

Nothing is unhackable, and Agora doesn't claim to be. It does its best to keep anonymous messages truly anonymous, following a basic security principle: make getting at what it protects so much hassle that it isn't worth it for a bad actor to try.

## What needs protecting

Mainly, the link between an anonymous message and its author, and the text of anonymous conversations, which the bot keeps on its server, encrypted, so it isn't in Slack messages and exports. (With `ANON_ENCRYPTED=false`, and in conversations from before 3.0.0, the text is in the team channel instead, where the whole team reads it anyway.) Then there are the two Slack tokens in `.env`: the bot token reads the bot's DMs and the team channel, and the app-level token receives the events Slack sends the bot.

## Who could get what

| Who | How | What they would get |
| --- | --- | --- |
| Whoever controls the server: its operator, the hosting company, an intruder | Using `ANON_SECRET` to match the scrambled codes in the database against every member of the workspace, and to decrypt the conversations' keys, or changing the code to log senders | The authors of conversations the bot hasn't forgotten yet, the text of conversations whose key isn't destroyed yet, and everything new once the code is changed |
| Anyone with the app-level token, or a collaborator on the Slack app | Opening a second connection as the bot, which receives some of the anonymous submissions, with the sender's Slack ID and what they wrote, and some of the team's replies from its window | The authors and the text of future anonymous messages |
| Anyone with an old backup of the database and the secret | The same matching and decrypting as on the server | The authors of conversations the bot hadn't forgotten when the backup was made, and the text of those whose key it still held |
| The workspace owner | Exporting the team channel, and comparing message times with its access logs (Enterprise plans) | That anonymous messages arrived, when, and the team's discussion of them, plus guesses from timing; the anonymous texts too in conversations from before 3.0.0, or with `ANON_ENCRYPTED=false` |
| The team, or anyone who knows the author | Reading the details, the writing style and the timing | Whatever the content itself gives away |
| Anyone in the author's Slack account | Opening *Anonymous messages* | That person's conversations the bot hasn't forgotten yet, and editing or deleting their messages while a conversation is open |

The scrambled code protects nothing once someone has the secret: there are only a few hundred Slack IDs to try. That is why the secret must never sit next to the database or its backups. Once a conversation is forgotten, the bot overwrites the link in the database file and empties its log, where SQLite would otherwise keep an earlier copy for a while, so it is gone from the database. It is not gone from older backups, nor from old copies of blocks the server's disk itself may keep.

Some things don't work for an attacker. Without the secret, the codes can't be guessed (it has 256 bits). The network traffic is encrypted, and the server has no open port besides SSH, because the bot only connects out. The logs hold only error codes, and at the `trace` level the kinds of events the bot handles, without IDs or text, as long as `LOG_LEVEL=debug` is never used in a real workspace. The console, in the bot's terminal, can't set it, and nothing controls the bot from Slack or the network: the team's buttons on the *Home* tab only show things, the bot's status, without what failed or when, and whether a newer release is out, which is public, and installing it is done on the bot's machine.

## Keeping the risk low

- Give access to the server and to the app's collaborators to one or two trusted people, with SSH keys, and regenerate both tokens when one of them leaves.
- Keep `ANON_SECRET` out of `.env`, in the system's keychain, with `ANON_SECRET_COMMAND` ([Keeping ANON_SECRET apart](GUIDE.md#keeping-anon_secret-apart)). Either keep one sealed copy elsewhere, never with the backups, or none at all, generating it straight into the keychain, so nobody knows it, at the cost of losing anonymous conversations with the machine ([A copy of ANON_SECRET, or none](GUIDE.md#a-copy-of-anon_secret-or-none)).
- Keep `ANON_SECRET` out of the backups, encrypt the backups, and delete those older than `ANON_READABLE_DAYS`, which still hold the keys of conversations the bot has since destroyed.
- Run the bot on a machine the team controls, never one the company manages: device management, backup and security tools run with administrator rights, and can read the database, the secret and the running bot. On a laptop, follow [Running it on a laptop](GUIDE.md#running-it-on-a-laptop).
- Encrypt the server's disk, so the old blocks it may keep after the bot overwrites something can't be read.
- Deploy only reviewed code from the repository.
- Keep `ANON_IDLE_DAYS` short, so the bot forgets authors sooner, and `ANON_READABLE_DAYS` as short as the team can work with, so it destroys conversations' keys sooner.
- In the team, discuss anonymous conversations without quoting them in their threads, which aren't encrypted.
- If you write anonymously, leave out details only you would know, end conversations you no longer need, and don't use a shared or unlocked computer.

## What the design can't prevent

A dishonest operator, because the bot has to know who is writing to show them the replies, and decrypts the conversations to show them to both sides. A design where each person keeps a private key to read their replies would leave nothing on the server linking conversations to people, at the cost of losing the conversation if the key is lost. Even then, a modified server could still capture senders as their messages arrive.
