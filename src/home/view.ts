import type { ContextBlock, HeaderBlock, HomeView, ImageBlock, KnownBlock, SectionBlock } from '@slack/types';
import type { Strings } from '#src/i18n/index.ts';
import type { Person } from '#src/slack/team-directory.ts';
import { readableUrl } from '#src/lib/url.ts';
import { context, spacer } from '#src/slack/blocks.ts';
import { STATUS_ACTION } from './status.ts';
import { UPDATES_ACTION } from './updates.ts';

// The Home tab, in the language of `t`. Everyone gets the same one, and team members also get how to act as the bot,
// so it never gives away that someone writes anonymously: those conversations live in a modal.

export interface HomeOptions {
  bot: { name: string; avatar?: string };
  /** The deployment's ABOUT text in the viewer's language; without it, a generic intro. */
  about?: string;
  /** An image across the top, in place of the avatar. */
  banner?: string;
  /** The command to write with your name, if the deployment has one. */
  writeCommand?: string;
  /** The people in the team channel, if the deployment lists them, for the intro. */
  members?: Person[];
  /** Where the bot's code can be read, and the version that is running, for the note at the bottom. */
  sourceUrl?: string;
  version?: string;
  /** Only for team members, with the ways to post as the bot besides the Home tab's button. */
  team?: {
    channel: string;
    sendEmoji: string;
    deleteEmoji: string;
    publishCommand: boolean;
    publishShortcut: boolean;
    /** Whether new anonymous conversations are encrypted, and so answered from their window. */
    anonEncrypted: boolean;
    /** Whether there's a button to check for a newer release, which needs SOURCE_URL on GitHub. */
    updates?: boolean;
  };
}

const plain = (text: string) => ({ type: 'plain_text' as const, text });
const mrkdwn = (text: string) => ({ type: 'mrkdwn' as const, text });

/** Header blocks take plain text only, up to 150 characters. */
function header(text: string): HeaderBlock {
  return { type: 'header', text: plain(text.length > 150 ? `${text.slice(0, 149)}…` : text) };
}

/**
 * The about text in Slack's three text sizes: a line starting with `# ` is a heading, one starting with `-# ` small
 * grey text, and the rest normal text. Lines of the same size in a row stay together, except headings.
 */
export function aboutBlocks(text: string): KnownBlock[] {
  const runs: { size: 'heading' | 'small' | 'normal'; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const size = line.startsWith('# ') ? 'heading' : line.startsWith('-# ') ? 'small' : 'normal';
    const content = line.slice({ heading: 2, small: 3, normal: 0 }[size]);
    const last = runs.at(-1);
    if (last?.size === size && size !== 'heading') last.lines.push(content);
    else runs.push({ size, lines: [content] });
  }
  return runs.flatMap(({ size, lines }): KnownBlock[] => {
    const text = lines.join('\n').trim();
    if (!text) return [];
    if (size === 'heading') return [header(text)];
    if (size === 'small') return [context(text)];
    return [{ type: 'section', text: mrkdwn(text) }];
  });
}

/** Each person's photo and name, as a row of small text; a row fits five, as Slack allows ten elements. */
function peopleRows(people: Person[]): ContextBlock[] {
  const rows: ContextBlock[] = [];
  for (let i = 0; i < people.length; i += 5) {
    const elements = people.slice(i, i + 5).flatMap(({ id, name, avatar }) => [
      ...(avatar ? [{ type: 'image' as const, image_url: avatar, alt_text: name }] : []),
      mrkdwn(`<@${id}>`),
    ]);
    rows.push({ type: 'context', elements });
  }
  return rows;
}

function publishWays({ publishCommand, publishShortcut }: { publishCommand: boolean; publishShortcut: boolean }) {
  if (publishCommand && publishShortcut) return 'both';
  return publishCommand ? 'command' : publishShortcut ? 'shortcut' : 'none';
}

export function homeView(t: Strings, options: HomeOptions): HomeView {
  const { bot, about, banner, writeCommand, members, sourceUrl, version, team } = options;
  const intro = aboutBlocks(about ?? t.home.intro);
  // The team's people go after the about text, before any small text that closes it.
  if (members?.length) {
    let at = intro.length;
    while (at > 0 && intro[at - 1]!.type === 'context') at--;
    // With a space under it when small text follows; otherwise the space before the line below is enough.
    const after = at < intro.length ? [spacer()] : [];
    intro.splice(at, 0, { type: 'section', text: mrkdwn(t.home.members) }, ...peopleRows(members), ...after);
  }
  // A heading at the start of the about text takes the place of the bot's name.
  if (intro[0]?.type !== 'header') intro.unshift(header(bot.name));
  // Slack draws an image block at the image's own size, so the 72-pixel avatar stays small.
  const image = banner ?? bot.avatar;
  if (image) intro.unshift({ type: 'image', image_url: image, alt_text: bot.name } satisfies ImageBlock);

  const blocks: KnownBlock[] = [
    ...intro,
    spacer(),
    { type: 'divider' },
    header(t.home.contactTitle),
    { type: 'section', text: mrkdwn(t.home.named) },
    { type: 'actions', elements: [{ type: 'button', action_id: 'write_open', text: plain(t.home.namedButton) }] },
    ...(writeCommand ? [context(t.home.namedHint({ command: writeCommand }))] : []),
    context(t.home.deliveryHint),
    // Two blank lines, so the two ways read as separate options.
    spacer(),
    spacer(),
    { type: 'section', text: mrkdwn(t.home.anonymous) },
    {
      type: 'actions',
      elements: [{ type: 'button', action_id: 'anon_inbox', text: plain(t.home.anonymousButton) }],
    },
    context(t.home.anonymousHint),
  ];
  if (team) {
    const teamChannel = team.channel;
    blocks.push(
      spacer(),
      { type: 'divider' },
      header(t.home.team.title),
      context(t.home.team.onlyTeam({ teamChannel })),
      spacer(),
      // Two rows of two, each its own block with a space between, since Slack packs the rows of one block tightly.
      {
        type: 'section',
        fields: [
          mrkdwn(t.home.team.conversations({ teamChannel })),
          mrkdwn(t.home.team.reply({ sendEmoji: team.sendEmoji, anonymous: team.anonEncrypted ? 'encrypted' : 'plain' })),
        ],
      },
      spacer(),
      {
        type: 'section',
        fields: [
          mrkdwn(t.home.team.delete({ teamChannel, deleteEmoji: team.deleteEmoji })),
          mrkdwn(t.home.team.publish({ ways: publishWays(team) })),
        ],
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', action_id: 'publish_open', text: plain(t.home.team.publishButton) },
          { type: 'button', action_id: STATUS_ACTION, text: plain(t.home.team.statusButton) },
          ...(team.updates ? [{ type: 'button' as const, action_id: UPDATES_ACTION, text: plain(t.home.team.updatesButton) }] : []),
        ],
      },
    );
  }
  const footer = [
    sourceUrl ? t.home.source({ url: sourceUrl, label: readableUrl(sourceUrl) }) : '',
    version ? t.home.version({ version }) : '',
  ].filter(Boolean);
  if (footer.length > 0) blocks.push(spacer(), { type: 'divider' }, context(footer.join('\n')));
  return { type: 'home', blocks };
}
