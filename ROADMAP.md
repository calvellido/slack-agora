# Roadmap

Ideas for what Agora could do next, and what each would take, given how the code works today. None of them is promised or scheduled. If you'd like to work on one, open an issue first, so we can agree on the approach before you start (see [ARCHITECTURE.md](ARCHITECTURE.md) for how the code is organized).

## Running it

### Database backups

If the database is lost, no messages are lost, as they all live in Slack, but the links between them are: replies from old threads stop being sent, people's next messages start new threads, anonymous authors no longer find their conversations, and what the bot sent can no longer be deleted with the delete emoji.

What it takes: a `pnpm backup-db` command that writes a consistent copy of the database while the bot keeps running, with SQLite's own backup, which `node:sqlite` supports, and a section in the guide with a daily scheduled job as an example. The guide would also say where the copies should go: off the machine, and never next to `ANON_SECRET`, as both together can tell who wrote each anonymous conversation still open. Estimated: S, much like `pnpm clean-db`.

### A warning for permissions the bot doesn't need

A Slack app keeps the permissions it was ever granted until it is reinstalled, so its token can end up allowed to do much more than the manifest asks for. A token with extra permissions can do more harm if it leaks.

What it takes: Slack says which permissions a token has with every answer, so on start the bot can compare them with the manifest's and log the extra ones, as it already warns about shortcuts it doesn't know. Estimated: S.

### Catching up after a lost connection

The bot catches up on the DMs it missed only when it starts. If its connection to Slack drops and comes back while it keeps running, DMs sent in between may never arrive.

What it takes: catching up again each time the connection comes back, from when it was lost, with the same code that runs at start. The connection's events are already available, since the monitor pings use them. Estimated: S.

## For the team

### Reminders of unanswered conversations

When a team answers together, a message can fall through the cracks, with everyone thinking someone else replied. The bot can tell when a conversation's last message came from the person and nothing was sent back since.

What it takes: recording, for each conversation, when it started waiting for the team, and posting a note in the team channel every week, or every day, listing the threads that have waited longer than a setting, with links to them. Anonymous conversations would be listed the same way, by their thread alone. The hourly cleanup already gives the bot a place to run it. Estimated: M.

### Who is handling a conversation

A button on each thread's first message, *I'll take it*, that shows who took the conversation, with a way to hand it back. The reminders above could then name who has each one.

What it takes: the button and a column for who took it, and updating the thread's first message, which the bot posted, so it shows the name. Anonymous threads already have buttons there. Estimated: S.

### Scheduled posts

A *Send at* date and time in the posting form, for reminders of meetings or announcements prepared ahead.

What it takes: Slack can schedule a message itself, and delete it before it goes out, so a scheduled post would be recorded in the team channel like any other, and the delete emoji would cancel it. Slack can't schedule files, though, so posts with files would need the bot to keep its own schedule and be running at that time. Estimated: M.

### Editing a post

Correcting a post made with the posting form, without deleting it and posting it again.

What it takes: an *Edit* button on its record in the team channel, which opens the form with the post's text and updates what was posted, as edits of replies already do. Estimated: S.

### Counts for a report

How many conversations the team had each month, with a name and anonymous, how many replies it sent and how many posts it made, for a yearly report.

What it takes: counting what the database already holds, without any content or names, shown in the team's part of the *Home* tab or with a command. The counts should stay coarse, such as by month, so they can't point to anyone. Estimated: S.

## For people writing to the team

### Anonymous consultations

The team writes a question with options and posts it in a channel. People answer from a window, as they write anonymous messages, and the team sees only the totals. For a team that consults the people it serves, such as a works council asking staff about an agreement or a schedule, this may be the most useful addition.

What it takes: the most of these ideas. One answer per person, without storing who answered, would use a keyed hash like the one for anonymous authors, with a key of its own for each consultation, so answers to different consultations can't be linked. The totals would only show once enough people have answered, so they can't reveal how one person answered, and the consultation would close by itself on a date, posting its results. It needs new tables, views and texts, and a careful look at what the totals could give away. Estimated: L.

### Catching up mentions after downtime

@mentions made while the bot is down are lost, while DMs are caught up when it starts.

What it takes: on start, reading the history of the channels the bot is in, since its last heartbeat, and relaying the mentions without its received mark. Private channels need no new permission, but public ones would need `channels:history`, and mentions inside threads mean reading every thread with new replies, which is slow in busy channels. Estimated: M.

## Data

### Anonymous messages encrypted in Slack

On plans where the workspace owner can export private channels, such as Business+ and Enterprise, the owner can read the text of anonymous messages in the team channel, though not who wrote them. Encrypting that text in Slack would leave an export with nothing readable.

What it takes: posting the person's messages encrypted in the thread, with a button that opens a window where the bot shows the conversation decrypted, as the author's window does. The team would reply from that window too, since text typed in the thread is a plaintext Slack message an export can keep, even if the bot deleted it right after. Each conversation would get its own key, stored on the server encrypted with a new secret, and destroying it would make the conversation unreadable everywhere, including in exports made earlier. The team's internal discussion would stay in the thread, in plaintext, so quoting a message there would undo the protection. It would be a setting, so a deployment can keep today's behaviour. Open questions: when to destroy a conversation's key (when the bot forgets its author, or only when the team deletes it), whether to post earlier conversations again, encrypted, and what the team's window shows. Estimated: L.

### A retention period for conversations with a name

The team channel keeps what people wrote forever. A setting such as "delete what the bot relayed after 12 months without activity" would help teams that have to keep personal data only as long as they need it.

What it takes: since 2.2.0 the bot knows what it posted for each DM, and for the rest it can find its own messages in each thread, as it does when an anonymous conversation is deleted. It can only delete its own messages, though: the team's replies and discussion in the thread stay, unless each member deletes theirs or a workspace admin does. Estimated: M.

## Languages

### More languages

People see the bot in their Slack language, English or Spanish for now, and English otherwise.

What it takes: copying `locales/en.yml` to the new language's file, translating it and running `pnpm i18n`, which checks the translation (see *Languages* in ARCHITECTURE.md). Any language Slack supports can be added, and a partial translation works, falling back to English. Estimated: S for someone who speaks the language or using automated tools.

## Not planned

Some ideas come up and are left out on purpose, because they would weaken what anonymous messages promise:

- Files in anonymous conversations, either way. A file belongs to whoever uploads it, and it can carry details, such as where a photo was taken or who wrote a document, that give its author away.
- Notifying anonymous authors of replies. Any notification leaves a trace in their Slack, and its timing would match the reply in the team channel.
- Blocking anonymous authors. It would mean keeping a blocked author's hash linked to their conversation, which the bot otherwise forgets once the conversation ends.
