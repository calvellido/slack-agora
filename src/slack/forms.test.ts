import type { ModalView } from '@slack/types';
import type { WebClient } from '@slack/web-api';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerInTime, type Answer, type Late } from './forms.ts';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const notice = (text: string) => ({ type: 'modal', title: { type: 'plain_text', text: 'Form' }, blocks: [], text }) as ModalView;
const late: Late = { notice, sending: 'Sending', done: 'Done', failed: 'Failed' };
const view = notice('How it went');

/** A form submitted now, answered with `answer` after `ms`: what it answered Slack, and the views it showed after. */
async function submit(answer: () => Promise<Answer>, ms: number, waitMs = 20) {
  const acks: Answer[] = [];
  const updates: ModalView[] = [];
  const client = { views: { update: async ({ view }: { view: ModalView }) => (updates.push(view), { ok: true }) } } as unknown as WebClient;
  const form = { ack: async (a?: Answer) => void acks.push(a), client, viewId: 'V1', received: Date.now() };
  const returned = await answerInTime(form, wait(ms).then(answer), late, waitMs);
  return { acks, updates, returned };
}

test('a form answered in time gets its answer at once, errors or closing included', async () => {
  const errors: Answer = { response_action: 'errors', errors: { message: 'Too long' } };
  for (const answer of [{ response_action: 'update', view } as const, errors, undefined]) {
    assert.deepEqual(await submit(async () => answer, 0), { acks: [answer], updates: [], returned: answer });
  }
});

test('past the wait, the form says it is sending, and then shows how it went, errors and closing as notices', async () => {
  const sending = { response_action: 'update', view: notice('Sending') };
  assert.deepEqual(await submit(async () => ({ response_action: 'update', view }), 40), {
    acks: [sending],
    updates: [view],
    returned: { response_action: 'update', view },
  });
  const failed = await submit(async () => ({ response_action: 'errors', errors: { message: 'Too long' } }), 40);
  assert.deepEqual(failed.updates, [notice('Too long')]);
  assert.deepEqual((await submit(async () => undefined, 40)).updates, [notice('Done')]);
});

test('the wait counts from when the form arrived, so time spent before answering is part of it', async () => {
  const acks: Answer[] = [];
  const client = { views: { update: async () => ({ ok: true }) } } as unknown as WebClient;
  const form = { ack: async (a?: Answer) => void acks.push(a), client, viewId: 'V1', received: Date.now() - 30 };
  await answerInTime(form, wait(10).then(() => undefined), late, 20);
  assert.deepEqual(acks, [{ response_action: 'update', view: notice('Sending') }]);
});

test('a form whose answer fails unexpectedly says so, in time or late, and the failure is thrown', async () => {
  const failing = async (): Promise<Answer> => Promise.reject(new Error('boom'));
  const acks: Answer[] = [];
  const updates: ModalView[] = [];
  const client = { views: { update: async ({ view }: { view: ModalView }) => (updates.push(view), { ok: true }) } } as unknown as WebClient;
  const form = { ack: async (a?: Answer) => void acks.push(a), client, viewId: 'V1', received: Date.now() };
  await assert.rejects(answerInTime(form, failing(), late, 20), /boom/);
  assert.deepEqual(acks, [{ response_action: 'update', view: notice('Failed') }]);
  await assert.rejects(answerInTime({ ...form, received: Date.now() }, wait(40).then(failing), late, 20), /boom/);
  assert.deepEqual(updates, [notice('Failed')]);
});
