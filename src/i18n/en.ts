import type { Names } from './index.ts';

// English, the default language. Every other language implements the same keys (see index.ts).

export function en({ bot, publishCommand, anonCommand }: Names) {
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const days = (count: number) => plural(count, 'day', 'days');

  return {
    // The Slack app (see manifest.ts), in the team's language
    manifestDescription: `Write to the ${bot} team, with your name or anonymously`,
    anonShortcutName: `Anonymous message to ${bot}`,
    anonShortcutDescription: `Write to the ${bot} team without your name`,
    publishShortcutName: `Post as ${bot}`,
    publishShortcutDescription: `Post this message as ${bot} in a channel or by direct message`,
    publishCommandDescription: `Post as ${bot} in a channel or by direct message`,
    publishCommandHint: '[message]',
    anonCommandDescription: `Write to the ${bot} team without your name`,

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
    lateAck: `Sorry for the delay: ${bot} was offline for a while. Your message has now reached the team, and they will reply here.`,

    // Team channel: after the bot was down
    lateRelay: (date: string) => `⏱️ Sent ${date}, while ${bot} was offline.`,
    backOnline: (duration: string, since: string, recovered: number) =>
      `✅ ${bot} is running again after ${duration} offline (since ${since}). ` +
      (recovered === 0
        ? 'No direct messages arrived meanwhile.'
        : `It has relayed ${plural(recovered, 'direct message', 'direct messages')} that arrived meanwhile.`),

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
      `• *With your name:* write from ${bot}'s *Messages* tab. The team sees who you are and replies there.\n` +
      "• *Without your name:* open *Anonymous messages*. That's where you write to the team and read its replies.",
    homeDeliveryHint:
      `${bot} marks every message it gets with :incoming_envelope:. If you don't see it, ${bot} is offline for a moment: ` +
      'your message is not lost and reaches the team as soon as it is back.',
    homeAnonButton: 'Anonymous messages',
    homeAnonHint:
      'Your anonymous conversations never appear on this tab, only in that window. ' +
      `You can also open it with \`${anonCommand}\` from any channel.`,
    homeTeam: (teamChannel: string, sendEmoji: string, deleteEmoji: string) =>
      `*For the ${bot} team*\n` +
      `• Every conversation with ${bot} shows up in <#${teamChannel}> as a thread, anonymous ones too.\n` +
      `• To reply, write in the thread and add :${sendEmoji}: to your message. ${bot} sends it and marks it with :white_check_mark:.\n` +
      `• To delete something ${bot} sent, add :${deleteEmoji}: to its record in <#${teamChannel}>.\n` +
      `• To post or write to someone as ${bot}, use \`${publishCommand}\` or the message shortcut that posts as ${bot}.`,

    // "Anonymous messages" window: the viewer's own anonymous conversations
    inboxTitle: 'Anonymous messages',
    inboxIntro:
      `Write to the ${bot} team without your name. The team gets your messages anonymously, ` +
      'and its replies show up here, in this window. Nothing stays in your Slack messages.',
    inboxNew: 'New conversation',
    inboxEmpty: "You don't have any anonymous conversations.",
    inboxConversations: '*Your conversations*',
    inboxOpen: 'Open',
    inboxNewReply: '🆕 New reply',
    inboxStarted: (date: string) => `Started: ${date}`,
    inboxLast: (date: string) => `Last message: ${date}`,
    convName: '*Anonymous conversation*',
    convTitle: 'Anonymous conversation',
    convEndedByTeam: (count: number) => `🔒 Ended by the team. It will disappear from here in ${days(count)}.`,
    convExpired: (count: number) => `🔒 Ended after inactivity. It will disappear from here in ${days(count)}.`,
    convYou: '🕶️ *You*',
    convNew: '🆕',
    convHidden: (count: number) => `${plural(count, 'earlier message', 'earlier messages')} not shown.`,
    convUnavailable: '_This message is no longer available._',
    convReply: 'Your reply',
    convSend: 'Send',
    convBack: 'Back',
    convEnd: 'End conversation',
    convDelete: 'Delete conversation',
    convDeleteConfirmTitle: 'Delete the conversation?',
    convDeleteConfirm: `${bot} will delete your messages from the team's channel and forget that this conversation is yours.`,
    convDeleteConfirmButton: 'Delete',
    convDeleted: `${bot} is deleting your messages from the team's channel and no longer keeps anything linking you to the conversation.`,
    cancel: 'Cancel',

    // Ending a conversation, from the window
    endIntro: `Once it ends, nobody can write in it any more and ${bot} forgets it's yours, so you won't be able to see it again.`,
    endDeleteLabel: 'Your messages',
    endDeleteOption: "Also delete my messages from the team's channel",
    endDeleteHint:
      'The team will no longer see what you wrote. Its replies stay in the channel unless each team member deletes their own.',
    endSubmit: 'End',
    endDone: `You ended the conversation. ${bot} no longer keeps anything linking you to it.`,
    endDoneDeleted:
      `You ended the conversation and ${bot} is deleting your messages from the team's channel. ` +
      'It no longer keeps anything linking you to it.',

    // New anonymous conversation form
    anonTitle: 'Anonymous message',
    anonSubmit: 'Send',
    anonIntro:
      `The ${bot} team will get your message anonymously, without your name. ` +
      `Replies will show up in ${bot}'s *Anonymous messages*, where you can continue the conversation.`,
    anonMessage: 'Message',
    anonPrivacy:
      '• What you say and how you write can identify you: think about which details you include.\n' +
      "• The team can't tell whether two anonymous conversations come from the same person.\n" +
      `• ${bot} doesn't notify you of replies, because a notification would leave a trace in your messages. Come back here to see them.\n` +
      `• ${bot} doesn't store your name with the message, only an encrypted fingerprint to show you the replies. ` +
      "It's deleted when the conversation ends, and you can then also delete your messages from the team's channel.",
    anonSent: `✅ Sent. The team will get it without your name.\n\nIts replies will show up in ${bot}'s *Anonymous messages*.`,
    anonClose: 'Close',
    anonEmpty: 'The message is empty.',
    anonTooMany: (max: number) =>
      `You already have ${plural(max, 'open anonymous conversation', 'open anonymous conversations')}. ` +
      'End one to start another.',
    anonUnavailable: 'This conversation has ended.',
    anonSendFailed: "Couldn't send it. Try again in a few minutes.",

    // Team channel: anonymous threads
    anonHeader: '🕶️ *Anonymous message*',
    anonFollowUp: '🕶️ The person wrote:',
    anonOpenStatus: (sendEmoji: string) =>
      `To reply, write in the thread and add :${sendEmoji}: to your message. ` +
      `The person will see it in ${bot}'s *Anonymous messages*, including later edits.`,
    anonEndButton: 'End conversation',
    anonEndConfirmTitle: 'End the conversation?',
    anonEndConfirm: (count: number) =>
      `The person won't be able to write in it any more, and will see it as ended for ${days(count)}.`,
    anonEndConfirmButton: 'End',
    anonEndedBy: (user: string) => `🔒 <@${user}> ended the conversation.`,
    anonEndedByPerson: '🔒 The person ended the conversation.',
    anonEndedByTeam: '🔒 The team ended the conversation.',
    anonExpired: (count: number) => `🔒 Conversation ended automatically after ${days(count)} without activity.`,
    anonDeletableStatus: `The person can no longer see this conversation. ${bot} can delete everything it posted in it from the channel.`,
    anonDeleteButton: 'Delete conversation',
    anonDeleteConfirmTitle: 'Delete the conversation?',
    anonDeleteConfirm:
      `${bot} will delete what it posted in this thread, including the person's messages. ` +
      "The team's replies can only be deleted by whoever wrote them.",
    anonDeleteConfirmButton: 'Delete',
    anonDeletedByTeam: "Deleted. The team's replies left in the thread can only be deleted by whoever wrote them.",
    anonDeletedByPerson:
      "🗑️ The person deleted their messages from this conversation. The team's replies can only be deleted by whoever wrote them.",
    anonNotDeletable: "The person can still see this conversation, so it can't be deleted yet.",
    anonReplyClosed: 'This anonymous conversation has ended.',
    anonAlreadyClosed: 'This conversation had already ended.',
    anonReplyDeleted: (user: string) =>
      `🗑️ <@${user}> withdrew the reply. The person won't see it any more, though they may have read it already.`,
  };
}
