import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TeamDirectory } from './team-directory.ts';

test('the people in the team channel are its members by name, without bots or deactivated accounts', async () => {
  const users: Record<string, object> = {
    U1: { profile: { display_name: 'Marta', image_72: 'https://example.com/marta.png' } },
    U2: { real_name: 'Ana López', profile: { display_name: '' } },
    UBOT: { is_bot: true, profile: { display_name: 'Helpdesk' } },
    U3: { deleted: true, real_name: 'Gone' },
    USLACKBOT: { real_name: 'Slackbot' },
  };
  let lookups = 0;
  const client = {
    conversations: { members: async () => ({ members: Object.keys(users) }) },
    users: {
      info: async ({ user }: { user: string }) => {
        lookups++;
        return { user: users[user] };
      },
    },
  } as unknown as WebClient;
  const team = new TeamDirectory(client, 'C1');

  const people = [
    { id: 'U2', name: 'Ana López', avatar: undefined },
    { id: 'U1', name: 'Marta', avatar: 'https://example.com/marta.png' },
  ];
  assert.deepEqual(await team.people(), people);
  assert.deepEqual(await team.people(), people);
  assert.equal(lookups, 5);
  assert.equal(await team.isMember('UBOT'), true);
});
