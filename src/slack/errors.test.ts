import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stringsIn } from '#src/i18n/index.ts';
import { describeError, errorCode } from './errors.ts';
import { slackError } from './testing.ts';

test("Slack's common refusals are put in words for the team, and any other shows its code", () => {
  const t = stringsIn('en', { bot: 'Helpdesk', publishCommand: '/post', anonymousCommand: '/anon' });
  assert.equal(describeError(t, slackError('not_in_channel')), t.errors.notInChannel);
  assert.equal(describeError(t, slackError('restricted_action_read_only_channel')), t.errors.restricted);
  assert.equal(describeError(t, slackError('fatal_error')), '`fatal_error`');
  assert.equal(errorCode(new Error('socket hang up')), 'socket hang up');
});
