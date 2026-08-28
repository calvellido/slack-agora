import type { Names } from './index.ts';

// English, the default language. Every other language implements the same keys (see index.ts).

export function en({ bot, publishCommand }: Names) {
  return {
    // The Slack app (see manifest.ts), in the team's language
    manifestDescription: `Write to the ${bot} team`,
    publishShortcutName: `Post as ${bot}`,
    publishShortcutDescription: `Post this message as ${bot} in a channel or by direct message`,
    publishCommandDescription: `Post as ${bot} in a channel or by direct message`,
    publishCommandHint: '[message]',

    // Team channel: conversation threads
    dmHeader: (user: string) => `💬 Direct message from <@${user}>`,
    mentionHeader: (user: string, channel: string, permalink: string) =>
      `🔔 <@${user}> mentioned ${bot} in <#${channel}> · <${permalink}|view message>`,
    followUp: (user: string) => `<@${user}> wrote:`,
    dmStarted: (poster: string, user: string) => `📤 <@${poster}> wrote to <@${user}> as ${bot}:`,
    replyHint: (sendEmoji: string) =>
      `To reply as ${bot}, write in this thread and add :${sendEmoji}: to your message.`,
    filesNotRelayed: (count: number) =>
      `📎 Includes ${count === 1 ? 'a file' : `${count} files`} that ${bot} can't forward yet.`,

    // Team channel: record of what the bot posted or deleted
    published: (poster: string, channel: string, permalink: string) =>
      `📣 <@${poster}> posted as ${bot} in <#${channel}> · <${permalink}|view message>`,
    publishFailed: (poster: string, target: string, error: string) =>
      `⚠️ Couldn't send as ${bot} to ${target} (requested by <@${poster}>): \`${error}\``,
    deleted: (user: string) => `🗑️ <@${user}> deleted what ${bot} had sent.`,

    // Team channel: only visible to whoever reacted
    notInThread: `Only messages written inside a conversation's thread can be sent as ${bot}.`,
    notAConversation: `This thread isn't a ${bot} conversation.`,
    cannotSendBotMessage: `That message is from ${bot}. Write your reply in the thread and add the reaction to your own message.`,
    emptyReply: 'That message has no text to send.',
    filesNotSent: `The text was sent, but ${bot} can't send files yet.`,
    alreadySent: 'This message was already sent.',
    sendFailed: (error: string) => `Couldn't send the message: \`${error}\``,
    alreadyDeleted: 'It was already deleted.',
    deleteFailed: (error: string) => `Couldn't delete it: \`${error}\``,

    // DM to whoever writes to the bot
    dmAck: `Thanks for writing! The ${bot} team has received your message and will reply here.`,

    // Posting as the bot
    teamOnly: `This is only available to the ${bot} team.`,
    publishTitle: `Post as ${bot}`,
    publishSubmit: 'Post',
    publishClose: 'Cancel',
    publishChannel: 'Channel',
    publishPeople: 'People (direct message)',
    publishMessage: 'Message',
    publishHint: (teamChannel: string) =>
      `Choose a channel, people or both. <#${teamChannel}> keeps a record of who posted it.`,
    publishNeedTarget: 'Choose a channel or at least one person.',
    publishEmpty: 'The message is empty.',
    publishNotMember: `${bot} isn't in this private channel. Invite it first with /invite @${bot}.`,
    publishArchived: 'This channel is archived.',

    // Home tab
    homeContact:
      `*Want to talk to the ${bot} team?*\n` +
      `Write from ${bot}'s *Messages* tab. Everyone in the team reads it and replies there.`,
    homeTeam: (teamChannel: string, sendEmoji: string, deleteEmoji: string) =>
      `*For the ${bot} team*\n` +
      `• Every conversation with ${bot} shows up in <#${teamChannel}> as a thread.\n` +
      `• To reply, write in the thread and add :${sendEmoji}: to your message. ${bot} sends it and marks it with :white_check_mark:.\n` +
      `• To delete something ${bot} sent, add :${deleteEmoji}: to its record in <#${teamChannel}>.\n` +
      `• To post or write to someone as ${bot}, use \`${publishCommand}\` or the message shortcut that posts as ${bot}.`,
  };
}
